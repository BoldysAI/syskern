"""Regression tests for the pricing engine.

The §6.4 worked example in the CDC is the single non-negotiable acceptance
test for this module (cf. Annexe Technique §7.1, critère 1).  Any change
that breaks `test_cdc_example_pa_390_16` is a defect by definition.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from decimal import Decimal

import pytest

from apps.simulations.services.engine import (
    CalculationStep,
    CopperVariationModule,
    CurrencyConversionModule,
    CustomsModule,
    MarginModule,
    PendingPurchase,
    PriceWithCurrency,
    ProductView,
    SimulationContext,
    TransportModule,
    build_purchase_modules,
    build_pr_breakdown,
    build_sale_modules,
    compute_pr,
    compute_predictive_pamp,
    quantize,
    resolve_margin_rate,
    resolve_mix_pct,
    run_chain,
    to_decimal,
)


def _plain_ctx(market_params: dict | None = None, **product_overrides) -> SimulationContext:
    """A bare context for module-level tests that don't need a real SKU."""
    product = ProductView(
        sku_code=product_overrides.get("sku_code", "X"),
        is_copper_indexed=product_overrides.get("is_copper_indexed", False),
        copper_weight_kg_per_unit=product_overrides.get("copper_weight_kg_per_unit"),
        pallet_qty=product_overrides.get("pallet_qty", 10),
        base_unit=product_overrides.get("base_unit", "unit"),
    )
    return SimulationContext(product=product, market_params=market_params or {})


# ─── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def cdc_market_params() -> dict:
    return {
        "copper_base_price_rmb": "70000",
        "copper_current_price_rmb": "97000",
        "fx_eur_rmb": "7.95",
        "fx_eur_usd": "1.15",
    }


@pytest.fixture
def cdc_product() -> ProductView:
    """The copper-indexed cable from CDC §6.4 — 18 kg/km of copper, 9 km/pallet."""
    return ProductView(
        sku_code="KCFF6A4PZHDBL5",
        is_copper_indexed=True,
        copper_weight_kg_per_unit=Decimal("18"),
        pallet_qty=9,
        base_unit="km",
    )


@pytest.fixture
def cdc_purchase_chain() -> dict:
    return {
        "copper_variation": {},
        "currency_conversion": {"to_currency": "EUR"},
        "transports": [
            {
                "order": 1,
                "transport_mode_code": "40HQ",
                "global_cost": "3000",
                "currency": "USD",
                "pallet_count": 40,
                "from_location": "Shanghai",
                "to_location": "Le Havre",
            },
            {
                "order": 2,
                "transport_mode_code": "TRUCK_FULL",
                "global_cost": "1000",
                "currency": "EUR",
                "pallet_count": 40,
                "from_location": "Le Havre",
                "to_location": "Réau",
            },
        ],
        "customs": {"global_cost": "0", "currency": "EUR"},
        "symea_margin": {"rate": "0.06", "position": "after_transports"},
    }


# ─── The reference test ───────────────────────────────────────────────────


def test_cdc_example_pa_390_16(cdc_product, cdc_market_params, cdc_purchase_chain):
    """Reproduce CDC §6.4 → PA net = 390.1636 €/km."""
    ctx = SimulationContext(product=cdc_product, market_params=cdc_market_params)
    modules = build_purchase_modules(cdc_purchase_chain)

    starting = PriceWithCurrency(amount=Decimal("2350"), currency="RMB")
    result = run_chain(modules, starting_price=starting, context=ctx)

    assert result.final_price.currency == "EUR"
    assert result.final_price.amount == Decimal("390.1636")

    # Validate the breakdown matches the worked example step-by-step.
    amounts = [s.output_price.amount for s in result.steps]
    assert amounts[0] == Decimal("2836")  # after copper variation (RMB)
    assert amounts[1] == Decimal("356.7296")  # after EUR conversion
    assert amounts[2] == Decimal("363.9760")  # after transport 1 (USD → EUR)
    assert amounts[3] == Decimal("366.7538")  # after transport 2 (EUR)
    assert amounts[4] == Decimal("366.7538")  # customs = 0 → passthrough
    assert amounts[5] == Decimal("390.1636")  # after Symea margin


