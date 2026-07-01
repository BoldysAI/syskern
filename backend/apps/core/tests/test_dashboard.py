"""Tests for GET /api/dashboard/summary."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Currency
from apps.market.models import CopperMarket, MarketParameter, MarketParameterType
from apps.offers.models import GenerationStatus, Offer, OfferStatus, OfferType
from apps.products.models import Product
from apps.simulations.models import SavedComparison, Simulation, SimulationLine, SimulationStatus, SimulationType

pytestmark = pytest.mark.django_db


@pytest.fixture
def auth_client(client: APIClient, django_user_model):
    user = django_user_model.objects.create_user(username="dash", password="test")
    client.force_login(user)
    return client


def test_dashboard_summary_counts(auth_client: APIClient) -> None:
    Product.objects.create(sku_code="P-1", name="Cable", universe="COPPER", is_active=True)
    Product.objects.create(sku_code="P-2", name="Fiber", universe="OPTICAL", is_active=True)

    sim = Simulation.objects.create(
        label="Sim brouillon",
        simulation_type=SimulationType.TARIFF,
        is_dirty=True,
    )
    Simulation.objects.create(
        label="Sim finalisée",
        simulation_type=SimulationType.TARIFF,
        status=SimulationStatus.FINALIZED,
        last_calculated_at=timezone.now(),
    )

    SavedComparison.objects.create(
        label="Comp A",
        simulation_ids=[sim.pk, Simulation.objects.create(label="B", simulation_type=SimulationType.TARIFF).pk],
    )

    MarketParameter.objects.create(
        parameter_type=MarketParameterType.COPPER_PRICE,
        copper_market=CopperMarket.LME,
        copper_price=Decimal("8500.00"),
        copper_currency=Currency.USD,
        copper_unit="tonne",
        valid_from=timezone.now().date(),
        is_active=True,
    )
    MarketParameter.objects.create(
        parameter_type=MarketParameterType.FX_RATE,
        fx_from_currency=Currency.EUR,
        fx_to_currency=Currency.USD,
        fx_rate=Decimal("1.080000"),
        valid_from=timezone.now().date(),
        is_active=True,
    )

    resp = auth_client.get("/api/dashboard/summary")
    assert resp.status_code == 200
    body = resp.json()

    assert body["catalog"]["product_count"] == 2
    assert body["catalog"]["universe_count"] == 2
    assert body["simulations"]["total"] == 3
    assert body["simulations"]["dirty"] >= 1
    assert body["comparisons"]["total"] == 1
    assert body["market"]["copper_lme"]["value"] == "8500.00"
    assert body["market"]["fx_usd_eur"]["from_currency"] == "EUR"
    assert len(body["recent"]) >= 1


def test_dashboard_todo_dirty_and_expiring(auth_client: APIClient) -> None:
    sim = Simulation.objects.create(
        label="À recalculer",
        simulation_type=SimulationType.TARIFF,
        is_dirty=True,
    )
    draft_with_errors = Simulation.objects.create(
        label="Avec erreurs",
        simulation_type=SimulationType.TARIFF,
        status=SimulationStatus.DRAFT,
        last_calculated_at=timezone.now(),
    )
    product = Product.objects.create(sku_code="ERR-1", name="Err", is_active=True)
    SimulationLine.objects.create(simulation=draft_with_errors, product=product, status="error")

    sim_for_offer = Simulation.objects.create(
        label="Base offre",
        simulation_type=SimulationType.TARIFF,
        status=SimulationStatus.FINALIZED,
        last_calculated_at=timezone.now(),
    )
    Offer.objects.create(
        simulation=sim_for_offer,
        offer_type=OfferType.TARIFF,
        label="Offre expire",
        currency=Currency.EUR,
        incoterm="EXW",
        export_format="excel",
        status=OfferStatus.SENT,
        valid_to=timezone.now().date() + timedelta(days=3),
    )

    resp = auth_client.get("/api/dashboard/summary")
    kinds = {item["kind"] for item in resp.json()["todo"]}
    assert "simulation_dirty" in kinds
    assert "simulation_line_errors" in kinds
    assert "offer_expiring" in kinds


def test_dashboard_todo_generation_error(auth_client: APIClient) -> None:
    sim = Simulation.objects.create(
        label="Sim",
        simulation_type=SimulationType.TARIFF,
        status=SimulationStatus.FINALIZED,
        last_calculated_at=timezone.now(),
    )
    Offer.objects.create(
        simulation=sim,
        offer_type=OfferType.PROJECT,
        label="Gamma KO",
        currency=Currency.EUR,
        incoterm="EXW",
        export_format="devis_gamma",
        generation_status=GenerationStatus.ERROR,
    )

    resp = auth_client.get("/api/dashboard/summary")
    kinds = {item["kind"] for item in resp.json()["todo"]}
    assert "offer_generation_error" in kinds
