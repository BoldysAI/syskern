"""Celery tasks for the Fournisseurs module (Épic FEEDBACK 1 — écart CDC §11.3).

Batch Excel PO import. The endpoint saves the upload and dispatches this task
(AGENTS §4: never parse a file on a request thread). Matching is by existing SKU
only — no product creation. A row whose SKU or supplier is unknown is rejected
(with a reason) without blocking the rest, and collected into a downloadable report.
"""

from __future__ import annotations

import contextlib
import os
from decimal import Decimal, InvalidOperation
from pathlib import Path

import openpyxl
from celery import shared_task

from apps.products.models import PriceChangeSource, Product, ProductSupplier
from apps.suppliers.models import Supplier
from apps.suppliers.services import record_po_change

IMPORT_DIR = Path("/tmp/syskern_imports")


class _TaskError(RuntimeError):
    """Surface a clean FR message through Celery FAILURE."""


# Header aliases (lower-cased, stripped) → logical column.
_SKU_HEADERS = {
    "sku",
    "sku_code",
    "sku code",
    "référence",
    "reference",
    "code",
    "item",
    "items code",
}
_SUPPLIER_HEADERS = {"fournisseur", "supplier", "fournisseur name", "supplier name"}
_PO_HEADERS = {
    "po",
    "prix",
    "prix d'achat",
    "prix achat",
    "price",
    "po base",
    "prix po",
    "po price",
}


def _norm(value: object) -> str:
    return str(value or "").strip().lower()


def _match_columns(header_row: list) -> dict[str, int]:
    """Resolve the SKU / fournisseur / PO column indices from the header row."""
    mapping: dict[str, int] = {}
    for idx, cell in enumerate(header_row):
        label = _norm(cell)
        if not label:
            continue
        if "sku" not in mapping and (label in _SKU_HEADERS or "sku" in label):
            mapping["sku"] = idx
        elif "supplier" not in mapping and (
            label in _SUPPLIER_HEADERS or "fournisseur" in label or "supplier" in label
        ):
            mapping["supplier"] = idx
        elif "po" not in mapping and (
            label in _PO_HEADERS
            or label == "po"
            or "prix" in label
            or "price" in label
            or "achat" in label
        ):
            mapping["po"] = idx
    return mapping


def _parse_price(raw: object) -> tuple[Decimal | None, str | None]:
    if raw is None or str(raw).strip() == "":
        return None, "PO manquant"
    text = str(raw).strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    try:
        return Decimal(text), None
    except (InvalidOperation, ValueError):
        return None, f"PO invalide : « {raw} »"


def _write_report(task_id: str, rejected: list[dict]) -> str | None:
    """Write the rejected-rows Excel report; return its download URL (or None)."""
    if not rejected:
        return None
    IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Lignes rejetées"
    ws.append(["Ligne", "SKU", "Fournisseur", "PO", "Raison du rejet"])
    for row in rejected:
        ws.append(
            [
                row.get("row"),
                row.get("sku", ""),
                row.get("supplier", ""),
                row.get("po", ""),
                row.get("reason", ""),
            ]
        )
    report_path = IMPORT_DIR / f"{task_id}_report.xlsx"
    wb.save(report_path)
    return f"/api/suppliers/imports/{task_id}/report/"


@shared_task(name="suppliers.import_po_task", bind=True, soft_time_limit=600, time_limit=660)
def import_po_task(self, upload_path: str) -> dict:
    """Parse an uploaded Excel and bulk-update supplier PO base prices.

    Columns: SKU / fournisseur / PO (one row = one SKU-supplier pair).
    - Matching by existing SKU + existing supplier only (never creates a product).
    - SKU or supplier unknown → row rejected + reason (rest keeps going).
    - SKU + supplier known but not yet linked → the link is created (pre-filled).
    - Every applied PO writes a `SupplierPriceHistory` entry (source=import).
    """
    path = Path(upload_path)
    if not path.is_file():
        raise _TaskError("Fichier d'import introuvable.")

    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise _TaskError(f"Fichier Excel illisible : {exc}") from exc

    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    try:
        header = list(next(rows))
    except StopIteration as exc:
        raise _TaskError("Fichier vide.") from exc

    columns = _match_columns(header)
    missing = [c for c in ("sku", "supplier", "po") if c not in columns]
    if missing:
        raise _TaskError(
            "Colonnes attendues introuvables : SKU / fournisseur / PO. "
            f"Manquantes : {', '.join(missing)}."
        )

    data_rows = list(rows)
    total = len(data_rows)
    updated = 0
    created = 0
    rejected: list[dict] = []
    sku_idx, supplier_idx, po_idx = columns["sku"], columns["supplier"], columns["po"]

    for offset, raw_row in enumerate(data_rows):
        row_number = offset + 2  # 1-based + header
        row = list(raw_row)

        def _cell(idx: int, current_row: list = row) -> object:
            return current_row[idx] if idx < len(current_row) else None

        sku = str(_cell(sku_idx) or "").strip()
        supplier_name = str(_cell(supplier_idx) or "").strip()
        po_raw = _cell(po_idx)

        # Skip fully-empty trailing rows silently.
        if not sku and not supplier_name and (po_raw is None or str(po_raw).strip() == ""):
            total -= 1
            continue

        base = {"row": row_number, "sku": sku, "supplier": supplier_name, "po": po_raw}

        if not sku:
            rejected.append({**base, "reason": "SKU manquant"})
            continue
        if not supplier_name:
            rejected.append({**base, "reason": "Fournisseur manquant"})
            continue

        price, price_error = _parse_price(po_raw)
        if price_error:
            rejected.append({**base, "reason": price_error})
            continue

        product = Product.objects.filter(sku_code=sku).first()
        if product is None:
            rejected.append({**base, "reason": "SKU introuvable en base"})
            continue

        supplier = Supplier.objects.filter(name__iexact=supplier_name).first()
        if supplier is None:
            rejected.append({**base, "reason": "Fournisseur introuvable en base"})
            continue

        link = ProductSupplier.objects.filter(product=product, supplier=supplier).first()
        if link is None:
            link = ProductSupplier(
                product=product,
                supplier=supplier,
                supplier_name=supplier.name,
                factory_code=supplier.factory_code_default,
                po_currency=supplier.currency_default,
                incoterm=supplier.incoterm_default,
                incoterm_location=supplier.location,
                is_active=False,
            )
            was_created = True
        else:
            was_created = False

        old_price = link.po_base_price
        link.po_base_price = price
        link.save()
        record_po_change(
            link, old_price=old_price, new_price=price, source=PriceChangeSource.IMPORT
        )

        if was_created:
            created += 1
        else:
            updated += 1

        self.update_state(state="PROGRESS", meta={"current": offset + 1, "total": len(data_rows)})

    report_url = _write_report(self.request.id, rejected)

    # Best-effort cleanup of the raw upload (the report is what the user needs).
    with contextlib.suppress(OSError):
        os.remove(path)

    return {
        "total": total,
        "updated": updated,
        "created": created,
        "rejected": len(rejected),
        "rejected_rows": rejected[:200],
        "report_url": report_url,
    }
