"""Loader for the Infoks fiber optic cable PO file (CDC §8.4 — Étape 2).

Source file : SYMEA_FO_2026_PRICES LIST_INFOKS (FIBRE OPTIQUE).xlsx
Sheet       : 'SYMEA FO 2026'
Header row  : 4 (0-based index 3)
Supplier    : Infoks (via Symea Shanghai), origin: Turkey
Products    : Fiber optic cables (OM3, OM4, OM5, OS2) — 197 data rows

Column mapping (row 4 = header)
---------------------------------
  col  3  — Items code             → sku_code
  col  0  — Sub-Range              → sub_range
  col  1  — Infoks Ranges Codes    → infoks_range_code (supplier ref, stored in notes)
  col  2  — Type                   → cable_type
  col  4  — CPR                    → cpr_tag
  col  5  — Description En         → description_en
  col  6  — Individual Packing     → individual_packing
  col  7  — MOQ KM                 → moq_km
  col  8  — HS code                → hs_code
  col  9  — Supplier Payment term  → payment_term
  col 16  — Ex Works Istanbul EUR/KM (2026, FINAL PRICES SYMEA) → po_base_price
  col 21  — DDP Reau EUR/KM        → ddp_price (stored in notes, not po_base_price)

Price policy
------------
``po_base_price`` = col 16 (EXW Istanbul, 2026 Symea/Syskern price).
``incoterm`` = EXW, ``po_currency`` = EUR.
No copper indexation (fiber cables use glass, not copper).

The ``ddp_price`` (col 21) is stored in the supplier notes for reference.

HS code quirk
-------------
openpyxl reads HS codes like 854470000000 as large integers (scientific
notation in Excel).  We normalise to the 6-digit trade code by stripping
trailing zeros: 854470000000 → "854470".
"""

from __future__ import annotations

import logging
from decimal import Decimal

import pandas as pd

from apps.core.models import Currency
from apps.products.models import Incoterm, MigrationSource, Product, ProductSupplier

from .base import BaseExcelLoader
from .exceptions import InvalidRowError
from .io import coerce_decimal, coerce_int, coerce_str, row_to_raw
from .types import MatchHint, NormalizedRow, RowOutcome

logger = logging.getLogger(__name__)

_SUPPLIER_NAME = "Infoks"
_TRADING_COMPANY = "Symea Shanghai"
_FACTORY_CODE = "E04"  # Infoks factory code from supplier code list
_INCOTERM = Incoterm.EXW
_PO_CURRENCY = Currency.EUR
_ORIGIN = "Turkey"


def _normalise_hs(value: object) -> str | None:
    """Normalise HS code from large-integer form to 6-digit string.

    Excel stores HS codes like 854470000000 (trailing zeros pad to 12 digits).
    We strip trailing zeros and keep the meaningful prefix: "854470".
    If the result is not 6 digits, return as-is (edge case).
    """
    if value is None:
        return None
    try:
        raw = str(int(float(str(value))))  # e.g. "854470000000"
        # HS codes are 6 digits; Excel pads them with trailing zeros to 12 digits.
        # We take the first 6 digits only when the remainder is all zeros.
        if len(raw) > 6 and raw[6:].lstrip("0") == "":
            return raw[:6]
        return raw
    except (ValueError, TypeError):
        s = coerce_str(value)
        return s if s else None


