"""Regression tests for the pricing engine.

The §6.4 worked example in the CDC is the single non-negotiable acceptance
test for this module (cf. Annexe Technique §7.1, critère 1).  Any change
that breaks `test_cdc_example_pa_390_16` is a defect by definition.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from apps.simulations.services.engine import (
    PendingPurchase,
    PriceWithCurrency,
    ProductView,
    SimulationContext,
    build_purchase_modules,
    build_sale_modules,
    compute_pr,
    compute_predictive_pamp,
    quantize,
    run_chain,
)

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


def test_quantize_rounds_half_up():
    assert quantize(Decimal("390.16361702")) == Decimal("390.1636")
    assert quantize(Decimal("0.00005")) == Decimal("0.0001")
