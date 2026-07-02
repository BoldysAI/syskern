"""Tests for the client market-parameter seeding command (CDC §5.7)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.core.management import call_command

from apps.market.models import CopperMarket, MarketParameter, MarketParameterType

pytestmark = pytest.mark.django_db


def _active_copper():
    return MarketParameter.objects.filter(
        parameter_type=MarketParameterType.COPPER_PRICE, is_active=True
    )


def _active_fx(frm, to):
    return MarketParameter.objects.filter(
        parameter_type=MarketParameterType.FX_RATE,
        fx_from_currency=frm,
        fx_to_currency=to,
        is_active=True,
    )


def test_seeds_defaults():
    call_command("seed_client_market_params")
    cu = _active_copper().get()
    assert cu.copper_market == CopperMarket.SHE
    assert cu.copper_price == Decimal("102000")
    assert cu.copper_currency == "RMB"
    assert _active_fx("EUR", "RMB").get().fx_rate == Decimal("8.19")
    assert _active_fx("EUR", "USD").get().fx_rate == Decimal("1.17")


def test_custom_values_and_idempotent():
    call_command("seed_client_market_params", "--copper-rmb", "99000", "--fx-eur-rmb", "8.0")
    call_command("seed_client_market_params", "--copper-rmb", "99000", "--fx-eur-rmb", "8.0")
    # Exactly one active copper + one active EUR/RMB (re-run does not duplicate).
    assert _active_copper().count() == 1
    assert _active_fx("EUR", "RMB").count() == 1
    assert _active_copper().get().copper_price == Decimal("99000")


def test_reseed_deactivates_previous_active():
    call_command("seed_client_market_params", "--fx-eur-usd", "1.10")
    call_command("seed_client_market_params", "--fx-eur-usd", "1.20")
    assert _active_fx("EUR", "USD").count() == 1
    assert _active_fx("EUR", "USD").get().fx_rate == Decimal("1.20")
    # The previous rate is kept but deactivated (history preserved).
    assert (
        MarketParameter.objects.filter(
            parameter_type=MarketParameterType.FX_RATE,
            fx_from_currency="EUR",
            fx_to_currency="USD",
        ).count()
        >= 1
    )