def test_cdc_example_pv_487_70(cdc_product, cdc_market_params, cdc_purchase_chain):
    """CDC §6.8.4 — PR = PA net (mix 0 %), Syskern margin 20 %, EXW sale.

    PV = 390.1636 / (1 - 0.20) = 487.7045 €/km.
    """
    ctx = SimulationContext(product=cdc_product, market_params=cdc_market_params)
    pa = run_chain(
        build_purchase_modules(cdc_purchase_chain),
        starting_price=PriceWithCurrency(amount=Decimal("2350"), currency="RMB"),
        context=ctx,
    ).final_price

    # Mix 0 % → PR equals PA net.
    pr = compute_pr(pa_net_eur=pa.amount, pamp_predictive_eur=None, mix_pct=0)
    assert pr == Decimal("390.1636")

    sale_modules = build_sale_modules(
        {"transports": [], "customs": None, "syskern_margin": {"rate": "0.20"}},
        syskern_margin_rate=Decimal("0.20"),
    )
    pv = run_chain(
        sale_modules,
        starting_price=PriceWithCurrency(amount=pr, currency="EUR"),
        context=ctx,
    ).final_price

    assert pv.currency == "EUR"
    assert pv.amount == Decimal("487.7045")


# ─── Module-level tests ───────────────────────────────────────────────────


def test_null_pallet_count_coalesced_and_warns(cdc_market_params):
    """Wizard may persist pallet_count: null when the field is left empty."""
    product = ProductView(
        sku_code="X",
        is_copper_indexed=False,
        copper_weight_kg_per_unit=None,
        pallet_qty=1,
    )
    ctx = SimulationContext(product=product, market_params=cdc_market_params)
    chain = {
        "currency_conversion": {"to_currency": "EUR"},
        "transports": [
            {
                "order": 1,
                "transport_mode_code": "20FT",
                "global_cost": "12",
                "currency": "USD",
                "pallet_count": None,
            }
        ],
        "symea_margin": {"rate": "0.06"},
    }
    modules = build_purchase_modules(chain)
    transport_mods = [m for m in modules if m.type == "transport"]
    assert len(transport_mods) == 1
    assert transport_mods[0].pallet_count == 0

    result = run_chain(
        modules,
        starting_price=PriceWithCurrency(amount=Decimal("100"), currency="EUR"),
        context=ctx,
    )
    assert any("palettes" in w for w in result.warnings)


def test_copper_module_skipped_when_not_indexed(cdc_market_params):
    product = ProductView(
        sku_code="X",
        is_copper_indexed=False,
        copper_weight_kg_per_unit=None,
        pallet_qty=10,
    )
    ctx = SimulationContext(product=product, market_params=cdc_market_params)
    modules = build_purchase_modules(
        {
            "copper_variation": {},
            "currency_conversion": {"to_currency": "EUR"},
            "transports": [],
            "symea_margin": {"rate": "0.06"},
        }
    )
    starting = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
    result = run_chain(modules, starting_price=starting, context=ctx)
    # Copper module passthrough; currency conversion no-op; margin 6 %.
    # 100 / 0.94 = 106.382978...
    assert result.final_price.amount == Decimal("106.3830")
    assert result.steps[0].applied is False  # copper skipped


def test_fx_rate_derives_non_eur_pairs():
    ctx = SimulationContext(
        product=ProductView(
            sku_code="X",
            is_copper_indexed=False,
            copper_weight_kg_per_unit=None,
            pallet_qty=1,
        ),
        market_params={"fx_eur_rmb": "7.95", "fx_eur_usd": "1.15"},
    )
    # USD → RMB derived as fx_eur_rmb / fx_eur_usd = 7.95 / 1.15.
    rate = ctx.get_fx_rate("USD", "RMB")
    assert rate == Decimal("7.95") / Decimal("1.15")


def test_margin_rate_validation():
    from apps.simulations.services.engine import MarginModule

    ctx = SimulationContext(
        product=ProductView(
            sku_code="X",
            is_copper_indexed=False,
            copper_weight_kg_per_unit=None,
            pallet_qty=1,
        ),
        market_params={},
    )
    starting = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
    with pytest.raises(ValueError):
        MarginModule(rate=Decimal("1.0")).apply(starting, ctx)
    with pytest.raises(ValueError):
        MarginModule(rate=Decimal("-0.01")).apply(starting, ctx)


