"""Unit tests for AYP PO loader helpers and normalisation (no DB)."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import openpyxl
import pandas as pd
import pytest

from apps.core.models import Currency
from apps.data_migration.loaders.loader_po_ayp import (
    _FACTORY_CODE,
    AYPLoader,
    _prepare_cca_dataframe,
    _prepare_lan_cu_dataframe,
    _split_odoo_codes,
)

FIXTURE_DIR = Path(__file__).parent / "fixtures"
AYP_FIXTURE = FIXTURE_DIR / "ayp_sample.xlsx"


def _write_ayp_fixture(path: Path) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "AYP CAT6 UTP CCA 2026"
    # Row 2 = header (index 1 for pandas header=1)
    ws.append([])
    ws.append(
        [
            None,
            "Desc",
            "CATALOGUE",
            "TYPE",
            "CCA Treatment",
            "EUROCLASS",
            "Packing",
            "Symea Odoo",
            "TEST",
            "Copper weight kgs/km",
            "Diff.",
            "Fixed price RMB/KM",
            "Drum",
            "Qty km/plt",
            "Pallet",
        ]
    )
    ws.append(
        [
            None,
            "UTP CAT6 PVC",
            "CAT6",
            "U/UTP CCA",
            "Physical",
            "Eca",
            "500M",
            "OSETEST1",
            "80m",
            "1.4",
            "0",
            "700.0",
            "drum",
            "12",
            "120x80",
        ]
    )
    ws.append(
        [
            None,
            "UTP CAT6 PVC no sku",
            "CAT6",
            "U/UTP CCA",
            "Physical",
            "Eca",
            "500M",
            "-",
            "80m",
            "1.4",
            "0",
            "700.0",
            "drum",
            "12",
            "120x80",
        ]
    )

    ws2 = wb.create_sheet("AYP LAN CU 2026")
    ws2.append([])
    ws2.append(
        [
            None,
            "LAN desc",
            "CAT6",
            "F/UTP",
            "0.52BC",
            "LSZH",
            "Dca",
            "500M",
            "ITEM",
            "TEST",
            "Copper weight",
            "Diff.",
            "70000",
            "102000",
            None,
            "Diff",
            "70000",
            "102000",
            None,
            "102000",
            None,
            None,
        ]
    )
    ws2.append(
        [
            None,
            "CAT6 F/UTP",
            "CAT6",
            "F/UTP",
            "0.52BC",
            "LSZH",
            "Dca",
            "500M",
            "AAA111/BBB222",
            "90m",
            "16.8",
            "0",
            "1",
            "2",
            None,
            "0",
            "1",
            "2",
            None,
            "330.5",
            None,
            None,
        ]
    )
    wb.save(path)


@pytest.fixture(scope="module", autouse=True)
def ayp_fixture() -> None:
    FIXTURE_DIR.mkdir(exist_ok=True)
    _write_ayp_fixture(AYP_FIXTURE)


class TestSplitOdooCodes:
    def test_single(self) -> None:
        assert _split_odoo_codes("OSEUU64PCCA5") == ["OSEUU64PCCA5"]

    def test_multi(self) -> None:
        assert _split_odoo_codes("AAA111/BBB222") == ["AAA111", "BBB222"]

    def test_strips_whitespace(self) -> None:
        assert _split_odoo_codes("  XX12  /  YY34  ") == ["XX12", "YY34"]

    def test_empty(self) -> None:
        assert _split_odoo_codes(None) == []
        assert _split_odoo_codes("") == []


class TestPrepareCcaDataframe:
    def test_filters_dash_sku(self) -> None:
        df = _prepare_cca_dataframe(str(AYP_FIXTURE))
        assert len(df) == 1
        assert df.iloc[0]["sku_code"] == "OSETEST1"

    def test_columns(self) -> None:
        df = _prepare_cca_dataframe(str(AYP_FIXTURE))
        assert "__sheet__" in df.columns
        assert df.iloc[0]["po_currency"] == Currency.RMB


class TestPrepareLanCuDataframe:
    def test_explodes_slash_items(self) -> None:
        df = _prepare_lan_cu_dataframe(str(AYP_FIXTURE))
        codes = set(df["sku_code"].tolist())
        assert codes == {"AAA111", "BBB222"}

    def test_price_and_currency(self) -> None:
        df = _prepare_lan_cu_dataframe(str(AYP_FIXTURE))
        assert all(df["po_currency"] == Currency.EUR)
        assert Decimal(df.iloc[0]["po_price"]) == Decimal("330.5")


class TestAYPNormalizeRow:
    def test_cca_row(self) -> None:
        loader = AYPLoader()
        raw = pd.Series(
            {
                "sku_code": "OSETEST1",
                "po_price": "700",
                "po_currency": Currency.RMB,
                "copper_kg_km": "1.4",
                "pallet_qty": "12",
                "description_line": "UTP CAT6 PVC",
                "catalogue": "CAT6",
                "cable_type": "U/UTP CCA",
                "cca_treatment": "Physical",
                "euroclass": "Eca",
                "packing": "500M",
                "__sheet__": "cca",
            }
        )
        n = loader.normalize_row(raw)
        assert n.data["po_price"] == Decimal("700")
        assert n.data["copper_kg_km"] == Decimal("1.4")

    def test_lan_row(self) -> None:
        loader = AYPLoader()
        raw = pd.Series(
            {
                "sku_code": "AAA111",
                "po_price": "330.5",
                "po_currency": Currency.EUR,
                "copper_kg_km": "16.8",
                "pallet_qty": None,
                "description_line": "LAN",
                "catalogue": "CAT6",
                "cable_type": "F/UTP",
                "__sheet__": "lan_cu",
            }
        )
        n = loader.normalize_row(raw)
        assert n.data["po_currency"] == Currency.EUR


class TestAYPMatchHint:
    def test_factory_91(self) -> None:
        loader = AYPLoader()
        raw = pd.Series(
            {
                "sku_code": "OSETEST1",
                "po_price": "1",
                "po_currency": Currency.RMB,
                "__sheet__": "cca",
            }
        )
        hint = loader.build_match_hint(loader.normalize_row(raw))
        assert hint.factory_code == _FACTORY_CODE
        assert hint.parent_reference == "OSETEST1"
        assert hint.category is None
