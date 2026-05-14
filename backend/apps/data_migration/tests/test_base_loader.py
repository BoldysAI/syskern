"""Integration tests for BaseExcelLoader using a DummyLoader.

These tests use the sample_minimal.xlsx fixture and exercise:
  - The full run() pipeline (read → validate → dedup → match → update/quarantine)
  - Correct LoaderReport counts
  - Quarantine logging (MigrationUnmatched) for NO_SKU and DUPLICATE_MATCH
  - Savepoint rollback: an exception in apply_update quarantines that row but
    commits the rest of the batch
  - dry_run=True: no DB writes, report still populated

DB setup:
  The tests create three Product rows via factory-boy to satisfy the three
  matcher rules.  A fourth product row is intentionally duplicated in the
  factory-category index to trigger DUPLICATE_MATCH on row 5.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from apps.data_migration.loaders.base import BaseExcelLoader
from apps.data_migration.loaders.io import row_to_raw
from apps.data_migration.loaders.types import LoaderConfig, MatchHint, NormalizedRow, RowOutcome
from apps.data_migration.models import MigrationUnmatched, UnmatchedReason
from apps.products.models import MigrationSource, Product

pytestmark = pytest.mark.django_db(transaction=True)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "sample_minimal.xlsx"


# ─── DummyLoader ─────────────────────────────────────────────────────────────


class DummyLoader(BaseExcelLoader):
    """Minimal concrete loader for testing the base pipeline.

    - Reads the sample_minimal.xlsx fixture (all columns canonical by name).
    - Matching uses sku_code / parent_reference / factory_code / category.
    - apply_update() is a no-op by default; patched to raise in some tests.
    """

    migration_source = MigrationSource.EXCEL_PRICING

    # Injected by tests to simulate apply_update failures
    _raise_on_sku: str | None = None

    def column_mapping(self) -> dict[str, str]:
        return {}  # columns already use canonical names in the fixture

    def required_columns(self) -> set[str]:
        return {"sku_code"}

    def normalize_row(self, raw: Any) -> NormalizedRow:
        from apps.data_migration.loaders.io import coerce_str

        def s(col: str) -> str | None:
            return coerce_str(raw.get(col))

        return NormalizedRow(
            data={
                "sku_code": s("sku_code"),
                "parent_reference": s("parent_reference"),
                "factory_code": s("factory_code"),
                "category": s("category"),
            },
            raw=row_to_raw(raw),
        )

    def build_match_hint(self, row: NormalizedRow) -> MatchHint:
        return MatchHint(
            sku_code=row.data.get("sku_code"),
            parent_reference=row.data.get("parent_reference"),
            factory_code=row.data.get("factory_code"),
            category=row.data.get("category"),
        )

    def apply_update(self, product: Product, row: NormalizedRow) -> RowOutcome:
        from apps.data_migration.loaders.exceptions import InvalidRowError

        if self._raise_on_sku and product.sku_code == self._raise_on_sku:
            raise InvalidRowError(f"Simulated failure on {product.sku_code}")
        # No-op: in real loaders this saves enriched fields
        return RowOutcome(
            row_number=0,
            matched=True,
            updated=True,
            quarantined=False,
        )


# ─── Product helpers ──────────────────────────────────────────────────────────


def make_product(
    sku_code: str,
    parent_reference: str = "",
    factory_code: str = "",
    universe: str = "",
    family: str = "",
    range_: str = "",
    sub_range: str = "",
) -> Product:
    return Product.objects.create(
        sku_code=sku_code,
        name=f"Test product {sku_code}",
        parent_reference=parent_reference,
        factory_code=factory_code,
        universe=universe,
        family=family,
        range=range_,
        sub_range=sub_range,
        migration_source=MigrationSource.MANUAL,
    )


def default_config(**overrides: Any) -> LoaderConfig:
    return LoaderConfig(
        file_path=str(FIXTURE_PATH),
        sheet_name="products",
        header_row=0,
        batch_size=500,
        dry_run=overrides.get("dry_run", False),
    )


# ─── Tests ────────────────────────────────────────────────────────────────────


class TestDummyLoaderReport:
    """Happy-path: verify report counts match fixture rows."""

    def setup_method(self) -> None:
        # Product for row 1 (exact SKU match)
        make_product("KCFU64PZHDGR5", parent_reference="KCFU64PZHDGR5", factory_code="21",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6")
        # Product for row 2 (parent+factory)  — same product, already created above
        # Product for row 3 (factory + category "91" + "COPPER|DATA CABLES|SOLID CABLE CAT6|F/UTP")
        make_product("OEFU64PXSDWHT5", factory_code="91",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="F/UTP")
        # Two products sharing factory "E02" + category "AMBIGUOUS" → DUPLICATE_MATCH on row 5
        make_product("AMBIG1", factory_code="E02",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="AMBIGUOUS")
        make_product("AMBIG2", factory_code="E02",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="AMBIGUOUS")

    def test_report_total_rows(self) -> None:
        report = DummyLoader().run(default_config())
        assert report.rows_total == 5

    def test_report_matched_count(self) -> None:
        report = DummyLoader().run(default_config())
        # Rows 1, 2, 3 match; rows 4, 5 quarantined
        assert report.rows_matched == 3

    def test_report_updated_count(self) -> None:
        report = DummyLoader().run(default_config())
        assert report.rows_updated == 3

    def test_report_no_sku_quarantine(self) -> None:
        report = DummyLoader().run(default_config())
        assert report.rows_unmatched.get(UnmatchedReason.NO_SKU, 0) == 1

    def test_report_duplicate_match_quarantine(self) -> None:
        report = DummyLoader().run(default_config())
        assert report.rows_unmatched.get(UnmatchedReason.DUPLICATE_MATCH, 0) == 1

    def test_migration_unmatched_records_created(self) -> None:
        DummyLoader().run(default_config())
        assert MigrationUnmatched.objects.filter(
            source_file="sample_minimal.xlsx"
        ).count() == 2

    def test_unmatched_no_sku_has_raw_data(self) -> None:
        DummyLoader().run(default_config())
        entry = MigrationUnmatched.objects.get(
            source_file="sample_minimal.xlsx", reason=UnmatchedReason.NO_SKU
        )
        # raw_data must be a non-empty dict
        assert isinstance(entry.raw_data, dict)
        assert entry.raw_data  # non-empty

    def test_unmatched_raw_data_is_json_safe(self) -> None:
        """raw_data must not contain NaN, Decimal, or datetime objects."""
        import json

        DummyLoader().run(default_config())
        for entry in MigrationUnmatched.objects.filter(source_file="sample_minimal.xlsx"):
            json.dumps(entry.raw_data)  # must not raise


class TestDummyLoaderSavepointRollback:
    """apply_update raises on one product → that row quarantined, rest commits."""

    def setup_method(self) -> None:
        make_product("KCFU64PZHDGR5", parent_reference="KCFU64PZHDGR5", factory_code="21",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6")
        make_product("OEFU64PXSDWHT5", factory_code="91",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="F/UTP")
        make_product("AMBIG1", factory_code="E02",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="AMBIGUOUS")
        make_product("AMBIG2", factory_code="E02",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="AMBIGUOUS")

    def test_failed_apply_quarantines_row_not_entire_batch(self) -> None:
        loader = DummyLoader()
        loader._raise_on_sku = "KCFU64PZHDGR5"  # row 1 will fail
        report = loader.run(default_config())

        # Row 1 failed → quarantined as INVALID_FORMAT
        assert report.rows_unmatched.get(UnmatchedReason.INVALID_FORMAT, 0) == 1

        # Rows 2 and 3 still matched and updated (per-row atomic isolated the failure)
        assert report.rows_matched >= 2
        assert report.rows_updated >= 2

        # Total quarantined = INVALID_FORMAT(1) + NO_SKU(1) + DUPLICATE_MATCH(1)
        assert report.rows_quarantined == 3


class TestDummyLoaderDryRun:
    """dry_run=True must not write any rows to DB."""

    def setup_method(self) -> None:
        make_product("KCFU64PZHDGR5", parent_reference="KCFU64PZHDGR5", factory_code="21",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6")
        make_product("OEFU64PXSDWHT5", factory_code="91",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="F/UTP")
        make_product("AMBIG1", factory_code="E02",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="AMBIGUOUS")
        make_product("AMBIG2", factory_code="E02",
                     universe="COPPER", family="DATA CABLES", range_="SOLID CABLE CAT6", sub_range="AMBIGUOUS")

    def test_dry_run_no_quarantine_records(self) -> None:
        DummyLoader().run(default_config(dry_run=True))
        assert MigrationUnmatched.objects.count() == 0

    def test_dry_run_report_still_populated(self) -> None:
        report = DummyLoader().run(default_config(dry_run=True))
        assert report.rows_total == 5
        assert report.rows_matched == 3
        assert report.rows_updated == 0
        assert report.dry_run is True


class TestIoHelpers:
    """Pure-unit tests for io.py (no DB, no Django required)."""

    def test_json_safe_nan(self) -> None:
        from apps.data_migration.loaders.io import json_safe

        assert json_safe(float("nan")) is None
        assert json_safe(float("inf")) is None

    def test_json_safe_excel_error_preserved(self) -> None:
        from apps.data_migration.loaders.io import json_safe

        assert json_safe("#REF!") == "#REF!"
        assert json_safe("#N/A") == "#N/A"

    def test_json_safe_empty_string_is_none(self) -> None:
        from apps.data_migration.loaders.io import json_safe

        assert json_safe("") is None
        assert json_safe("   ") is None

    def test_json_safe_datetime_iso(self) -> None:
        from datetime import datetime

        from apps.data_migration.loaders.io import json_safe

        dt = datetime(2026, 3, 24, 12, 0, 0)
        assert json_safe(dt) == "2026-03-24T12:00:00"

    def test_coerce_decimal_valid(self) -> None:
        from apps.data_migration.loaders.io import coerce_decimal

        assert coerce_decimal("394.29") == "394.29"
        assert coerce_decimal(394.29) == "394.29"

    def test_coerce_decimal_error_string(self) -> None:
        from apps.data_migration.loaders.io import coerce_decimal

        assert coerce_decimal("#REF!") is None
        assert coerce_decimal("#N/A") is None

    def test_coerce_int(self) -> None:
        from apps.data_migration.loaders.io import coerce_int

        assert coerce_int("9") == 9
        assert coerce_int(9.0) == 9
        assert coerce_int("abc") is None