# ─── PAMP / PR tests ──────────────────────────────────────────────────────


def test_predictive_pamp_with_stock_only():
    pamp = compute_predictive_pamp(
        stock_quantity=Decimal("10"),
        pamp_eur=Decimal("100"),
        pending_purchases=[],
    )
    # Only stock available → PAMP = current PAMP.
    assert pamp == Decimal("100")


def test_predictive_pamp_with_pending_purchases():
    pamp = compute_predictive_pamp(
        stock_quantity=Decimal("10"),
        pamp_eur=Decimal("100"),
        pending_purchases=[PendingPurchase(quantity=Decimal("10"), price_unit_eur=Decimal("120"))],
    )
    # Weighted avg: (10*100 + 10*120) / 20 = 110.
    assert pamp == Decimal("110")


def test_predictive_pamp_returns_none_without_quantity():
    pamp = compute_predictive_pamp(
        stock_quantity=Decimal("0"),
        pamp_eur=None,
        pending_purchases=[],
    )
    assert pamp is None


def test_predictive_pamp_returns_none_when_not_synced():
    # Produit jamais syncé avec Odoo (odoo_id IS NULL) → pas de PAMP prévisionnel
    # même si un stock résiduel traîne (CDC §6.7.1).
    pamp = compute_predictive_pamp(
        odoo_synced=False,
        stock_quantity=Decimal("10"),
        pamp_eur=Decimal("100"),
        pending_purchases=[PendingPurchase(quantity=Decimal("5"), price_unit_eur=Decimal("120"))],
    )
    assert pamp is None


def test_predictive_pamp_stock_zero_with_pending_purchases():
    # Stock = 0 mais achats engagés → PAMP = moyenne pondérée des seuls achats.
    pamp = compute_predictive_pamp(
        stock_quantity=Decimal("0"),
        pamp_eur=None,
        pending_purchases=[
            PendingPurchase(quantity=Decimal("10"), price_unit_eur=Decimal("100")),
            PendingPurchase(quantity=Decimal("30"), price_unit_eur=Decimal("120")),
        ],
    )
    # (10*100 + 30*120) / 40 = 4600 / 40 = 115.
    assert pamp == Decimal("115.0000")


def test_predictive_pamp_quantizes_to_four_decimals():
    # Quotient non terminant → arrondi 4 dp, ROUND_HALF_UP (CDC §6.5).
    pamp = compute_predictive_pamp(
        stock_quantity=Decimal("3"),
        pamp_eur=Decimal("100"),
        pending_purchases=[PendingPurchase(quantity=Decimal("4"), price_unit_eur=Decimal("150"))],
    )
    # (3*100 + 4*150) / 7 = 900 / 7 = 128.571428… → 128.5714.
    assert pamp == Decimal("128.5714")


def test_compute_pr_at_mix_extremes():
    assert compute_pr(
        pa_net_eur=Decimal("400"), pamp_predictive_eur=Decimal("300"), mix_pct=0
    ) == Decimal("400")
    assert compute_pr(
        pa_net_eur=Decimal("400"), pamp_predictive_eur=Decimal("300"), mix_pct=100
    ) == Decimal("300")
    # 50 % mix → average of the two values.
    assert compute_pr(
        pa_net_eur=Decimal("400"), pamp_predictive_eur=Decimal("300"), mix_pct=50
    ) == Decimal("350")


def test_compute_pr_falls_back_to_pa_when_no_pamp():
    # Even with mix_pct=80, missing PAMP forces PR = PA net.
    assert compute_pr(pa_net_eur=Decimal("400"), pamp_predictive_eur=None, mix_pct=80) == Decimal(
        "400"
    )


def test_compute_pr_quantizes_to_four_decimals():
    # 33 % of (101, 100) → 100.33 exact; pick values producing > 4 decimals.
    pr = compute_pr(
        pa_net_eur=Decimal("100.12345"),
        pamp_predictive_eur=Decimal("200.98765"),
        mix_pct=50,
    )
    # (0.5*200.98765 + 0.5*100.12345) = 150.55555 → 150.5556 (ROUND_HALF_UP).
    assert pr == Decimal("150.5556")


