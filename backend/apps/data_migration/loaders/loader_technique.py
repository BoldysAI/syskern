"""Loader for the technical / GTIN attributes file (CDC §8.4 — Étape 2).

Source file  : UKN all items list - GTIN code & packing details.xlsx
              (under data/Base Technique/)
Sheets       : 3 brand-specific sheets processed in sequence
               1. 'GTIN code & packing details'     — UKN brand
               2. 'NEXKERN GTIN code & packing'      — NEXKERN brand
               3. 'ORSEAN GTIN code & packing'       — ORSEAN brand
migration_source : EXCEL_TECHNICAL

What this loader does
---------------------
For each sheet, renamed headers are checked against the expected canonical
columns; any mismatch raises ``HeaderValidationError`` (same contract as
``BaseExcelLoader``) instead of silently skipping the sheet.

For each row it:
  1. Matches the product via sku_code (rule 1 — §8.6 cascade).
  2. Enriches direct Product fields:
       gtin, copper_weight_kg_per_unit, is_copper_indexed,
       unit_weight_kg (when unit is kg), pallet_qty, dop_number,
       description_marketing['en'] / ['fr'] (Sticker ENG/FR).
  3. Upserts 3 EAV attributes (created by pre_run if absent):
       cpr_level (text, technical)
       od_mm     (text, technical)   — UKN sheet only
       uid_code  (text, structural)  — UKN and NEXKERN sheets

Deduplication (UKN sheet only)
-------------------------------
33 UKN SKUs appear twice — one row per manufacturing origin
(China -21 suffix, Turkey -E02 suffix).  Both rows point to the same
Product record; they must be merged before matching to avoid a spurious
DUPLICATE_MATCH.

Strategy: dedup_key() returns the sku_code for UKN rows (keyed by the
``__brand__`` sentinel column inserted by _prepare_sheet_df) and ``None``
for NEXKERN / ORSEAN rows.  The default merge_rows() keeps the most-complete
row (China) and fills gaps from Turkey.

Conservative update policy
---------------------------
Direct Product fields are written only when the incoming value is non-null
and not an Excel error string.  description_marketing keys are never
overwritten if the existing value is non-empty — a PO loader may have
written a better description already.

EAV upsert
----------
pre_run() calls get_or_create() once per AttributeRegistry code so the
registry entries exist before any row is processed.  apply_update() then
calls update_or_create() on ProductAttributeValue with the non-null value.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import ClassVar

import pandas as pd
from django.db import connection

from apps.data_migration.derivations import derive_factory_code, derive_parent_reference
from apps.attributes.models import (
    AttributeCategory,
    AttributeDataType,
    AttributeRegistry,
    ProductAttributeValue,
)
from apps.products.models import MigrationSource, Product

from .base import BaseExcelLoader
from .exceptions import HeaderValidationError, LoaderError
from .io import coerce_decimal, coerce_int, coerce_str, read_sheet, row_to_raw
from .matching import ProductMatcher
from .types import LoaderConfig, LoaderReport, MatchHint, NormalizedRow, RowOutcome

logger = logging.getLogger(__name__)

_TECH_FILE_PATH_DEFAULT = "data/Base Technique/UKN all items list - GTIN code & packing details.xlsx"

# Excel error strings to treat as missing
_EXCEL_ERRORS = {"#REF!", "#N/A", "#DIV/0!", "#VALUE!", "#NAME?", "#NULL!", "#NUM!", "#ERROR!"}


def _clean(value: object) -> str | None:
    s = coerce_str(value)
    if s is None or s in _EXCEL_ERRORS or s.strip() == "-":
        return None
    return s


# ── EAV attribute definitions ──────────────────────────────────────────────────

@dataclass(frozen=True)
class _EAVDef:
    code: str
    label_fr: str
    label_en: str
    data_type: str
    category: str
    unit: str = ""


_EAV_ATTRS: ClassVar[list[_EAVDef]] = [
    _EAVDef("cpr_level", "Niveau CPR", "CPR Level", AttributeDataType.TEXT, AttributeCategory.TECHNICAL),
    _EAVDef("od_mm", "Diamètre extérieur (mm)", "Outer Diameter (mm)", AttributeDataType.TEXT, AttributeCategory.TECHNICAL, unit="mm"),
    _EAVDef("uid_code", "Code UID produit", "Product UID Code", AttributeDataType.TEXT, AttributeCategory.STRUCTURAL),
]

# ── Sheet profile ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TechSheetProfile:
    """Column layout and processing flags for one technical sheet."""
    sheet_name: str
    brand_tag: str           # sentinel stored in __brand__ column
    # Canonical column names used AFTER column_mapping() rename
    sku_col: str             # always 'sku_code' after rename
    internal_code_col: str | None
    desc_en_col: str
    cpr_col: str             # CPR level canonical name
    od_col: str | None       # OD (mm) — absent on NEXKERN/ORSEAN
    cu_col: str
    net_content_col: str
    net_unit_col: str
    gtin_col: str
    pallet_col: str
    uid_col: str | None      # UID Code — absent on ORSEAN
    dop_col: str | None      # DoP — absent on ORSEAN
    sticker_en_col: str
    sticker_fr_col: str
    has_dedup: bool


# Column rename maps per sheet (Excel name → canonical name after read_sheet)
_UKN_RENAME: dict[str, str] = {
    "Unikkern Items code": "sku_code",
    "Internal Code": "internal_code",
    "Description En": "description_en",
    "CPR level": "cpr_level",
    "OD (mm)": "od_mm",
    "Cu (kg/km)": "cu_kg_km",
    "Per Product Net Content": "net_content",
    "Per Product Net Content (Unit)": "net_unit",
    "Global Trade Item Number (GTIN)": "gtin",
    "QTY/Pallet": "pallet_qty",
    "UID Code": "uid_code",
    "DoP": "dop_number",
    "Sticker ENG": "sticker_en",
    "Sticker FR": "sticker_fr",
}

_NX_RENAME: dict[str, str] = {
    "Unikkern Items code": "sku_code",
    "Description En": "description_en",
    "CPR": "cpr_level",
    "Cu (kg/km)": "cu_kg_km",
    "Per Product Net Content": "net_content",
    "Per Product Net Content (Unit)": "net_unit",
    "Global Trade Item Number (GTIN)": "gtin",
    "QTY/Pallet": "pallet_qty",
    "UID Code": "uid_code",
    "DoP": "dop_number",
    "Sticker ENG": "sticker_en",
    "Sticker FR": "sticker_fr",
}

_OR_RENAME: dict[str, str] = {
    "Unikkern Items code": "sku_code",
    "Description En": "description_en",
    "CPR": "cpr_level",
    "Cu (kg/km)": "cu_kg_km",
    "Per Product Net Content": "net_content",
    "Per Product Net Content (Unit)": "net_unit",
    "Global Trade Item Number (GTIN)": "gtin",
    "QTY/Pallet": "pallet_qty",
    "Sticker ENG": "sticker_en",
    "Sticker FR": "sticker_fr",
}

_SHEET_PROFILES: ClassVar[list[TechSheetProfile]] = [
    TechSheetProfile(
        sheet_name="GTIN code & packing details",
        brand_tag="ukn",
        sku_col="sku_code",
        internal_code_col="internal_code",
        desc_en_col="description_en",
        cpr_col="cpr_level",
        od_col="od_mm",
        cu_col="cu_kg_km",
        net_content_col="net_content",
        net_unit_col="net_unit",
        gtin_col="gtin",
        pallet_col="pallet_qty",
        uid_col="uid_code",
        dop_col="dop_number",
        sticker_en_col="sticker_en",
        sticker_fr_col="sticker_fr",
        has_dedup=True,
    ),
    TechSheetProfile(
        sheet_name="NEXKERN GTIN code & packing",
        brand_tag="nexkern",
        sku_col="sku_code",
        internal_code_col=None,
        desc_en_col="description_en",
        cpr_col="cpr_level",
        od_col=None,
        cu_col="cu_kg_km",
        net_content_col="net_content",
        net_unit_col="net_unit",
        gtin_col="gtin",
        pallet_col="pallet_qty",
        uid_col="uid_code",
        dop_col="dop_number",
        sticker_en_col="sticker_en",
        sticker_fr_col="sticker_fr",
        has_dedup=False,
    ),
    TechSheetProfile(
        sheet_name="ORSEAN GTIN code & packing",
        brand_tag="orsean",
        sku_col="sku_code",
        internal_code_col=None,
        desc_en_col="description_en",
        cpr_col="cpr_level",
        od_col=None,
        cu_col="cu_kg_km",
        net_content_col="net_content",
        net_unit_col="net_unit",
        gtin_col="gtin",
        pallet_col="pallet_qty",
        uid_col=None,
        dop_col=None,
        sticker_en_col="sticker_en",
        sticker_fr_col="sticker_fr",
        has_dedup=False,
    ),
]

_RENAME_MAP: dict[str, dict[str, str]] = {
    "GTIN code & packing details": _UKN_RENAME,
    "NEXKERN GTIN code & packing": _NX_RENAME,
    "ORSEAN GTIN code & packing": _OR_RENAME,
}


def _required_columns_for_profile(profile: TechSheetProfile) -> set[str]:
    """Canonical columns that must exist after rename for this sheet (CDC header check)."""
    names = {
        profile.sku_col,
        profile.desc_en_col,
        profile.cpr_col,
        profile.cu_col,
        profile.net_content_col,
        profile.net_unit_col,
        profile.gtin_col,
        profile.pallet_col,
        profile.sticker_en_col,
        profile.sticker_fr_col,
    }
    if profile.internal_code_col:
        names.add(profile.internal_code_col)
    if profile.od_col:
        names.add(profile.od_col)
    if profile.uid_col:
        names.add(profile.uid_col)
    if profile.dop_col:
        names.add(profile.dop_col)
    return names


def _prepare_sheet_df(file_path: str, profile: TechSheetProfile) -> pd.DataFrame:
    """Read one technical sheet and normalise to canonical column names (see TechniqueLoader)."""
    return TechniqueLoader()._prepare_sheet_dataframe(file_path, profile)


# ── Loader ─────────────────────────────────────────────────────────────────────


class TechniqueLoader(BaseExcelLoader):
    """Loader for the UKN / NEXKERN / ORSEAN technical attributes Excel file."""

    migration_source = MigrationSource.EXCEL_TECHNICAL

    def __init__(self) -> None:
        # Populated by pre_run(); maps code → AttributeRegistry instance
        self._eav_registry: dict[str, AttributeRegistry] = {}
        # Set only while _validate_header() runs for a given sheet (multi-sheet loader)
        self._active_tech_profile: TechSheetProfile | None = None

    def _prepare_sheet_dataframe(self, file_path: str, profile: TechSheetProfile) -> pd.DataFrame:
        """Read one sheet, rename to canonical headers, validate, then drop blank SKU rows."""
        df, _ = read_sheet(file_path, profile.sheet_name, 0)
        rename = _RENAME_MAP[profile.sheet_name]
        df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})

        self._active_tech_profile = profile
        try:
            self._validate_header(df)
        finally:
            self._active_tech_profile = None

        df = df[df["sku_code"].notna() & (df["sku_code"] != "nan")].reset_index(drop=True)
        df["__brand__"] = profile.brand_tag
        return df

    def _validate_header(self, df: pd.DataFrame) -> None:
        """Require per-sheet canonical columns; then apply base ``required_columns()``."""
        profile = self._active_tech_profile
        if profile is not None:
            required = _required_columns_for_profile(profile)
            missing = required - set(df.columns)
            if missing:
                raise HeaderValidationError(missing)
        super()._validate_header(df)

    # ── pre_run: create / fetch EAV registry entries once ─────────────────────

    def pre_run(self, config: LoaderConfig) -> None:
        """Ensure the 3 EAV AttributeRegistry entries exist before row processing."""
        if "attribute_registry" not in connection.introspection.table_names():
            raise LoaderError(
                "Table attribute_registry does not exist. "
                "Apply migrations first: python manage.py migrate"
            )
        for eav in _EAV_ATTRS:
            obj, created = AttributeRegistry.objects.get_or_create(
                code=eav.code,
                defaults={
                    "label": {"fr": eav.label_fr, "en": eav.label_en},
                    "data_type": eav.data_type,
                    "category": eav.category,
                    "unit": eav.unit,
                    "is_required": False,
                    "is_searchable": True,
                },
            )
            self._eav_registry[eav.code] = obj
            logger.debug("AttributeRegistry %r: %s", eav.code, "created" if created else "exists")

    # ── Override run() to iterate all 3 sheets ─────────────────────────────────

    def run(self, config: LoaderConfig) -> LoaderReport:  # type: ignore[override]
        start = time.monotonic()
        source_name = Path(config.file_path).name
        logger.info("Starting TechniqueLoader on %s (dry_run=%s)", source_name, config.dry_run)

        self.pre_run(config)

        report = LoaderReport(
            source_file=source_name,
            sheet_name="(all 3 brand sheets)",
            dry_run=config.dry_run,
        )
        matcher = ProductMatcher()

        for profile in _SHEET_PROFILES:
            df = self._prepare_sheet_dataframe(config.file_path, profile)
            if df.empty:
                logger.info("  Sheet %r: no data rows — skipped.", profile.sheet_name)
                continue
            logger.info("  Sheet %r: %d rows to process.", profile.sheet_name, len(df))
            sheet_config = LoaderConfig(
                file_path=config.file_path,
                sheet_name=profile.sheet_name,
                header_row=0,
                batch_size=config.batch_size,
                dry_run=config.dry_run,
            )
            self._run_dataframe(df, sheet_config, matcher, report, source_name)

        report.duration_seconds = time.monotonic() - start
        logger.info("Finished TechniqueLoader:\n%s", report)
        return report

    # ── column_mapping / required_columns ────────────────────────────────────

    def column_mapping(self) -> dict[str, str]:
        # Renaming is done per-sheet in _prepare_sheet_df before _run_dataframe.
        # By the time normalize_row() is called, columns already have canonical names.
        return {}

    def required_columns(self) -> set[str]:
        return {"sku_code"}

    # ── dedup_key: merge China + Turkey rows for UKN sheet only ──────────────

    def dedup_key(self, row: NormalizedRow) -> str | None:
        brand = row.data.get("__brand__")
        if brand != "ukn":
            return None
        sku = row.data.get("sku_code")
        return str(sku).upper() if sku else None

    # ── normalize_row ─────────────────────────────────────────────────────────

    def normalize_row(self, raw: pd.Series) -> NormalizedRow:
        sku = _clean(raw.get("sku_code"))
        brand = coerce_str(raw.get("__brand__")) or ""

        # Copper weight
        cu_s = coerce_decimal(raw.get("cu_kg_km"))
        copper = Decimal(cu_s) if cu_s else None

        # Unit weight — only import when unit contains "kg"
        net_unit = coerce_str(raw.get("net_unit")) or ""
        net_s = coerce_decimal(raw.get("net_content")) if "kg" in net_unit.lower() else None
        unit_weight = Decimal(net_s) if net_s else None

        pallet = coerce_int(raw.get("pallet_qty"))

        # Descriptions — Sticker ENG/FR
        sticker_en = _clean(raw.get("sticker_en"))
        sticker_fr = _clean(raw.get("sticker_fr"))

        # EAV values — treat #REF! / #N/A as absent
        cpr = _clean(raw.get("cpr_level"))
        od = _clean(raw.get("od_mm"))
        uid = _clean(raw.get("uid_code"))
        dop = _clean(raw.get("dop_number"))
        gtin = _clean(raw.get("gtin"))

        # factory_code hint from internal_code suffix (UKN only).
        # derive_factory_code() enforces the -NN/-ENN pattern from CDC §8.5,
        # replacing the previous rsplit which accepted any alphabetic suffix.
        internal = _clean(raw.get("internal_code"))
        factory_code = derive_factory_code(internal) if internal else None

        data: dict[str, object] = {
            "sku_code": sku,
            "__brand__": brand,
            "gtin": gtin,
            "copper_kg_km": copper,
            "unit_weight_kg": unit_weight,
            "pallet_qty": pallet,
            "dop_number": dop,
            "sticker_en": sticker_en,
            "sticker_fr": sticker_fr,
            "eav_cpr_level": cpr,
            "eav_od_mm": od,
            "eav_uid_code": uid,
            "factory_code": factory_code,
        }
        return NormalizedRow(data=data, raw=row_to_raw(raw))

    # ── build_match_hint ──────────────────────────────────────────────────────

    def build_match_hint(self, row: NormalizedRow) -> MatchHint:
        d = row.data
        sku = (d.get("sku_code") or "").strip().upper() or None
        factory = d.get("factory_code")
        # For the technical file, sku_code may carry a factory suffix
        # (e.g. "KCFF6A4-21").  derive_parent_reference strips it; fall back
        # to the full sku when no suffix is present.
        parent = derive_parent_reference(sku) if sku else None
        return MatchHint(
            sku_code=sku,
            parent_reference=parent or sku,
            factory_code=factory,
            category=None,
        )

    # ── apply_update ──────────────────────────────────────────────────────────

    def apply_update(self, product: Product, row: NormalizedRow) -> RowOutcome:
        d = row.data
        self._update_product_fields(product, d)
        self._upsert_eav(product, d)
        return RowOutcome(row_number=0, matched=True, updated=True, quarantined=False)

    def _update_product_fields(self, product: Product, d: dict[str, object]) -> None:
        changed = False

        def _set(field: str, value: object) -> None:
            nonlocal changed
            if value is not None and getattr(product, field) != value:
                setattr(product, field, value)
                changed = True

        _set("gtin", d.get("gtin"))
        _set("dop_number", d.get("dop_number"))
        _set("pallet_qty", d.get("pallet_qty"))

        copper = d.get("copper_kg_km")
        if isinstance(copper, Decimal):
            _set("copper_weight_kg_per_unit", copper)
            new_ix = copper > 0
            if product.is_copper_indexed != new_ix:
                product.is_copper_indexed = new_ix
                changed = True

        uw = d.get("unit_weight_kg")
        if isinstance(uw, Decimal):
            _set("unit_weight_kg", uw)

        # Descriptions: only fill in, never overwrite existing non-empty value
        desc = dict(product.description_marketing or {})
        updated_desc = False
        if d.get("sticker_en") and not desc.get("en"):
            desc["en"] = d["sticker_en"]
            updated_desc = True
        if d.get("sticker_fr") and not desc.get("fr"):
            desc["fr"] = d["sticker_fr"]
            updated_desc = True
        if updated_desc and desc != product.description_marketing:
            product.description_marketing = desc
            changed = True

        if changed:
            product.save()

    def _upsert_eav(self, product: Product, d: dict[str, object]) -> None:
        eav_map = {
            "cpr_level": d.get("eav_cpr_level"),
            "od_mm": d.get("eav_od_mm"),
            "uid_code": d.get("eav_uid_code"),
        }
        for code, value in eav_map.items():
            if value is None:
                continue
            attr = self._eav_registry.get(code)
            if attr is None:
                logger.warning("EAV registry missing for %r — skipping.", code)
                continue
            ProductAttributeValue.objects.update_or_create(
                product=product,
                attribute=attr,
                defaults={"value": value},
            )
            logger.debug("EAV %s=%r on product %s", code, value, product.sku_code)
