"""Model-level tests for pricing simulations (CDC §3.2 + §6.9.10)."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import connection, transaction
from django.db.utils import IntegrityError, ProgrammingError
from django.utils import timezone

from apps.products.models import Product, ProductSupplier
from apps.simulations.models import (
    RecalculationTrigger,
    Simulation,
    SimulationLine,
    SimulationRecalculation,
    SimulationStatus,
    SimulationType,
)
from apps.simulations.services.runner import run_simulation

_DB_GUARD_ERRORS = (IntegrityError, ProgrammingError)

pytestmark = pytest.mark.django_db


@pytest.fixture()
def product() -> Product:
    return Product.objects.create(
        sku_code="SIM-MODEL-01",
        name="Produit simulation",
        description_marketing={"fr": "Test"},
        is_copper_indexed=True,
        copper_weight_kg_per_unit=Decimal("18"),
        pallet_qty=9,
        base_unit="km",
    )


@pytest.fixture()
def product_with_supplier(product: Product) -> Product:
    ProductSupplier.objects.create(
        product=product,
        supplier_name="Fournisseur test",
        is_active=True,
        po_base_price=Decimal("2350"),
        po_currency="RMB",
    )
    return product


def _minimal_chain() -> dict:
    return {
        "purchase_chain": {
            "copper_variation": {},
            "currency_conversion": {"to_currency": "EUR"},
            "transports": [],
            "customs": {"global_cost": "0", "currency": "EUR"},
            "symea_margin": {"rate": "0.06", "position": "after_transports"},
        },
        "sale_chain": {
            "transports": [],
            "customs": None,
            "syskern_margin": {"rate": "0.20"},
        },
    }


def _market_params() -> dict:
    return {
        "copper_base_price_rmb": "70000",
        "copper_current_price_rmb": "97000",
        "fx_eur_rmb": "7.95",
        "fx_eur_usd": "1.15",
    }


class TestSimulationInsert:
    def test_tariff_multi_clients_insert(self) -> None:
        client_a, client_b = uuid.uuid4(), uuid.uuid4()
        sim = Simulation.objects.create(
            label="Tarif multi-clients",
            simulation_type=SimulationType.TARIFF,
            client_ids=[client_a, client_b],
        )
        assert sim.pk is not None
        assert len(sim.client_ids) == 2

    def test_project_with_project_name(self) -> None:
        sim = Simulation.objects.create(
            label="Projet client",
            simulation_type=SimulationType.PROJECT,
            client_ids=[uuid.uuid4()],
            project_name="Rénovation datacenter",
        )
        assert sim.project_name == "Rénovation datacenter"

    def test_invalid_status_rejected_by_choices(self) -> None:
        sim = Simulation(label="Bad status", simulation_type=SimulationType.TARIFF)
        sim.status = "invalid"
        with pytest.raises(ValidationError):
            sim.full_clean()

    def test_invalid_status_rejected_by_check_constraint(self) -> None:
        sim_id = uuid.uuid4()
        now = timezone.now()
        with (
            pytest.raises(IntegrityError),
            transaction.atomic(),
            connection.cursor() as cursor,
        ):
            cursor.execute(
                """
                INSERT INTO simulations (
                    id, created_at, updated_at, label, simulation_type,
                    client_ids, project_name, market_params, calculation_chain,
                    stock_purchase_mix_pct, symea_margin_rate, syskern_margin_rate,
                    status, is_dirty
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s::jsonb, %s::jsonb,
                    %s, %s, %s,
                    %s, %s
                )
                """,
                [
                    sim_id,
                    now,
                    now,
                    "Bad",
                    "tariff",
                    [],
                    "",
                    "{}",
                    "{}",
                    0,
                    "0.0600",
                    "0.2000",
                    "invalid",
                    True,
                ],
            )


class TestSimulationLineConstraints:
    def test_unique_simulation_product(self, product: Product) -> None:
        sim = Simulation.objects.create(
            label="Unique test",
            simulation_type=SimulationType.TARIFF,
        )
        SimulationLine.objects.create(simulation=sim, product=product)
        with pytest.raises(IntegrityError), transaction.atomic():
            SimulationLine.objects.create(simulation=sim, product=product)

    def test_cascade_delete_lines_and_recalculations(self, product: Product) -> None:
        sim = Simulation.objects.create(
            label="Cascade",
            simulation_type=SimulationType.TARIFF,
        )
        SimulationLine.objects.create(simulation=sim, product=product)
        SimulationRecalculation.objects.create(
            simulation=sim,
            calculated_at=timezone.now(),
            market_params={},
            calculation_chain={},
            stock_purchase_mix_pct=0,
            syskern_margin_rate=Decimal("0.2000"),
            symea_margin_rate=Decimal("0.0600"),
            aggregates={"line_count": 1},
            trigger_type=RecalculationTrigger.INITIAL,
        )
        sim_pk = sim.pk
        sim.delete()
        assert SimulationLine.objects.filter(simulation_id=sim_pk).count() == 0
        assert SimulationRecalculation.objects.filter(simulation_id=sim_pk).count() == 0


class TestFinalizedTriggers:
    def test_finalized_update_blocked_by_trigger(self) -> None:
        sim = Simulation.objects.create(
            label="Finalized",
            simulation_type=SimulationType.TARIFF,
            status=SimulationStatus.FINALIZED,
        )
        sim.label = "Changed"
        with pytest.raises(_DB_GUARD_ERRORS), transaction.atomic():
            sim.save(update_fields=["label", "updated_at"])

    def test_finalized_delete_blocked_by_trigger(self) -> None:
        sim = Simulation.objects.create(
            label="Finalized",
            simulation_type=SimulationType.TARIFF,
            status=SimulationStatus.FINALIZED,
        )
        with pytest.raises(_DB_GUARD_ERRORS), transaction.atomic():
            sim.delete()

    def test_archive_transition_allowed(self) -> None:
        sim = Simulation.objects.create(
            label="To archive",
            simulation_type=SimulationType.TARIFF,
            status=SimulationStatus.FINALIZED,
        )
        sim.status = SimulationStatus.ARCHIVED
        sim.save(update_fields=["status", "updated_at"])
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.ARCHIVED

    def test_line_insert_blocked_on_finalized_parent(self, product: Product) -> None:
        sim = Simulation.objects.create(
            label="Finalized parent",
            simulation_type=SimulationType.TARIFF,
            status=SimulationStatus.FINALIZED,
        )
        with pytest.raises(_DB_GUARD_ERRORS), transaction.atomic():
            SimulationLine.objects.create(simulation=sim, product=product)


class TestRecalculationTrace:
    def test_recalculation_trace_insert(self) -> None:
        sim = Simulation.objects.create(
            label="Trace",
            simulation_type=SimulationType.TARIFF,
        )
        trace = SimulationRecalculation.objects.create(
            simulation=sim,
            calculated_at=timezone.now(),
            market_params=_market_params(),
            calculation_chain=_minimal_chain(),
            stock_purchase_mix_pct=0,
            syskern_margin_rate=Decimal("0.2000"),
            symea_margin_rate=Decimal("0.0600"),
            aggregates={
                "line_count": 3,
                "avg_pa_eur": "100.0000",
                "warnings_count": 0,
                "errors_count": 0,
            },
            trigger_type=RecalculationTrigger.MANUAL_CURRENT_PARAMS,
            note="Test trace",
        )
        assert trace.aggregates["line_count"] == 3
        assert trace.aggregates["avg_pa_eur"] == "100.0000"


class TestRunSimulationPersistence:
    def test_calculation_breakdown_structure(self, product_with_supplier: Product) -> None:
        sim = Simulation.objects.create(
            label="Run",
            simulation_type=SimulationType.TARIFF,
            market_params=_market_params(),
            calculation_chain=_minimal_chain(),
            is_dirty=True,
        )
        SimulationLine.objects.create(simulation=sim, product=product_with_supplier)
        run_simulation(sim, trigger=RecalculationTrigger.INITIAL)

        line = sim.lines.get()
        assert "purchase" in line.calculation_breakdown
        assert "sale" in line.calculation_breakdown
        assert line.effective_mix_pct == 0
        assert line.effective_margin_rate == Decimal("0.2000")

        sim.refresh_from_db()
        assert sim.last_calculated_at is not None
        assert sim.is_dirty is False