def test_resolve_mix_pct_line_override_wins():
    assert resolve_mix_pct(simulation_mix_pct=30, line_override=70) == 70


def test_resolve_mix_pct_falls_back_to_simulation():
    assert resolve_mix_pct(simulation_mix_pct=30, line_override=None) == 30


def test_resolve_mix_pct_forced_to_zero_without_pamp():
    # Predictive PAMP unavailable → mix forced to 0 even when an override is set.
    assert resolve_mix_pct(simulation_mix_pct=30, line_override=70, pamp_available=False) == 0
    assert resolve_mix_pct(simulation_mix_pct=30, line_override=None, pamp_available=False) == 0


def test_build_pr_breakdown_with_pamp_and_mix():
    breakdown = build_pr_breakdown(
        pa_net_eur=Decimal("400"),
        pamp_predictive_eur=Decimal("300"),
        pr_eur=Decimal("350"),
        simulation_mix_pct=30,
        line_override=50,
        requested_mix_pct=50,
        effective_mix_pct=50,
        odoo_synced=True,
        stock_quantity=Decimal("10"),
        pamp_eur=Decimal("80"),
        pending_purchases=[],
        mix_warnings=[],
    )
    modules = [step["module"] for step in breakdown["steps"]]
    assert modules == ["predictive_pamp", "pr_mix"]
    assert breakdown["final_amount"] == "350"
    assert breakdown["mix_pct"] == 50
    pr_step = breakdown["steps"][1]
    assert pr_step["metadata"]["weighted_pa_component"] == "200.0000"
    assert pr_step["metadata"]["weighted_pamp_component"] == "150.0000"


def test_build_pr_breakdown_without_pamp_marks_first_step_passthrough():
    breakdown = build_pr_breakdown(
        pa_net_eur=Decimal("400"),
        pamp_predictive_eur=None,
        pr_eur=Decimal("400"),
        simulation_mix_pct=50,
        line_override=None,
        requested_mix_pct=50,
        effective_mix_pct=0,
        odoo_synced=False,
        stock_quantity=Decimal("10"),
        pamp_eur=Decimal("80"),
        pending_purchases=[],
        mix_warnings=["Mix forcé à 0 %"],
    )
    assert breakdown["steps"][0]["applied"] is False
    assert breakdown["steps"][0]["metadata"]["reason"] == "not_synced_odoo"
    assert breakdown["steps"][1]["warnings"] == ["Mix forcé à 0 %"]


def test_quantize_rounds_half_up():
    assert quantize(Decimal("390.16361702")) == Decimal("390.1636")
    assert quantize(Decimal("0.00005")) == Decimal("0.0001")


# ─── Domain types (dataclass — équivalent « validation Pydantic ») ─────────


class TestPriceWithCurrency:
    def test_currency_is_uppercased(self):
        assert PriceWithCurrency(amount=Decimal("1"), currency="eur").currency == "EUR"

    def test_is_immutable(self):
        price = PriceWithCurrency(amount=Decimal("1"), currency="EUR")
        with pytest.raises(FrozenInstanceError):
            price.amount = Decimal("2")  # type: ignore[misc]

    def test_with_amount_keeps_currency(self):
        price = PriceWithCurrency(amount=Decimal("1"), currency="USD")
        bumped = price.with_amount(Decimal("9"))
        assert bumped.amount == Decimal("9")
        assert bumped.currency == "USD"
        assert price.amount == Decimal("1")  # original untouched


class TestToDecimal:
    def test_float_funnelled_through_str(self):
        # 0.1 has no exact binary representation; str() dodges the FP noise.
        assert to_decimal(0.1) == Decimal("0.1")

    def test_int_and_str_and_decimal(self):
        assert to_decimal(2) == Decimal("2")
        assert to_decimal("1.5") == Decimal("1.5")
        d = Decimal("3.3")
        assert to_decimal(d) is d


