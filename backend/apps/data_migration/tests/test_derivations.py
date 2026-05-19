"""Unit tests for apps.data_migration.derivations (CDC §8.5).

All tests are pure Python — no Django ORM, no ``@pytest.mark.django_db``.
Fixtures use real Syskern SKU patterns to ensure the rules match production data.

SKU reference data (from Syskern catalogue):
  KCFF6A4PZHDBL5-21   → China factory (HT)        → factory_code = "21"
  KCFF6A4PZHDBL5-E02  → Turkey factory (KK)        → factory_code = "E02"
  KCFU64PZHDGR5-21    → China factory (HT)         → factory_code = "21"
  KPS600ZH            → no factory suffix           → factory_code = None
  KCUF6A4PZHDBL5      → no factory suffix           → factory_code = None
"""
from __future__ import annotations

import pytest
from decimal import Decimal

from apps.data_migration.derivations import (
    derive_base_unit,
    derive_factory_code,
    derive_is_active,
    derive_is_copper_indexed,
    derive_pamp_eur,
    derive_parent_reference,
)


# ===========================================================================
# derive_is_copper_indexed
# ===========================================================================


class TestDeriveIsCopperIndexed:
    def test_positive_weight_is_indexed(self) -> None:
        assert derive_is_copper_indexed(Decimal("17.5")) is True

    def test_small_positive_weight_is_indexed(self) -> None:
        assert derive_is_copper_indexed(Decimal("0.0001")) is True

    def test_zero_weight_is_not_indexed(self) -> None:
        assert derive_is_copper_indexed(Decimal("0")) is False

    def test_negative_weight_is_not_indexed(self) -> None:
        # Negative copper weights are invalid in the source data but must not
        # trigger copper indexing — they indicate bad input, not copper presence.
        assert derive_is_copper_indexed(Decimal("-0.001")) is False

    def test_none_weight_is_not_indexed(self) -> None:
        assert derive_is_copper_indexed(None) is False

    def test_typical_cable_weight(self) -> None:
        # 18 kg/km is the reference value from CDC §6.4 example
        assert derive_is_copper_indexed(Decimal("18")) is True


# ===========================================================================
# derive_factory_code
# ===========================================================================


class TestDeriveFactoryCode:
    # --- nominal: numeric suffix ------------------------------------------

    def test_china_suffix_21(self) -> None:
        assert derive_factory_code("KCFF6A4PZHDBL5-21") == "21"

    def test_china_suffix_17(self) -> None:
        assert derive_factory_code("KCFU64PZHDGR5-17") == "17"

    def test_multi_segment_sku_china(self) -> None:
        assert derive_factory_code("KCUF6A4PZHDBL5-21") == "21"

    # --- nominal: E-prefixed suffix (Turkey) ------------------------------

    def test_turkey_suffix_e02(self) -> None:
        assert derive_factory_code("KCFF6A4PZHDBL5-E02") == "E02"

    def test_turkey_suffix_e04(self) -> None:
        assert derive_factory_code("KCFU64PZHDGR5-E04") == "E04"

    def test_turkey_suffix_longer_number(self) -> None:
        assert derive_factory_code("KTEST123-E123") == "E123"

    # --- edge: no factory suffix ------------------------------------------

    def test_no_suffix_returns_none(self) -> None:
        assert derive_factory_code("KPS600ZH") is None

    def test_no_suffix_standalone_sku(self) -> None:
        assert derive_factory_code("KCUF6A4PZHDBL5") is None

    def test_non_numeric_suffix_returns_none(self) -> None:
        # "-ZH" does not match the factory suffix pattern → no factory code
        assert derive_factory_code("KPS-600-ZH") is None

    def test_alpha_only_suffix_returns_none(self) -> None:
        assert derive_factory_code("KTEST-ABC") is None

    def test_empty_string_returns_none(self) -> None:
        assert derive_factory_code("") is None

    def test_only_dash_returns_none(self) -> None:
        assert derive_factory_code("-") is None

    # --- edge: suffix in the middle is not treated as factory suffix ------

    def test_dash_in_middle_without_numeric_end_returns_none(self) -> None:
        # "K600-NEXT" ends in alpha chars, not a factory suffix
        assert derive_factory_code("K600-NEXT") is None

    def test_sku_with_multiple_dashes_uses_last(self) -> None:
        # Only the terminal numeric suffix counts
        assert derive_factory_code("KTEST-01-21") == "21"