class INFOKSLoader(BaseExcelLoader):
    """Loader for the Infoks / Symea FO fiber optic price list."""

    migration_source = MigrationSource.EXCEL_PRICING

    # ── Column mapping ────────────────────────────────────────────────────────

    def column_mapping(self) -> dict[str, str]:
        return {
            "Items code": "sku_code",
            "Sub-Range": "sub_range",
            "Infoks Ranges Codes ": "infoks_range_code",
            "Type": "cable_type",
            "CPR": "cpr_tag",
            "Description En": "description_en",
            "Individual Packing": "individual_packing",
            "MOQ KM": "moq_km",
            "HS code": "hs_code",
            "Supplier Payment term": "payment_term",
            # col 16: EXW Istanbul 2026 (FINAL PRICES SYMEA)
            # The header says "Ex Works Istanbul EUR/KM" — after rename we
            # disambiguate by position.  pandas keeps duplicate column names
            # as-is; we access by positional index in normalize_row instead.
        }

    def required_columns(self) -> set[str]:
        return {"sku_code"}

    # ── Row normalisation ─────────────────────────────────────────────────────

    def normalize_row(self, raw: pd.Series) -> NormalizedRow:
        sku = coerce_str(raw.get("sku_code"))

        # Price cols have duplicate names in the Excel header.
        # After pandas reads them, duplicates become "Ex Works Istanbul EUR/KM",
        # "Ex Works Istanbul EUR/KM.1", ".2", etc.
        # col 16 → index 6 of the duplicate group (0-based: col 10, 12, 13, 14, 16 = idx 4 = ".4")
        # More robustly: access by positional index directly from raw.
        # raw is a pd.Series with column-name keys.  For duplicates, pandas
        # appends ".N" suffixes starting at ".1" for the second occurrence.
        def _missing_price_cell(v: object) -> bool:
            """True when the cell has no usable value (do not treat 0 as missing)."""
            if v is None:
                return True
            try:
                if pd.isna(v):
                    return True
            except (TypeError, ValueError):
                pass
            return bool(isinstance(v, str) and not str(v).strip())

        def _price_by_pos(pos_name: str, fallback: str | None = None) -> Decimal | None:
            v = raw.get(pos_name)
            if _missing_price_cell(v) and fallback:
                v = raw.get(fallback)
            s = coerce_decimal(v)
            return Decimal(s) if s else None

        # "Ex Works Istanbul EUR/KM" → col 10 (2025)
        # "Ex Works Istanbul EUR/KM.1" → col 12 (2025 OFS)
        # "Ex Works Istanbul EUR/KM.2" → col 13 (2026 DRAKA OM3-OM4-OM5)
        # "Ex Works Istanbul EUR/KM.3" → col 14 (2026 DRAKA OM3-150/OFS OM4-400)
        # "Ex Works Istanbul EUR/KM.4" → col 16 (2026 FINAL PRICES SYMEA) ← we want this
        # "Ex Works Istanbul EUR/KM.5" → col 20 (2026 FINAL PRICES Syskern)
        exw_price = _price_by_pos("Ex Works Istanbul EUR/KM.4", "Ex Works Istanbul EUR/KM.3")
        ddp_price = _price_by_pos("DDP Reau EUR/KM")

        hs_raw = raw.get("hs_code")
        hs_code = _normalise_hs(hs_raw)

        notes_parts = []
        if ddp_price is not None:
            notes_parts.append(f"DDP Reau: {ddp_price} EUR/km")
        range_code = coerce_str(raw.get("infoks_range_code"))
        if range_code:
            notes_parts.append(f"Infoks range: {range_code}")
        pay = coerce_str(raw.get("payment_term"))
        if pay:
            notes_parts.append(f"Payment: {pay}")
        moq = coerce_int(raw.get("moq_km"))
        if moq is not None:
            notes_parts.append(f"MOQ: {moq} km")

        data = {
            "sku_code": sku,
            "sub_range": coerce_str(raw.get("sub_range")),
            "cable_type": coerce_str(raw.get("cable_type")),
            "cpr_tag": coerce_str(raw.get("cpr_tag")),
            "description_en": coerce_str(raw.get("description_en")),
            "individual_packing": coerce_str(raw.get("individual_packing")),
            "hs_code": hs_code,
            "exw_price": exw_price,
            "ddp_price": ddp_price,
            "notes": " | ".join(notes_parts),
        }
        return NormalizedRow(data=data, raw=row_to_raw(raw))

    # ── Match hint ────────────────────────────────────────────────────────────

    def build_match_hint(self, row: NormalizedRow) -> MatchHint:
        sku = row.data.get("sku_code")
        sub = row.data.get("sub_range") or ""
        cable_type = row.data.get("cable_type") or ""
        category = f"FO|{sub.upper()}|{cable_type.upper()}|" if any([sub, cable_type]) else None
        return MatchHint(
            sku_code=sku,
            parent_reference=sku,
            factory_code=_FACTORY_CODE,
            category=category,
        )

    # ── DB update ─────────────────────────────────────────────────────────────

    def apply_update(self, product: Product, row: NormalizedRow) -> RowOutcome:
        self._update_product(product, row)
        self._upsert_supplier(product, row)
        return RowOutcome(row_number=0, matched=True, updated=True, quarantined=False)

    def _update_product(self, product: Product, row: NormalizedRow) -> None:
        d = row.data
        changed = False

        def _set(field: str, value: object) -> None:
            nonlocal changed
            if value is not None and getattr(product, field) != value:
                setattr(product, field, value)
                changed = True

        _set("hs_code", d.get("hs_code"))

        desc = d.get("description_en")
        if desc:
            existing = dict(product.description_marketing or {})
            if existing.get("en") != desc:
                existing["en"] = desc
                product.description_marketing = existing
                changed = True

        if changed:
            product.save()

    def _upsert_supplier(self, product: Product, row: NormalizedRow) -> None:
        d = row.data
        exw_price = d.get("exw_price")
        if exw_price is None:
            raise InvalidRowError(f"exw_price missing for {d.get('sku_code')!r}")

        supplier, created = ProductSupplier.objects.get_or_create(
            product=product,
            factory_code=_FACTORY_CODE,
            defaults={
                "supplier_name": _SUPPLIER_NAME,
                "is_active": False,
            },
        )
        supplier.supplier_name = _SUPPLIER_NAME
        supplier.po_base_price = exw_price
        supplier.po_currency = _PO_CURRENCY
        supplier.incoterm = _INCOTERM
        supplier.incoterm_location = _ORIGIN
        # Le PO INFOKS ne porte pas de donnée cuivre : `None` = hérite du produit
        # (FEEDBACK 2). Forcer `False` désindexerait à tort un SKU cuivre.
        supplier.is_copper_indexed = None
        if d.get("notes"):
            supplier.notes = d["notes"]
        supplier.save()

        logger.debug(
            "ProductSupplier %s: product=%s exw=%.2f EUR",
            "created" if created else "updated",
            product.sku_code,
            exw_price,
        )