class TestCalculationStep:
    def test_passthrough_flags_not_applied(self):
        price = PriceWithCurrency(amount=Decimal("5"), currency="EUR")
        step = CalculationStep.passthrough("customs", price, reason="no_customs_charge", order=3)
        assert step.applied is False
        assert step.input_price == step.output_price == price
        assert step.metadata == {"applied": False, "reason": "no_customs_charge"}
        assert step.order == 3

    def test_to_dict_serialises_prices_as_strings(self):
        step = CalculationStep(
            module_type="margin",
            input_price=PriceWithCurrency(amount=Decimal("100"), currency="EUR"),
            output_price=PriceWithCurrency(amount=Decimal("133.3333"), currency="EUR"),
            metadata={"rate": "0.25"},
            order=6,
        )
        d = step.to_dict()
        assert d["module"] == "margin"
        assert d["input_price"] == {"amount": "100", "currency": "EUR"}
        assert d["output_price"] == {"amount": "133.3333", "currency": "EUR"}
        assert d["applied"] is True


# ─── CopperVariationModule (6 cas — CDC §6.3.1) ───────────────────────────


class TestCopperVariation:
    def test_not_indexed_passthrough_exact(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params, is_copper_indexed=False)
        price = PriceWithCurrency(amount=Decimal("2350"), currency="RMB")
        step = CopperVariationModule().apply(price, ctx, order=1)
        assert step.applied is False
        assert step.metadata["reason"] == "not_applicable"
        assert step.output_price == price

    def test_cdc_example_variation(self, cdc_product, cdc_market_params):
        ctx = SimulationContext(product=cdc_product, market_params=cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("2350"), currency="RMB")
        step = CopperVariationModule().apply(price, ctx, order=1)
        # variation = (97000 - 70000) * 18 / 1000 = 486 → 2350 + 486 = 2836.
        assert step.applied is True
        assert step.output_price.amount == Decimal("2836")
        assert step.metadata["variation"] == "486"
        assert step.metadata["copper_price_currency"] == "RMB"

    def test_variation_converts_rmb_to_eur_input(self, cdc_product, cdc_market_params):
        ctx = SimulationContext(product=cdc_product, market_params=cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("300"), currency="EUR")
        step = CopperVariationModule().apply(price, ctx, order=1)
        # variation_rmb = 486 ; taux RMB→EUR = 1/7.95 → +61.1321 EUR.
        assert step.applied is True
        assert step.metadata["copper_base"] == "70000"
        assert step.metadata["copper_current"] == "97000"
        assert step.metadata["copper_price_currency"] == "RMB"
        assert step.output_price.currency == "EUR"
        assert step.output_price.amount == Decimal("361.1321")

    def test_current_equals_base_zero_variation(self, cdc_product):
        ctx = SimulationContext(
            product=cdc_product,
            market_params={
                "copper_base_price_rmb": "80000",
                "copper_current_price_rmb": "80000",
            },
        )
        price = PriceWithCurrency(amount=Decimal("2350"), currency="RMB")
        step = CopperVariationModule().apply(price, ctx, order=1)
        assert step.output_price.amount == Decimal("2350.0000")

    def test_negative_variation_applied(self, cdc_product):
        ctx = SimulationContext(
            product=cdc_product,
            market_params={
                "copper_base_price_rmb": "97000",
                "copper_current_price_rmb": "70000",
            },
        )
        price = PriceWithCurrency(amount=Decimal("2350"), currency="RMB")
        step = CopperVariationModule().apply(price, ctx, order=1)
        # variation = (70000 - 97000) * 18 / 1000 = -486 → 2350 - 486 = 1864.
        assert step.output_price.amount == Decimal("1864")

    def test_indexed_without_weight_warns(self, cdc_market_params):
        ctx = _plain_ctx(
            cdc_market_params,
            is_copper_indexed=True,
            copper_weight_kg_per_unit=Decimal("0"),
        )
        price = PriceWithCurrency(amount=Decimal("2350"), currency="RMB")
        step = CopperVariationModule().apply(price, ctx, order=1)
        assert step.applied is False
        assert step.metadata["reason"] == "indexed_without_weight"
        assert step.output_price == price
        # First-class warning (FR), not just a metadata reason.
        assert step.warnings
        assert "indexé cuivre" in step.warnings[0]

    def test_warning_propagates_to_chain_result(self, cdc_market_params):
        """A step warning must surface on ChainResult.warnings + to_breakdown."""
        product = ProductView(
            sku_code="WARN",
            is_copper_indexed=True,
            copper_weight_kg_per_unit=Decimal("0"),
            pallet_qty=9,
        )
        ctx = SimulationContext(product=product, market_params=cdc_market_params)
        modules = build_purchase_modules(
            {
                "copper_variation": {},
                "currency_conversion": {"to_currency": "EUR"},
                "transports": [],
                "symea_margin": {"rate": "0.06"},
            }
        )
        result = run_chain(
            modules,
            starting_price=PriceWithCurrency(amount=Decimal("100"), currency="RMB"),
            context=ctx,
        )
        assert result.warnings
        assert result.to_breakdown()["warnings"] == result.warnings