# ===========================================================================
# derive_parent_reference
# ===========================================================================


class TestDeriveParentReference:
    # --- nominal ----------------------------------------------------------

    def test_china_sku_returns_base(self) -> None:
        assert derive_parent_reference("KCFF6A4PZHDBL5-21") == "KCFF6A4PZHDBL5"

    def test_turkey_sku_returns_base(self) -> None:
        assert derive_parent_reference("KCFF6A4PZHDBL5-E02") == "KCFF6A4PZHDBL5"

    def test_full_real_sku_china(self) -> None:
        assert derive_parent_reference("KCFU64PZHDGR5-21") == "KCFU64PZHDGR5"

    def test_full_real_sku_turkey(self) -> None:
        assert derive_parent_reference("KCFU64PZHDGR5-E02") == "KCFU64PZHDGR5"

    # --- edge: no suffix → None (not the full SKU) -----------------------

    def test_no_suffix_returns_none_not_sku(self) -> None:
        # Returning None distinguishes "no parent derivable" from "parent = self"
        assert derive_parent_reference("KPS600ZH") is None

    def test_no_suffix_standalone_sku_returns_none(self) -> None:
        assert derive_parent_reference("KCUF6A4PZHDBL5") is None

    def test_empty_string_returns_none(self) -> None:
        assert derive_parent_reference("") is None

    def test_non_numeric_suffix_returns_none(self) -> None:
        assert derive_parent_reference("KPS-600-ZH") is None

    # --- consistency with derive_factory_code ----------------------------

    def test_base_plus_suffix_reconstructs_original(self) -> None:
        sku = "KCFF6A4PZHDBL5-21"
        parent = derive_parent_reference(sku)
        factory = derive_factory_code(sku)
        assert parent is not None and factory is not None
        assert f"{parent}-{factory}" == sku

    def test_multiple_dashes_base_correct(self) -> None:
        # Only the last -NN is stripped
        assert derive_parent_reference("KTEST-01-21") == "KTEST-01"


# ===========================================================================
# derive_base_unit
# ===========================================================================


class TestDeriveBaseUnit:
    # --- nominal: cable detected → km ------------------------------------

    def test_cable_in_family_fr(self) -> None:
        assert derive_base_unit("COPPER Câbles réseau Catégorie 7 Câble blindé") == "km"

    def test_cable_lowercase(self) -> None:
        assert derive_base_unit("copper câbles réseau catégorie 7") == "km"

    def test_cable_in_sub_range_only(self) -> None:
        assert derive_base_unit("COPPER DATA CABLES  Câble blindé") == "km"

    def test_cable_uppercase_accent(self) -> None:
        # Covers case-insensitive match with uppercase Â
        assert derive_base_unit("CÂBLE UTP") == "km"

    def test_cable_as_word_fragment(self) -> None:
        # "câble" as substring — note: "précâblé" contains "câblé" (accented final e),
        # not "câble", so this must be "unit".  Real-world category strings use
        # "Câbles" (plural) or "Câble" which both start with "câble".
        assert derive_base_unit("précâblé") == "unit"

    def test_cable_plural_matches(self) -> None:
        # "Câbles" starts with "câble" → matches
        assert derive_base_unit("Câbles réseau") == "km"

    # --- nominal: no cable keyword → unit --------------------------------

    def test_no_cable_data_cables_english(self) -> None:
        # "cable" (English, no accent) does NOT match "câble" (French)
        assert derive_base_unit("COPPER DATA CABLES SOLID CABLE CAT6") == "unit"

    def test_connector_category_is_unit(self) -> None:
        assert derive_base_unit("COPPER CONNECTORS RJ45 SHIELDED") == "unit"

    def test_patch_panel_is_unit(self) -> None:
        assert derive_base_unit("COPPER PATCH PANELS 24P CAT6") == "unit"

    # --- edge cases -------------------------------------------------------

    def test_empty_string_returns_unit(self) -> None:
        assert derive_base_unit("") == "unit"

    def test_whitespace_only_returns_unit(self) -> None:
        assert derive_base_unit("   ") == "unit"


