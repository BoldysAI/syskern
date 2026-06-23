"""Tests for the bulk Odoo refresh + multi-currency conversion (CDC §6.7.1).

`refresh_odoo_for_simulation` is the only place that talks to Odoo for the
predictive PAMP: it converts each pending purchase to EUR (`fx_eur_<currency>`)
before handing them to `compute_predictive_pamp`. A line whose currency has no
available FX is skipped — we never invent a rate (`/AGENTS.md` §5 r.3).
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from apps.odoo_sync.schemas import OdooPurchaseLine, OdooStock
from apps.products.models import Product
from apps.simulations.models import Simulation, SimulationLine, SimulationType
from apps.simulations.services import odoo_refresh as odoo_refresh_mod
from apps.simulations.services.engine import compute_predictive_pamp
from apps.simulations.services.odoo_refresh import _to_eur, refresh_odoo_for_simulation

# ─── _to_eur (pure, no DB) ──────────────────────────────────────────────────


def test_to_eur_passthrough_for_eur():
    assert _to_eur(Decimal("100"), "EUR", {}) == Decimal("100")
    # Currency defaults to EUR when missing.
    assert _to_eur(Decimal("100"), "", {}) == Decimal("100")


def test_to_eur_converts_rmb_with_fx():
    # fx_eur_rmb = 7.95 → "1 EUR = 7.95 RMB", so 795 RMB = 100 EUR.
    assert _to_eur(Decimal("795"), "RMB", {"fx_eur_rmb": "7.95"}) == Decimal("100")


def test_to_eur_returns_none_when_fx_missing():
    assert _to_eur(Decimal("100"), "RMB", {}) is None


def test_to_eur_returns_none_when_fx_non_positive():
    assert _to_eur(Decimal("100"), "RMB", {"fx_eur_rmb": "0"}) is None


# ─── refresh_odoo_for_simulation (DB) ───────────────────────────────────────


def _adapter(stock_map: dict, pending_map: dict) -> MagicMock:
    adapter = MagicMock()
    adapter.get_stock_quantities.return_value = stock_map
    adapter.get_pending_purchases.return_value = pending_map
    return adapter


@pytest.mark.django_db
def test_pending_rmb_converted_and_weighted_pamp(monkeypatch):
    sim = Simulation.objects.create(
        label="S",
        simulation_type=SimulationType.TARIFF,
        market_params={"fx_eur_rmb": "7.95"},
    )
    product = Product.objects.create(sku_code="RMB-1", name="x", odoo_id=7)
    SimulationLine.objects.create(simulation=sim, product=product)

    adapter = _adapter(
        stock_map={
            7: OdooStock(
                quantity=Decimal("10"),
                available_quantity=Decimal("10"),
                standard_price_eur=Decimal("120"),
            )
        },
        pending_map={
            7: [OdooPurchaseLine(quantity=Decimal("5"), price_unit=Decimal("795"), currency="RMB")]
        },
    )
    monkeypatch.setattr(odoo_refresh_mod, "get_odoo_adapter", lambda: adapter)

    _snapshot, pending = refresh_odoo_for_simulation(sim)
    product.refresh_from_db()

    key = str(product.pk)
    # 795 RMB / 7.95 = 100 EUR.
    assert pending[key][0].price_unit_eur == Decimal("100")

    pamp = compute_predictive_pamp(
        stock_quantity=product.stock_quantity,
        pamp_eur=product.pamp_eur,
        pending_purchases=pending[key],
    )
    # (10 * 120 + 5 * 100) / 15 = 1700 / 15 = 113.3333 (ROUND_HALF_UP, 4 dp).
    assert pamp == Decimal("113.3333")


@pytest.mark.django_db
def test_mixed_currency_pending_weighted_pamp(monkeypatch):
    sim = Simulation.objects.create(
        label="S",
        simulation_type=SimulationType.TARIFF,
        market_params={"fx_eur_usd": "1.25", "fx_eur_rmb": "7.95"},
    )
    product = Product.objects.create(sku_code="MIX-1", name="x", odoo_id=8)
    SimulationLine.objects.create(simulation=sim, product=product)

    adapter = _adapter(
        stock_map={
            8: OdooStock(
                quantity=Decimal("0"),
                available_quantity=Decimal("0"),
                standard_price_eur=Decimal("0"),
            )
        },
        pending_map={
            8: [
                OdooPurchaseLine(quantity=Decimal("4"), price_unit=Decimal("12.5"), currency="USD"),
                OdooPurchaseLine(quantity=Decimal("5"), price_unit=Decimal("795"), currency="RMB"),
            ]
        },
    )
    monkeypatch.setattr(odoo_refresh_mod, "get_odoo_adapter", lambda: adapter)

    _snapshot, pending = refresh_odoo_for_simulation(sim)
    product.refresh_from_db()

    key = str(product.pk)
    # 12.5 USD / 1.25 = 10 EUR ; 795 RMB / 7.95 = 100 EUR.
    assert [p.price_unit_eur for p in pending[key]] == [Decimal("10"), Decimal("100")]

    pamp = compute_predictive_pamp(
        stock_quantity=product.stock_quantity,
        pamp_eur=product.pamp_eur,
        pending_purchases=pending[key],
    )
    # Stock 0 → PAMP = purchases only: (4*10 + 5*100) / 9 = 540 / 9 = 60.
    assert pamp == Decimal("60.0000")


@pytest.mark.django_db
def test_pending_line_skipped_when_fx_missing(monkeypatch):
    sim = Simulation.objects.create(
        label="S",
        simulation_type=SimulationType.TARIFF,
        market_params={"fx_eur_usd": "1.25"},  # no fx_eur_jpy
    )
    product = Product.objects.create(sku_code="JPY-1", name="x", odoo_id=9)
    SimulationLine.objects.create(simulation=sim, product=product)

    adapter = _adapter(
        stock_map={
            9: OdooStock(
                quantity=Decimal("0"),
                available_quantity=Decimal("0"),
                standard_price_eur=Decimal("0"),
            )
        },
        pending_map={
            9: [OdooPurchaseLine(quantity=Decimal("3"), price_unit=Decimal("1000"), currency="JPY")]
        },
    )
    monkeypatch.setattr(odoo_refresh_mod, "get_odoo_adapter", lambda: adapter)

    _snapshot, pending = refresh_odoo_for_simulation(sim)

    # The only pending line had no FX → skipped → product absent from the map.
    assert str(product.pk) not in pending
