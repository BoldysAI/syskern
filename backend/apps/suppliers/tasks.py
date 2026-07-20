"""Celery tasks for the Fournisseurs PO import wizard (Épic FEEDBACK 1).

Two-phase flow (AGENTS §4: never parse a file on a request thread):
- ``import_po_preview_task`` — dry-run resolution for the synthesis step
  (no DB writes), returns ``{summary, lines}``.
- ``import_po_apply_task`` — applies the actionable rows, writes
  ``SupplierPriceHistory`` and the downloadable rejection report.

Both take an explicit ``column_map`` (user-provided mapping) and an optional
``supplier_id`` used as the default supplier when a row has no mapped supplier.
Matching is by existing SKU / existing supplier only — never creates a product,
never creates a supplier.
"""

from __future__ import annotations

import contextlib
import os
from pathlib import Path

import openpyxl
from celery import shared_task

from apps.suppliers.models import Supplier
from apps.suppliers.services_import import apply_import, preview_import

IMPORT_DIR = Path("/tmp/syskern_imports")


class _TaskError(RuntimeError):
    """Surface a clean FR message through Celery FAILURE."""


def _load_default_supplier(supplier_id: str | None) -> Supplier | None:
    if not supplier_id:
        return None
    supplier = Supplier.objects.filter(pk=supplier_id).first()
    if supplier is None:
        raise _TaskError("Fournisseur sélectionné introuvable.")
    return supplier


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


@shared_task(
    name="suppliers.import_po_preview_task", bind=True, soft_time_limit=600, time_limit=660
)
def import_po_preview_task(
    self, upload_path: str, column_map: dict, supplier_id: str | None = None, header_row: int = 1
) -> dict:
    """Dry-run the mapped import — returns ``{summary, lines}`` (no DB writes)."""
    path = Path(upload_path)
    if not path.is_file():
        raise _TaskError("Fichier d'import introuvable ou expiré.")

    default_supplier = _load_default_supplier(supplier_id)

    def _progress(current: int, total: int) -> None:
        self.update_state(state="PROGRESS", meta={"current": current, "total": total})

    try:
        return preview_import(
            path,
            column_map=column_map,
            default_supplier=default_supplier,
            header_row=header_row,
            progress=_progress,
        )
    except ValueError as exc:
        raise _TaskError(str(exc)) from exc


@shared_task(name="suppliers.import_po_apply_task", bind=True, soft_time_limit=600, time_limit=660)
def import_po_apply_task(
    self, upload_path: str, column_map: dict, supplier_id: str | None = None, header_row: int = 1
) -> dict:
    """Apply the mapped import and write the rejection report."""
    path = Path(upload_path)
    if not path.is_file():
        raise _TaskError("Fichier d'import introuvable ou expiré.")

    default_supplier = _load_default_supplier(supplier_id)

    def _progress(current: int, total: int) -> None:
        self.update_state(state="PROGRESS", meta={"current": current, "total": total})

    try:
        result = apply_import(
            path,
            column_map=column_map,
            default_supplier=default_supplier,
            header_row=header_row,
            progress=_progress,
        )
    except ValueError as exc:
        raise _TaskError(str(exc)) from exc

    report_url = _write_report(self.request.id, result.get("rejected_rows", []))

    # Best-effort cleanup of the raw upload (the report is what the user needs).
    with contextlib.suppress(OSError):
        os.remove(path)

    return {
        "total": result["total"],
        "updated": result["updated"],
        "created": result["created"],
        "rejected": result["rejected"],
        "rejected_rows": result.get("rejected_rows", [])[:200],
        "report_url": report_url,
    }