# ===========================================================================
# derive_pamp_eur
# ===========================================================================


class TestDerivePampEur:
    # Reference FX rates coherent with MarketParameter semantics:
    # fx_from_currency → fx_to_currency="EUR", fx_rate = value
    FX_RATES: dict[str, Decimal] = {
        "USD": Decimal("0.9259"),
        "RMB": Decimal("0.1270"),
    }

    # --- EUR passthrough --------------------------------------------------

    def test_eur_returns_unchanged(self) -> None:
        result = derive_pamp_eur(Decimal("390.1636"), "EUR", self.FX_RATES)
        assert result == Decimal("390.1636")

    def test_eur_zero(self) -> None:
        result = derive_pamp_eur(Decimal("0"), "EUR", self.FX_RATES)
        assert result == Decimal("0")

    # --- USD conversion ---------------------------------------------------

    def test_usd_to_eur(self) -> None:
        result = derive_pamp_eur(Decimal("100"), "USD", self.FX_RATES)
        expected = (Decimal("100") * Decimal("0.9259")).quantize(Decimal("0.0001"))
        assert result == expected

    def test_usd_real_value(self) -> None:
        # 448.92 × 0.9259 = 415.655028 → rounds to 415.6550 at 4 decimal places
        result = derive_pamp_eur(Decimal("448.92"), "USD", self.FX_RATES)
        assert result == Decimal("415.6550")

    # --- RMB conversion ---------------------------------------------------

    def test_rmb_to_eur(self) -> None:
        result = derive_pamp_eur(Decimal("2350"), "RMB", self.FX_RATES)
        expected = (Decimal("2350") * Decimal("0.1270")).quantize(Decimal("0.0001"))
        assert result == expected

    def test_rmb_cdc_example(self) -> None:
        # CDC §6.4 example: PO net 2836 RMB/km, rate 7.95 → ~356.73 EUR/km
        # Using our convention: 2836 * 0.1270 = 360.1720 (different rate than CDC,
        # but the formula is correct — rate varies by snapshot date)
        result = derive_pamp_eur(Decimal("2836"), "RMB", self.FX_RATES)
        assert result == Decimal("360.1720")

    # --- Quantization precision -------------------------------------------

    def test_result_has_four_decimal_places(self) -> None:
        result = derive_pamp_eur(Decimal("1"), "USD", self.FX_RATES)
        # str representation must not exceed 4 decimal places
        assert result == result.quantize(Decimal("0.0001"))

    # --- Unknown currency raises ------------------------------------------

    def test_unknown_currency_raises_key_error(self) -> None:
        with pytest.raises(KeyError):
            derive_pamp_eur(Decimal("100"), "GBP", self.FX_RATES)

    def test_empty_fx_rates_raises_for_non_eur(self) -> None:
        with pytest.raises(KeyError):
            derive_pamp_eur(Decimal("100"), "USD", {})

    def test_empty_fx_rates_ok_for_eur(self) -> None:
        # EUR → no lookup in fx_rates, must not raise even with empty dict
        result = derive_pamp_eur(Decimal("100"), "EUR", {})
        assert result == Decimal("100")


# ===========================================================================
# derive_is_active
# ===========================================================================


class TestDeriveIsActive:
    def test_active_true(self) -> None:
        assert derive_is_active(True) is True

    def test_active_false(self) -> None:
        assert derive_is_active(False) is False
