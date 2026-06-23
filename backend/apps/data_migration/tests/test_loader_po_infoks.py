"""Tests for INFOKSLoader — no-DB unit tests (row normalisation, HS code parsing).

DB integration tests (ProductSupplier upsert) require Docker Postgres and
follow the same pattern as test_loader_po_fournisseurs.py.
"""

from __future__ import annotations

from decimal import Decimal

import pandas as pd

from apps.data_migration.loaders.loader_po_infoks import INFOKSLoader, _normalise_hs


class TestNormaliseHS:
    def test_standard_large_integer(self) -> None:
        # openpyxl reads "854470" padded to 12 digits as 854470000000
        assert _normalise_hs(854470000000) == "854470"

    def test_already_six_digit_string(self) -> None:
        assert _normalise_hs("854449") == "854449"

    def test_float_form(self) -> None:
        assert _normalise_hs(854470000000.0) == "854470"

    def test_none(self) -> None:
        assert _normalise_hs(None) is None

    def test_non_zero_remainder_returns_full(self) -> None:
        # 854449200000 → remainder "200000" ≠ all-zeros → return full string
        assert _normalise_hs(854449200000) == "854449200000"

    def test_hs_code_string_passthrough(self) -> None:
        # Plain string HS codes pass through as-is
        assert _normalise_hs("854449 2000") == "854449 2000"


class TestINFOKSNormalizeRow:
    def _make_raw(self, **kwargs: object) -> pd.Series:
        defaults = {
            "sku_code": "KFO2OM3CTA",
            "sub_range": "OM3",
            "infoks_range_code": "A-DQ(BN)(SR)2Y CLT",
            "cable_type": "CENTRAL TUBE ARMORED OUTDOOR",
            "cpr_tag": "Fca",
            "description_en": "2FO OM3 CENTRAL LOOSE TUBE ARMORED PEHD OUTDOOR BLACK RAL9005",
            "individual_packing": "2000m & 4000m drum",
            "moq_km": 4000,
            "hs_code": 854470000000,
            "payment_term": "INVOICE+60 DAYS",
            # Duplicate-named columns from the Excel header
            "Ex Works Istanbul EUR/KM": 210.0,  # col 10 (2025)
            "Ex Works Istanbul EUR/KM.1": None,  # col 12
            "Ex Works Istanbul EUR/KM.2": None,  # col 13
            "Ex Works Istanbul EUR/KM.3": 230.0,  # col 14 (2026 DRAKA)
            "Ex Works Istanbul EUR/KM.4": 238.59,  # col 16 (2026 FINAL SYMEA) ← primary
            "Ex Works Istanbul EUR/KM.5": None,  # col 20
            "DDP Reau EUR/KM": 262.45,  # col 21
            "FOB Istanbul EUR/KM": None,
        }
        defaults.update(kwargs)
        return pd.Series(defaults)

    def test_sku_code(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw())
        assert row.data["sku_code"] == "KFO2OM3CTA"

    def test_exw_price_primary_col(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw())
        assert row.data["exw_price"] == Decimal("238.59")

    def test_exw_price_fallback_col(self) -> None:
        # If primary col (.4) is missing, fall back to .3
        row = INFOKSLoader().normalize_row(self._make_raw(**{"Ex Works Istanbul EUR/KM.4": None}))
        assert row.data["exw_price"] == Decimal("230.0")

    def test_exw_price_zero_does_not_use_fallback(self) -> None:
        """0 is a valid price; it must not be treated as missing (truthiness bug)."""
        row = INFOKSLoader().normalize_row(
            self._make_raw(**{"Ex Works Istanbul EUR/KM.4": 0, "Ex Works Istanbul EUR/KM.3": 999.0})
        )
        assert row.data["exw_price"] == Decimal("0")

    def test_exw_price_none_when_all_missing(self) -> None:
        row = INFOKSLoader().normalize_row(
            self._make_raw(
                **{"Ex Works Istanbul EUR/KM.4": None, "Ex Works Istanbul EUR/KM.3": None}
            )
        )
        assert row.data["exw_price"] is None

    def test_hs_code_normalised(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw(hs_code=854470000000))
        assert row.data["hs_code"] == "854470"

    def test_description_en(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw())
        assert "OM3" in row.data["description_en"]

    def test_ddp_price_in_notes(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw())
        assert "262.45" in row.data["notes"]

    def test_infoks_range_code_in_notes(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw())
        assert "A-DQ(BN)(SR)2Y CLT" in row.data["notes"]

    def test_payment_term_in_notes(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw())
        assert "INVOICE+60 DAYS" in row.data["notes"]

    def test_moq_in_notes(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw())
        assert "4000 km" in row.data["notes"]

    def test_moq_nan_omitted_from_notes(self) -> None:
        row = INFOKSLoader().normalize_row(self._make_raw(moq_km=float("nan")))
        assert "MOQ" not in row.data["notes"]
        assert "nan" not in row.data["notes"].lower()


class TestINFOKSMatchHint:
    def _make_row(self) -> pd.Series:
        return pd.Series(
            {
                "sku_code": "KFO4OM3CTA",
                "sub_range": "OM3",
                "cable_type": "CENTRAL TUBE",
                "description_en": "4FO OM3",
                "cpr_tag": "Fca",
                "individual_packing": "2000m drum",
                "moq_km": 4000,
                "hs_code": 854470000000,
                "payment_term": "INVOICE+60 DAYS",
                "infoks_range_code": "A-DQ",
                "Ex Works Istanbul EUR/KM": None,
                "Ex Works Istanbul EUR/KM.1": None,
                "Ex Works Istanbul EUR/KM.2": None,
                "Ex Works Istanbul EUR/KM.3": None,
                "Ex Works Istanbul EUR/KM.4": 280.0,
                "Ex Works Istanbul EUR/KM.5": None,
                "DDP Reau EUR/KM": 310.0,
                "FOB Istanbul EUR/KM": None,
            }
        )

    def test_sku_in_hint(self) -> None:
        loader = INFOKSLoader()
        hint = loader.build_match_hint(loader.normalize_row(self._make_row()))
        assert hint.sku_code == "KFO4OM3CTA"

    def test_factory_code_in_hint(self) -> None:
        loader = INFOKSLoader()
        hint = loader.build_match_hint(loader.normalize_row(self._make_row()))
        assert hint.factory_code == "E04"

    def test_category_contains_fo(self) -> None:
        loader = INFOKSLoader()
        hint = loader.build_match_hint(loader.normalize_row(self._make_row()))
        assert hint.category is not None
        assert "FO" in hint.category