# ─── CurrencyConversionModule (RMB/EUR/USD — CDC §6.3.2) ───────────────────


class TestCurrencyConversion:
    def test_rmb_to_eur(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("2836"), currency="RMB")
        step = CurrencyConversionModule(target_currency="EUR").apply(price, ctx, order=1)
        # 2836 / 7.95 = 356.7295597… → 356.7296.
        assert step.output_price.currency == "EUR"
        assert step.output_price.amount == Decimal("356.7296")

    def test_eur_to_eur_passthrough(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = CurrencyConversionModule(target_currency="EUR").apply(price, ctx, order=1)
        assert step.applied is False
        assert step.metadata["reason"] == "same_currency"
        assert step.output_price == price

    def test_eur_to_usd(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = CurrencyConversionModule(target_currency="USD").apply(price, ctx, order=1)
        # 100 * 1.15 = 115.
        assert step.output_price.currency == "USD"
        assert step.output_price.amount == Decimal("115.0000")

    def test_usd_to_eur(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("115"), currency="USD")
        step = CurrencyConversionModule(target_currency="EUR").apply(price, ctx, order=1)
        # 115 / 1.15 = 100.
        assert step.output_price.currency == "EUR"
        assert step.output_price.amount == Decimal("100.0000")

    def test_missing_rate_raises(self):
        ctx = _plain_ctx({})  # no FX rates at all
        price = PriceWithCurrency(amount=Decimal("100"), currency="USD")
        with pytest.raises(ValueError, match="Taux de change EUR → USD manquant"):
            CurrencyConversionModule(target_currency="EUR").apply(price, ctx, order=1)


# ─── TransportModule (2 modes — CDC §6.3.3) ───────────────────────────────


class TestTransport:
    def test_detailed_cdc_first_leg(self, cdc_product, cdc_market_params):
        ctx = SimulationContext(product=cdc_product, market_params=cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("356.7296"), currency="EUR")
        mod = TransportModule(
            transport_mode_code="40HQ",
            global_cost=Decimal("3000"),
            currency="USD",
            pallet_count=40,
        )
        step = mod.apply(price, ctx, order=1)
        # 3000/40 = 75 USD/pallet ; /9 = 8.333… USD/km ; *1/1.15 ≈ 7.2464 EUR.
        assert step.output_price.amount == Decimal("363.9760")
        assert step.metadata["mode"] == "detailed"

    def test_coefficient_mode_direct_factor(self):
        ctx = _plain_ctx({})
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        mod = TransportModule(
            transport_mode_code="ROAD",
            global_cost=Decimal("0"),
            currency="EUR",
            pallet_count=0,
            override_coefficient=Decimal("1.05"),
        )
        step = mod.apply(price, ctx, order=1)
        assert step.metadata["mode"] == "coefficient"
        assert step.output_price.amount == Decimal("105.0000")

    def test_pallet_qty_missing_warns_instead_of_error(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params, pallet_qty=0)
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        mod = TransportModule(
            transport_mode_code="ROAD",
            global_cost=Decimal("1000"),
            currency="EUR",
            pallet_count=10,
        )
        step = mod.apply(price, ctx, order=1)
        assert not step.applied
        assert step.output_price.amount == Decimal("100")
        assert any("pallet_qty" in w for w in step.warnings)

    def test_invalid_pallet_count_warns_instead_of_error(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params, pallet_qty=10)
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        mod = TransportModule(
            transport_mode_code="ROAD",
            global_cost=Decimal("1000"),
            currency="EUR",
            pallet_count=0,
        )
        step = mod.apply(price, ctx, order=1)
        assert not step.applied
        assert any("palettes" in w for w in step.warnings)


# ─── CustomsModule (coefficient + détaillé — CDC §6.3.4) ──────────────────


class TestCustoms:
    def test_coefficient_mode(self):
        ctx = _plain_ctx({})
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = CustomsModule(override_coefficient=Decimal("1.045")).apply(price, ctx, order=1)
        assert step.metadata["mode"] == "coefficient"
        assert step.output_price.amount == Decimal("104.5000")

    def test_detailed_global_cost_over_quantity(self):
        ctx = _plain_ctx({})
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = CustomsModule(
            global_cost=Decimal("1000"),
            currency="EUR",
            total_quantity=Decimal("100"),
        ).apply(price, ctx, order=1)
        # 1000 / 100 = 10 EUR/unit → 110.
        assert step.metadata["mode"] == "detailed"
        assert step.output_price.amount == Decimal("110.0000")

    def test_no_charge_passthrough(self):
        ctx = _plain_ctx({})
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = CustomsModule(global_cost=Decimal("0")).apply(price, ctx, order=1)
        assert step.applied is False
        assert step.metadata["reason"] == "zero_customs_cost"

    def test_missing_total_quantity_warns(self):
        ctx = _plain_ctx({})
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = CustomsModule(global_cost=Decimal("200"), currency="EUR").apply(price, ctx, order=1)
        assert step.applied is False
        assert step.metadata["reason"] == "missing_total_quantity"
        assert len(step.warnings) == 1

    def test_percentage_rate(self):
        ctx = _plain_ctx({})
        price = PriceWithCurrency(amount=Decimal("200"), currency="EUR")
        step = CustomsModule(rate_pct=Decimal("5")).apply(price, ctx, order=1)
        assert step.applied is True
        assert step.metadata["mode"] == "percentage"
        assert step.output_price.amount == Decimal("210.0000")

    def test_copper_warns_when_market_params_missing(self, cdc_product):
        ctx = SimulationContext(product=cdc_product, market_params={})
        price = PriceWithCurrency(amount=Decimal("70"), currency="RMB")
        step = CopperVariationModule().apply(price, ctx, order=1)
        assert step.applied is True
        assert step.metadata["copper_base"] == "0"
        assert len(step.warnings) == 1

    def test_fx_conversion_when_currency_differs(self, cdc_market_params):
        ctx = _plain_ctx(cdc_market_params)
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = CustomsModule(
            global_cost=Decimal("115"),
            currency="USD",
            total_quantity=Decimal("100"),
        ).apply(price, ctx, order=1)
        # 115/100 = 1.15 USD/unit ; *1/1.15 = 1.0 EUR → 101.
        assert step.output_price.amount == Decimal("101.0000")
        assert step.metadata["global_cost_currency"] == "USD"


# ─── MarginModule + resolution (CDC §6.3.5, §6.8) ─────────────────────────


class TestMargin:
    def test_25_percent_on_100(self):
        ctx = _plain_ctx({})
        price = PriceWithCurrency(amount=Decimal("100"), currency="EUR")
        step = MarginModule(rate=Decimal("0.25")).apply(price, ctx, order=1)
        # 100 / (1 - 0.25) = 133.3333…
        assert step.output_price.amount == Decimal("133.3333")

    def test_resolve_margin_rate_override_wins(self):
        assert resolve_margin_rate(
            simulation_margin_rate=Decimal("0.20"), line_override=Decimal("0.30")
        ) == Decimal("0.30")

    def test_resolve_margin_rate_falls_back_to_simulation(self):
        assert resolve_margin_rate(
            simulation_margin_rate=Decimal("0.20"), line_override=None
        ) == Decimal("0.20")

    def test_resolve_margin_rate_symea_vs_syskern(self):
        # The resolution is role-agnostic: the caller passes whichever rate
        # applies (Symea default 6 %, Syskern default 20 %, CDC §6.8.1).
        symea = resolve_margin_rate(simulation_margin_rate=Decimal("0.06"), line_override=None)
        syskern = resolve_margin_rate(simulation_margin_rate=Decimal("0.20"), line_override=None)
        assert symea == Decimal("0.06")
        assert syskern == Decimal("0.20")
        # A per-line override still beats the simulation rate for either role.
        assert resolve_margin_rate(
            simulation_margin_rate=Decimal("0.06"), line_override=Decimal("0.12")
        ) == Decimal("0.12")
