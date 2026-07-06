"""Tests for catalog PV enrichment (EUR + USD + RMB via simulation FX)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from django.utils import timezone

from apps.products.models import Product
from apps.products.services.catalog_pv import build_catalog_pv_map, pv_in_currencies
from apps.simulations.models import Simulation, SimulationLine, SimulationStatus, SimulationType

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


def _product(sku: str) -> Product:
    return Product.objects.create(
        sku_code=sku,
        name=sku,
        description_marketing={"fr": "x"},
    )


def _sim(label: str, *, status: SimulationStatus = SimulationStatus.DRAFT, **kwargs) -> Simulation:
    return Simulation.objects.create(
        label=label,
        simulation_type=SimulationType.TARIFF,
        status=status,
        market_params={
            "fx_eur_usd": "1.15",
            "fx_eur_rmb": "7.95",
        },
        **kwargs,
    )


def _finalize(sim: Simulation) -> Simulation:
    sim.status = SimulationStatus.FINALIZED
    if sim.last_calculated_at is None:
        sim.last_calculated_at = timezone.now()
    sim.save(update_fields=["status", "last_calculated_at", "updated_at"])
    return sim


class TestPvInCurrencies:
    def test_converts_eur_pv_to_usd_and_rmb(self):
        out = pv_in_currencies(Decimal("100"), {"fx_eur_usd": "1.15", "fx_eur_rmb": "7.95"})
        assert out["pv_eur"] == "100.0000"
        assert out["pv_usd"] == "115.0000"
        assert out["pv_rmb"] == "795.0000"

    def test_missing_fx_leaves_foreign_null(self):
        out = pv_in_currencies(Decimal("50"), {"fx_eur_usd": "1.10"})
        assert out["pv_eur"] == "50.0000"
        assert out["pv_usd"] == "55.0000"
        assert out["pv_rmb"] is None


class TestCatalogPvMap:
    def test_latest_finalized_simulation_per_product(self):
        p1 = _product("PV-1")
        p2 = _product("PV-2")
        now = timezone.now()
        old = _sim("Old", last_calculated_at=now - timezone.timedelta(days=2))
        new = _sim("New", last_calculated_at=now)
        SimulationLine.objects.create(simulation=old, product=p1, pv_eur=Decimal("10"))
        SimulationLine.objects.create(simulation=new, product=p1, pv_eur=Decimal("20"))
        SimulationLine.objects.create(simulation=new, product=p2, pv_eur=Decimal("30"))
        _finalize(old)
        _finalize(new)

        pv_map = build_catalog_pv_map([str(p1.id), str(p2.id)])

        assert pv_map[str(p1.id)]["pv_eur"] == "20.0000"
        assert pv_map[str(p1.id)]["pv_usd"] == "23.0000"
        assert pv_map[str(p2.id)]["pv_eur"] == "30.0000"

    def test_simulation_id_scope_uses_draft_lines(self):
        p = _product("PV-SIM")
        finalized = _sim("Final")
        draft = Simulation.objects.create(
            label="Draft",
            simulation_type=SimulationType.TARIFF,
            status=SimulationStatus.DRAFT,
            market_params={"fx_eur_usd": "2.00", "fx_eur_rmb": "8.00"},
        )
        SimulationLine.objects.create(simulation=finalized, product=p, pv_eur=Decimal("99"))
        _finalize(finalized)
        SimulationLine.objects.create(simulation=draft, product=p, pv_eur=Decimal("40"))

        scoped = build_catalog_pv_map([str(p.id)], simulation_id=str(draft.id))
        assert scoped[str(p.id)]["pv_eur"] == "40.0000"
        assert scoped[str(p.id)]["pv_usd"] == "80.0000"
        assert scoped[str(p.id)]["simulation_id"] == str(draft.id)


class TestProductListCatalogPv:
    def test_list_includes_catalog_pv(self, client):
        p = _product("PV-LIST")
        sim = _sim("List sim")
        SimulationLine.objects.create(simulation=sim, product=p, pv_eur=Decimal("487.70"))
        _finalize(sim)

        resp = client.get("/api/products/", {"sku_code": "PV-LIST"})
        assert resp.status_code == 200
        row = resp.data["results"][0]
        assert row["catalog_pv"]["pv_eur"] == "487.7000"
        assert row["catalog_pv"]["pv_usd"] == "560.8550"
        assert row["catalog_pv"]["pv_rmb"] == "3877.2150"

    def test_list_with_simulation_id(self, client):
        p = _product("PV-SCOPE")
        sim = Simulation.objects.create(
            label="Draft scope",
            simulation_type=SimulationType.TARIFF,
            status=SimulationStatus.DRAFT,
            market_params={"fx_eur_usd": "1.00", "fx_eur_rmb": "1.00"},
        )
        SimulationLine.objects.create(simulation=sim, product=p, pv_eur=Decimal("12.50"))

        resp = client.get("/api/products/", {"simulation_id": str(sim.id), "sku_code": "PV-SCOPE"})
        row = resp.data["results"][0]
        assert row["catalog_pv"]["pv_eur"] == "12.5000"
        assert row["catalog_pv"]["simulation_id"] == str(sim.id)
