"""Loader for the AYP (Aluminum CCA + LAN copper) supplier PO file (CDC §8.4).

Source file : AYP_LAN Aluminum (CCA) & LAN CU 2026.xlsx
Sheets       : ``AYP CAT6 UTP CCA 2026`` (CCA aluminium) and ``AYP LAN CU 2026`` (cuivre)
Supplier     : AYP — factory code ``91`` (see ``Supplier code list`` in the main Symea file).

Matching strategy
-----------------
Rows carry **Symea / Odoo default codes** (e.g. ``OSEUU64PCCA5``, ``L2SFU64PLZHDWHB``),
not always the UKN ``sku_code`` (``K…``).  The existing ``ProductMatcher`` cascade
(§8.6) is therefore fed as follows:

  * ``MatchHint.sku_code`` = Odoo code (rule 1 if your Stage-1 import stored it as SKU)
  * ``MatchHint.parent_reference`` = same Odoo code
  * ``MatchHint.factory_code`` = ``91``
  * ``MatchHint.category`` = ``CAT|{catalogue}|{type}|`` for rule 3

Rule 2 (parent_reference + factory_code) matches products whose ``parent_reference``
was populated from Odoo with that default code and ``factory_code`` ``91``.

LAN CU sheet: the ``ITEM`` column may list several Odoo codes separated by ``/``.
Each token becomes one logical row (same price / copper / description) so every
variant can match independently.

Pricing
-------
* **CCA sheet** — ``Fixed price RMB/KM`` → ``po_base_price`` in **RMB**, incoterm EXW,
  origin China.
* **LAN CU sheet** — column ``102000.2`` (final computed €/km after header merge) →
  ``po_base_price`` in **EUR**, same incoterm/location.

Copper weight is mapped to ``Product.copper_weight_kg_per_unit``; ``is_copper_indexed``
is set when that weight is strictly positive.  ``ProductSupplier.copper_base_price``
is left unset unless you add metadata parsing later.

``ProductSupplier.is_active`` is never forced to ``True`` (same policy as the other
PO loaders).
"""
from __future__ import annotations

import logging
import re
import time
from decimal import Decimal
from pathlib import Path

import pandas as pd

from apps.core.models import Currency
from apps.products.models import Incoterm, MigrationSource, Product, ProductSupplier

from .base import BaseExcelLoader
from .exceptions import InvalidRowError
from .io import coerce_decimal, coerce_int, coerce_str, read_sheet, row_to_raw
from .matching import ProductMatcher
from .types import LoaderConfig, LoaderReport, MatchHint, NormalizedRow, RowOutcome

logger = logging.getLogger(__name__)

_SHEET_CCA = "AYP CAT6 UTP CCA 2026"
_SHEET_LAN = "AYP LAN CU 2026"
_HEADER_ROW = 1  # 0-based — Excel row 2

_FACTORY_CODE = "91"
_SUPPLIER_NAME = "AYP"
_ORIGIN = "China"
_INCOTERM = Incoterm.EXW

_EXCEL_ERRORS = {"#REF!", "#N/A", "#DIV/0!", "#VALUE!", "#NAME?", "#NULL!", "#NUM!", "#ERROR!"}


def _clean_str(value: object) -> str | None:
    s = coerce_str(value)
    if s is None or s in _EXCEL_ERRORS:
        return None
    s = s.strip()
    return s if s and s != "-" else None


def _split_odoo_codes(cell: object) -> list[str]:
    """Split a slash-separated ITEM cell into normalised Odoo-style codes."""
    raw = coerce_str(cell)
    if not raw:
        return []
    parts = []
    for chunk in raw.split("/"):
        code = chunk.strip().upper()
        if len(code) < 4 or not re.match(r"^[A-Z0-9._-]+$", code):
            continue
        parts.append(code)
    return parts


