"""Tests for the AYP price-grid sheet (real client LAN_CABLE file).

The `AYP NOV 21 - DEC 25 ¥` sheet is a price grid keyed by copper level: the PO
base price is read from the column headed by the base copper (70000 RMB/t). The
`ITEM` cell may list several slash-separated Unikkern SKUs.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import openpyxl
import pytest

from apps.data_migration.loaders.loader_po_ayp import AYPLoader
from apps.data_migration.loaders.types import LoaderConfig
from apps.products.models import MigrationSource, Product, ProductSupplier

FIXTURE_DIR = Path(__file__).parent / "fixtures"
GEN_DIR = FIXTURE_DIR / "_generated"  # runtime-generated fixtures (gitignored)
GRID_FIXTURE = GEN_DIR / "ayp_grid_sample.xlsx"


def _write_grid_fixture(path: Path) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "AYP NOV 21 - DEC 25 ¥"
    for _ in range(7):  # 7 preamble rows → header at Excel row 8 (pandas header_row=7)
        ws.append([])
    # Header: fixed cols 0-9 + copper-level price columns 68000/69000/70000.
    ws.append(
        [
            "AYP",
            "CATALOGUE ",
            "TYPE",
            "EUROCLASS",
            "Packing",
            "USD/RMB",
            "ITEM",
            "TEST LEVEL",
            "Copper weight",
            "Diff.",
            68000,
            69000,
            70000,
        ]
    )
    # Data: two slash-separated SKUs, copper 16.8, price at 70000 = 2000.
    ws.append(
        [
            "CAT6 F/UTP",
            "CAT6",
            "F/UTP LSZH",
            "Dca",
            "500M",
            6.4,
            "GRIDSKU1/GRIDSKU2",
            "90m fluke",
            16.8,
            12.8,
            1974.4,
            1987.2,
            2000,
        ]
    )
    # A row whose ITEM is "-" → skipped.
    ws.append(["CAT6", "CAT6", "F/UTP", "Dca", "500M", 6.4, "-", "90m", 16.8, 12.8, 1, 1, 1])
    GEN_DIR.mkdir(parents=True, exist_ok=True)
    wb.save(path)


@pytest.fixture(scope="module", autouse=True)
def _fixture() -> None:
    _write_grid_fixture(GRID_FIXTURE)


def _config() -> LoaderConfig:
    return LoaderConfig(file_path=str(GRID_FIXTURE))


@pytest.mark.django_db(transaction=True)
class TestAYPGrid:
    def setup_method(self) -> None:
        Product.objects.create(
            sku_code="GRIDSKU1", name="GRIDSKU1", migration_source=MigrationSource.MANUAL
        )
        # GRIDSKU2 absent → NO_MATCH.

    def test_matches_and_upserts_supplier(self) -> None:
        report = AYPLoader().run(_config())
        assert report.rows_matched == 1  # GRIDSKU1 only
        assert report.rows_unmatched  # GRIDSKU2 quarantined
        sup = ProductSupplier.objects.get(product__sku_code="GRIDSKU1", supplier_name="AYP")
        assert sup.factory_code == "91"
        assert sup.po_base_price == Decimal("2000")  # value in the 70000 column
        assert sup.copper_base_price == Decimal("70000")
        assert sup.po_currency == "RMB"
        assert sup.is_copper_indexed is True

    def test_copper_weight_written_to_product(self) -> None:
        AYPLoader().run(_config())
        p = Product.objects.get(sku_code="GRIDSKU1")
        assert p.copper_weight_kg_per_unit == Decimal("16.8")
        assert p.is_copper_indexed is True