def _prepare_cca_dataframe(file_path: str) -> pd.DataFrame:
    df, _ = read_sheet(file_path, _SHEET_CCA, _HEADER_ROW)
    rename = {
        "Symea Odoo": "sku_code",
        "Fixed price RMB/KM": "po_price",
        "Copper weight kgs/km": "copper_kg_km",
        "Qty km/plt": "pallet_qty",
        "AYP - CAT6 CCA (Aluminum)": "description_line",
        "CATALOGUE": "catalogue",
        "TYPE": "cable_type",
        "CCA Treatment": "cca_treatment",
        "EUROCLASS": "euroclass",
        "Packing": "packing",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    df["__sheet__"] = "cca"
    df["po_currency"] = Currency.RMB
    if "sku_code" not in df.columns:
        logger.warning("CCA sheet: column 'Symea Odoo' not found after rename — empty dataframe.")
        return pd.DataFrame(
            columns=[
                "sku_code",
                "po_price",
                "po_currency",
                "copper_kg_km",
                "pallet_qty",
                "description_line",
                "catalogue",
                "cable_type",
                "cca_treatment",
                "euroclass",
                "packing",
                "__sheet__",
            ]
        )
    df["sku_code"] = df["sku_code"].map(_clean_str)
    df = df[df["sku_code"].notna()].reset_index(drop=True)
    return df


def _prepare_lan_cu_dataframe(file_path: str) -> pd.DataFrame:
    df, _ = read_sheet(file_path, _SHEET_LAN, _HEADER_ROW)
    empty_cols = [
        "sku_code",
        "po_price",
        "po_currency",
        "copper_kg_km",
        "pallet_qty",
        "description_line",
        "catalogue",
        "cable_type",
        "packing",
        "__sheet__",
    ]
    if df.shape[1] < 20:
        logger.warning("AYP LAN CU sheet has fewer than 20 columns — skipping LAN CU rows.")
        return pd.DataFrame(columns=empty_cols)

    item_col = df.iloc[:, 8]
    desc_col = df.iloc[:, 1]
    cat_col = df.iloc[:, 2]
    typ_col = df.iloc[:, 3]
    pack_col = df.iloc[:, 7]
    copper_col = pd.to_numeric(df.iloc[:, 10], errors="coerce")
    price_col = pd.to_numeric(df.iloc[:, 19], errors="coerce")

    grouped: list[dict[str, object]] = []
    for i in range(len(df)):
        codes = _split_odoo_codes(item_col.iloc[i])
        if not codes:
            continue
        price = price_col.iloc[i]
        if pd.isna(price):
            continue
        cu = copper_col.iloc[i]
        grouped.append(
            {
                "po_price": str(price),
                "po_currency": Currency.EUR,
                "copper_kg_km": "" if pd.isna(cu) else str(cu),
                "pallet_qty": None,
                "description_line": coerce_str(desc_col.iloc[i]),
                "catalogue": coerce_str(cat_col.iloc[i]),
                "cable_type": coerce_str(typ_col.iloc[i]),
                "packing": coerce_str(pack_col.iloc[i]),
                "__sheet__": "lan_cu",
                "__codes__": codes,
            }
        )

    out_rows: list[dict[str, object]] = []
    for r in grouped:
        codes = r.pop("__codes__")
        for code in codes:
            row = dict(r)
            row["sku_code"] = code
            out_rows.append(row)

    return pd.DataFrame(out_rows) if out_rows else pd.DataFrame(columns=empty_cols)


class AYPLoader(BaseExcelLoader):
    """Loader for the AYP CCA + LAN copper Excel price list (two sheets)."""

    migration_source = MigrationSource.EXCEL_PRICING

    def column_mapping(self) -> dict[str, str]:
        return {}

    def required_columns(self) -> set[str]:
        return {"sku_code", "po_price", "__sheet__"}

    def run(self, config: LoaderConfig) -> LoaderReport:  # type: ignore[override]
        start = time.monotonic()
        source_name = Path(config.file_path).name
        logger.info("Starting AYPLoader on %s (dry_run=%s)", source_name, config.dry_run)

        self.pre_run(config)

        report = LoaderReport(
            source_file=source_name,
            sheet_name="AYP CAT6 UTP CCA 2026 + AYP LAN CU 2026",
            dry_run=config.dry_run,
        )
        matcher = ProductMatcher()

        df_cca = _prepare_cca_dataframe(config.file_path)
        cfg_cca = LoaderConfig(
            file_path=config.file_path,
            sheet_name=_SHEET_CCA,
            header_row=_HEADER_ROW,
            batch_size=config.batch_size,
            dry_run=config.dry_run,
        )
        if not df_cca.empty:
            self._validate_header(df_cca)
            self._run_dataframe(df_cca, cfg_cca, matcher, report, source_name)

        df_lan = _prepare_lan_cu_dataframe(config.file_path)
        cfg_lan = LoaderConfig(
            file_path=config.file_path,
            sheet_name=_SHEET_LAN,
            header_row=_HEADER_ROW,
            batch_size=config.batch_size,
            dry_run=config.dry_run,
        )
        if not df_lan.empty:
            self._validate_header(df_lan)
            self._run_dataframe(df_lan, cfg_lan, matcher, report, source_name)

        report.duration_seconds = time.monotonic() - start
        logger.info("Finished AYPLoader:\n%s", report)
        return report

    def pre_run(self, config: LoaderConfig) -> None:  # noqa: B027
        """Reserved for future AYP header metadata (FX, copper bases)."""

    def normalize_row(self, raw: pd.Series) -> NormalizedRow:
        sheet = coerce_str(raw.get("__sheet__")) or ""
        sku = _clean_str(raw.get("sku_code"))
        price_s = coerce_decimal(raw.get("po_price"))
        if not price_s:
            raise InvalidRowError("po_price is empty")
        price = Decimal(price_s)

        cu_s = coerce_decimal(raw.get("copper_kg_km"))
        copper = Decimal(cu_s) if cu_s else None

        pqty = coerce_int(raw.get("pallet_qty"))

        data: dict[str, object] = {
            "sku_code": sku,
            "po_price": price,
            "po_currency": raw.get("po_currency") or Currency.RMB,
            "copper_kg_km": copper,
            "pallet_qty": pqty,
            "description_line": _clean_str(raw.get("description_line")),
            "catalogue": _clean_str(raw.get("catalogue")),
            "cable_type": _clean_str(raw.get("cable_type")),
            "cca_treatment": _clean_str(raw.get("cca_treatment")),
            "euroclass": _clean_str(raw.get("euroclass")),
            "packing": _clean_str(raw.get("packing")),
            "__sheet__": sheet,
        }
        return NormalizedRow(data=data, raw=row_to_raw(raw))

    def build_match_hint(self, row: NormalizedRow) -> MatchHint:
        d = row.data
        code = (d.get("sku_code") or "").strip().upper()
        # Rule 3 would require the same category_key as in DB (universe|family|range|sub_range).
        # AYP sheets do not carry that hierarchy — leave category unset and rely on
        # rule 1 (sku_code = Odoo code) or rule 2 (parent_reference + factory 91).
        return MatchHint(
            sku_code=code or None,
            parent_reference=code or None,
            factory_code=_FACTORY_CODE,
            category=None,
        )

    def apply_update(self, product: Product, row: NormalizedRow) -> RowOutcome:
        d = row.data
        self._update_product(product, d)
        self._upsert_supplier(product, d)
        return RowOutcome(row_number=0, matched=True, updated=True, quarantined=False)

    def _update_product(self, product: Product, d: dict[str, object]) -> None:
        changed = False

        def _set(field: str, value: object) -> None:
            nonlocal changed
            if value is not None and getattr(product, field) != value:
                setattr(product, field, value)
                changed = True

        copper = d.get("copper_kg_km")
        if isinstance(copper, Decimal):
            _set("copper_weight_kg_per_unit", copper)
            new_ix = copper > 0
            if product.is_copper_indexed != new_ix:
                product.is_copper_indexed = new_ix
                changed = True

        _set("pallet_qty", d.get("pallet_qty"))

        desc = d.get("description_line")
        if isinstance(desc, str) and desc:
            parts = [desc]
            if d.get("packing"):
                parts.append(str(d["packing"]))
            en = " — ".join(parts)
            existing = dict(product.description_marketing or {})
            if existing.get("en") != en:
                existing["en"] = en
                product.description_marketing = existing
                changed = True

        if changed:
            product.save()

    def _upsert_supplier(self, product: Product, d: dict[str, object]) -> None:
        price = d.get("po_price")
        if not isinstance(price, Decimal):
            raise InvalidRowError("po_price missing after normalise")
        currency = d.get("po_currency") or Currency.RMB
        if not isinstance(currency, str):
            currency = str(currency)

        copper = d.get("copper_kg_km")
        is_cu = isinstance(copper, Decimal) and copper > 0

        notes_parts = [f"AYP sheet={d.get('__sheet__')}"]
        if d.get("euroclass"):
            notes_parts.append(f"CPR/Euroclass: {d['euroclass']}")

        supplier, created = ProductSupplier.objects.get_or_create(
            product=product,
            factory_code=_FACTORY_CODE,
            defaults={"supplier_name": _SUPPLIER_NAME, "is_active": False},
        )
        supplier.supplier_name = _SUPPLIER_NAME
        supplier.po_base_price = price
        supplier.po_currency = currency
        supplier.incoterm = _INCOTERM
        supplier.incoterm_location = _ORIGIN
        supplier.is_copper_indexed = is_cu
        supplier.notes = " | ".join(notes_parts)
        supplier.save()

        logger.debug(
            "ProductSupplier %s: %s price=%s %s",
            "created" if created else "updated",
            product.sku_code,
            price,
            currency,
        )
