"""API-level tests for the simulation CRUD endpoints (CDC §6.9.9 + §6.9.10).

Coverage:
  - integrity rules: PATCH finalized/archived → 403, DELETE finalized → 403,
    DELETE with attached offers → 409 + list, DELETE draft → 204
  - creation validations: project requires a name and exactly one client
  - line status filters: has_warning / has_error
"""

from __future__ import annotations

import io
import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock

import openpyxl
import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Currency
from apps.odoo_sync.schemas import OdooPurchaseLine, OdooStock
from apps.offers.models import Offer, OfferStatus, OfferType
from apps.products.models import Incoterm, Product, ProductSupplier
from apps.simulations.exports import build_simulation_xlsx
from apps.simulations.models import (
    RecalculationTrigger,
    SavedComparison,
    Simulation,
    SimulationLine,
    SimulationRecalculation,
    SimulationStatus,
    SimulationType,
)
from apps.simulations.services import odoo_refresh as odoo_refresh_mod
from apps.simulations.tasks import recalculate_task

pytestmark = pytest.mark.django_db


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


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def draft() -> Simulation:
    return Simulation.objects.create(
        label="Brouillon",
        simulation_type=SimulationType.TARIFF,
    )


def _finalized() -> Simulation:
    return Simulation.objects.create(
        label="Finalisée",
        simulation_type=SimulationType.TARIFF,
        status=SimulationStatus.FINALIZED,
    )


def _archived() -> Simulation:
    return Simulation.objects.create(
        label="Archivée",
        simulation_type=SimulationType.TARIFF,
        status=SimulationStatus.ARCHIVED,
    )


class TestSimulationListFilters:
    def test_search_and_status_filter(self, client: APIClient) -> None:
        Simulation.objects.create(label="Alpha tarif", simulation_type=SimulationType.TARIFF)
        Simulation.objects.create(
            label="Beta projet",
            simulation_type=SimulationType.PROJECT,
            project_name="Projet Z",
            status=SimulationStatus.FINALIZED,
        )
        _archived()

        resp = client.get("/api/simulations/?q=alpha")
        assert resp.status_code == 200
        labels = [row["label"] for row in resp.json()["results"]]
        assert labels == ["Alpha tarif"]

        resp = client.get("/api/simulations/?status=finalized")
        assert resp.status_code == 200
        labels = [row["label"] for row in resp.json()["results"]]
        assert labels == ["Beta projet"]

        resp = client.get("/api/simulations/?status=archived")
        assert resp.status_code == 200
        labels = [row["label"] for row in resp.json()["results"]]
        assert labels == ["Archivée"]

    def test_is_dirty_filter_and_ordering(self, client: APIClient) -> None:
        clean = Simulation.objects.create(label="Propre", simulation_type=SimulationType.TARIFF)
        Simulation.objects.create(
            label="Sale",
            simulation_type=SimulationType.TARIFF,
            is_dirty=True,
        )
        Simulation.objects.filter(pk=clean.pk).update(
            is_dirty=False,
            updated_at=timezone.now() - timedelta(days=1),
        )

        resp = client.get("/api/simulations/?is_dirty=true")
        assert resp.status_code == 200
        assert [row["label"] for row in resp.json()["results"]] == ["Sale"]

        resp = client.get("/api/simulations/?ordering=label")
        assert resp.status_code == 200
        assert [row["label"] for row in resp.json()["results"]] == ["Propre", "Sale"]


# ─── Integrity rules (CDC §6.9.10) ──────────────────────────────────────────


class TestPatchGuards:
    def test_patch_finalized_returns_403(self, client: APIClient) -> None:
        sim = _finalized()
        resp = client.patch(f"/api/simulations/{sim.pk}/", {"label": "Modifié"}, format="json")
        assert resp.status_code == 403

    def test_patch_archived_returns_403(self, client: APIClient) -> None:
        sim = _archived()
        resp = client.patch(f"/api/simulations/{sim.pk}/", {"label": "Modifié"}, format="json")
        assert resp.status_code == 403

    def test_patch_draft_succeeds(self, client: APIClient, draft: Simulation) -> None:
        resp = client.patch(f"/api/simulations/{draft.pk}/", {"label": "Renommé"}, format="json")
        assert resp.status_code == 200
        draft.refresh_from_db()
        assert draft.label == "Renommé"


class TestDeleteGuards:
    def test_delete_draft_without_offer_returns_204(
        self, client: APIClient, draft: Simulation
    ) -> None:
        resp = client.delete(f"/api/simulations/{draft.pk}/")
        assert resp.status_code == 204
        assert not Simulation.objects.filter(pk=draft.pk).exists()

    def test_delete_finalized_returns_403(self, client: APIClient) -> None:
        sim = _finalized()
        resp = client.delete(f"/api/simulations/{sim.pk}/")
        assert resp.status_code == 403
        assert Simulation.objects.filter(pk=sim.pk).exists()

    def test_delete_with_offer_returns_409_and_lists_offers(
        self, client: APIClient, draft: Simulation
    ) -> None:
        offer = Offer.objects.create(
            simulation=draft,
            offer_type=OfferType.TARIFF,
            label="Offre liée",
            currency=Currency.EUR,
            incoterm=Incoterm.EXW,
            export_format="excel",
            status=OfferStatus.DRAFT,
        )
        resp = client.delete(f"/api/simulations/{draft.pk}/")
        assert resp.status_code == 409
        body = resp.json()
        assert any(str(offer.pk) == str(o["id"]) for o in body["offers"])
        assert Simulation.objects.filter(pk=draft.pk).exists()


# ─── Creation validations (CDC §6.9.2) ──────────────────────────────────────


class TestCreateValidations:
    def _base_payload(self, **overrides) -> dict:
        payload = {
            "label": "Nouvelle simulation",
            "simulation_type": SimulationType.TARIFF,
        }
        payload.update(overrides)
        return payload

    def test_tariff_without_clients_allowed(self, client: APIClient) -> None:
        resp = client.post("/api/simulations/", self._base_payload(), format="json")
        assert resp.status_code == 201

    def test_project_requires_project_name(self, client: APIClient) -> None:
        resp = client.post(
            "/api/simulations/",
            self._base_payload(
                simulation_type=SimulationType.PROJECT,
                client_ids=[str(uuid.uuid4())],
                project_name="",
            ),
            format="json",
        )
        assert resp.status_code == 400
        assert "project_name" in resp.json()

    def test_project_requires_exactly_one_client(self, client: APIClient) -> None:
        for client_ids in ([], [str(uuid.uuid4()), str(uuid.uuid4())]):
            resp = client.post(
                "/api/simulations/",
                self._base_payload(
                    simulation_type=SimulationType.PROJECT,
                    client_ids=client_ids,
                    project_name="Projet X",
                ),
                format="json",
            )
            assert resp.status_code == 400
            assert "client_ids" in resp.json()

    def test_valid_project_succeeds(self, client: APIClient) -> None:
        resp = client.post(
            "/api/simulations/",
            self._base_payload(
                simulation_type=SimulationType.PROJECT,
                client_ids=[str(uuid.uuid4())],
                project_name="Projet valide",
            ),
            format="json",
        )
        assert resp.status_code == 201


# ─── Line status filters (CDC §6.9.9) ───────────────────────────────────────


class TestLineFilters:
    @pytest.fixture()
    def sim_with_lines(self, draft: Simulation) -> Simulation:
        p_ok = Product.objects.create(sku_code="OK-1", name="OK")
        p_warn = Product.objects.create(sku_code="WARN-1", name="Warn")
        p_err = Product.objects.create(sku_code="ERR-1", name="Err")
        SimulationLine.objects.create(simulation=draft, product=p_ok, status="ok")
        SimulationLine.objects.create(simulation=draft, product=p_warn, status="warning")
        SimulationLine.objects.create(simulation=draft, product=p_err, status="error")
        return draft

    def test_has_error_filter(self, client: APIClient, sim_with_lines: Simulation) -> None:
        resp = client.get(f"/api/simulation-lines/?simulation={sim_with_lines.pk}&has_error=true")
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert {row["status"] for row in results} == {"error"}

    def test_has_warning_filter(self, client: APIClient, sim_with_lines: Simulation) -> None:
        resp = client.get(f"/api/simulation-lines/?simulation={sim_with_lines.pk}&has_warning=true")
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert {row["status"] for row in results} == {"warning"}

    def test_no_filter_returns_all(self, client: APIClient, sim_with_lines: Simulation) -> None:
        resp = client.get(f"/api/simulation-lines/?simulation={sim_with_lines.pk}")
        assert resp.status_code == 200
        assert resp.json()["count"] == 3

    def test_status_in_filter(self, client: APIClient, sim_with_lines: Simulation) -> None:
        resp = client.get(
            f"/api/simulation-lines/?simulation={sim_with_lines.pk}&status_in=ok,warning"
        )
        assert resp.status_code == 200
        assert {row["status"] for row in resp.json()["results"]} == {"ok", "warning"}

        resp = client.get(f"/api/simulation-lines/?simulation={sim_with_lines.pk}&status_in=error")
        assert resp.status_code == 200
        assert {row["status"] for row in resp.json()["results"]} == {"error"}


# ─── Per-line edit guard (CDC §6.9.10) ──────────────────────────────────────


class TestLineEditGuard:
    def test_patch_line_on_finalized_blocked(self, client: APIClient) -> None:
        sim = Simulation.objects.create(
            label="Pour ligne",
            simulation_type=SimulationType.TARIFF,
        )
        product = Product.objects.create(sku_code="LINE-1", name="Ligne")
        line = SimulationLine.objects.create(simulation=sim, product=product)
        # Flip to finalized via raw update to bypass the trigger guard on the
        # status column (status→finalized is allowed; other column edits are not).
        Simulation.objects.filter(pk=sim.pk).update(status=SimulationStatus.FINALIZED)

        resp = client.patch(
            f"/api/simulation-lines/{line.pk}/",
            {"margin_override": "0.1000"},
            format="json",
        )
        assert resp.status_code == 403


# ─── Single-line recalc (CDC §6.9.5) ────────────────────────────────────────


def _priceable_line() -> tuple[Simulation, SimulationLine]:
    """A draft simulation with one line that the engine can price end-to-end."""
    sim = Simulation.objects.create(
        label="Recalc",
        simulation_type=SimulationType.TARIFF,
        market_params=_market_params(),
        calculation_chain=_minimal_chain(),
    )
    product = Product.objects.create(
        sku_code="PR-1", name="Priceable", pallet_qty=10, stock_quantity=Decimal("0")
    )
    ProductSupplier.objects.create(
        product=product,
        supplier_name="Fournisseur",
        is_active=True,
        po_base_price=Decimal("100"),
        po_currency=Currency.EUR,
    )
    line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")
    return sim, line


class TestSingleLineRecalc:
    def test_recalculate_single_line_succeeds_without_trace(self, client: APIClient) -> None:
        sim, line = _priceable_line()
        resp = client.post(f"/api/simulation-lines/{line.pk}/recalculate/")
        assert resp.status_code == 200
        line.refresh_from_db()
        assert line.status == "ok"
        assert line.pv_eur is not None
        # CDC §6.9.5 — single-line recalc must NOT append an audit trace.
        assert SimulationRecalculation.objects.filter(simulation=sim).count() == 0

    def test_recalculate_single_line_finalized_blocked(self, client: APIClient) -> None:
        sim, line = _priceable_line()
        Simulation.objects.filter(pk=sim.pk).update(status=SimulationStatus.FINALIZED)
        resp = client.post(f"/api/simulation-lines/{line.pk}/recalculate/")
        assert resp.status_code == 403

    def test_recalculate_single_line_clears_simulation_dirty(self, client: APIClient) -> None:
        sim, line = _priceable_line()
        Simulation.objects.filter(pk=sim.pk).update(is_dirty=True)
        resp = client.post(f"/api/simulation-lines/{line.pk}/recalculate/")
        assert resp.status_code == 200
        sim.refresh_from_db()
        assert sim.is_dirty is False


def _two_priceable_lines() -> tuple[Simulation, list[SimulationLine]]:
    sim = Simulation.objects.create(
        label="Recalc x2",
        simulation_type=SimulationType.TARIFF,
        market_params=_market_params(),
        calculation_chain=_minimal_chain(),
    )
    lines: list[SimulationLine] = []
    for i in range(2):
        product = Product.objects.create(
            sku_code=f"PR-{i}",
            name=f"Priceable {i}",
            pallet_qty=10,
            stock_quantity=Decimal("0"),
        )
        ProductSupplier.objects.create(
            product=product,
            supplier_name="Fournisseur",
            is_active=True,
            po_base_price=Decimal("100"),
            po_currency=Currency.EUR,
        )
        lines.append(
            SimulationLine.objects.create(simulation=sim, product=product, status="pending")
        )
    return sim, lines


# ─── Finalize (CDC §6.9.6) ──────────────────────────────────────────────────


class TestFinalize:
    def _calculated_sim(self) -> tuple[Simulation, SimulationLine]:
        """A draft that has been calculated once (ready to finalize)."""
        sim, line = _priceable_line()
        line.status = "ok"
        line.pa_net_eur = Decimal("100")
        line.pr_eur = Decimal("100")
        line.pv_eur = Decimal("130")
        line.effective_margin_rate = Decimal("0.2000")
        line.effective_mix_pct = 0
        line.last_calculated_at = timezone.now()
        line.save()
        Simulation.objects.filter(pk=sim.pk).update(
            last_calculated_at=timezone.now(), is_dirty=False
        )
        sim.refresh_from_db()
        return sim, line

    def test_finalize_without_calculation_returns_400(self, client: APIClient) -> None:
        sim = Simulation.objects.create(
            label="Jamais calculée", simulation_type=SimulationType.TARIFF
        )
        resp = client.post(f"/api/simulations/{sim.pk}/finalize/")
        assert resp.status_code == 400
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.DRAFT

    def test_finalize_with_error_line_returns_400_and_lists_skus(self, client: APIClient) -> None:
        sim, line = self._calculated_sim()
        line.status = "error"
        line.save(update_fields=["status"])
        resp = client.post(f"/api/simulations/{sim.pk}/finalize/")
        assert resp.status_code == 400
        body = resp.json()
        assert line.product.sku_code in body["errors"]
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.DRAFT

    def test_finalize_success_locks_and_creates_trace(self, client: APIClient) -> None:
        sim, _ = self._calculated_sim()
        resp = client.post(f"/api/simulations/{sim.pk}/finalize/")
        assert resp.status_code == 200
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.FINALIZED
        trace = SimulationRecalculation.objects.filter(simulation=sim).first()
        assert trace is not None
        assert trace.trigger_type == RecalculationTrigger.FINALIZE
        assert len(trace.line_snapshots) == 1
        assert trace.line_snapshots[0]["pv_eur"] == "130.0000"

    def test_finalize_then_patch_returns_403(self, client: APIClient) -> None:
        sim, _ = self._calculated_sim()
        assert client.post(f"/api/simulations/{sim.pk}/finalize/").status_code == 200
        resp = client.patch(f"/api/simulations/{sim.pk}/", {"label": "Modifié"}, format="json")
        assert resp.status_code == 403

    def test_finalize_after_partial_recalc_on_dirty_lines(self, client: APIClient) -> None:
        sim, lines = _two_priceable_lines()
        now = timezone.now()
        for line in lines:
            client.post(f"/api/simulation-lines/{line.pk}/recalculate/")
            line.refresh_from_db()
            assert line.status == "ok"
        Simulation.objects.filter(pk=sim.pk).update(last_calculated_at=now, is_dirty=False)

        lines[1].status = "dirty"
        lines[1].save(update_fields=["status"])
        Simulation.objects.filter(pk=sim.pk).update(is_dirty=True)

        resp = client.post(f"/api/simulation-lines/{lines[1].pk}/recalculate/")
        assert resp.status_code == 200
        sim.refresh_from_db()
        assert sim.is_dirty is False

        resp = client.post(f"/api/simulations/{sim.pk}/finalize/")
        assert resp.status_code == 200
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.FINALIZED

    def test_pricing_patch_marks_lines_dirty(self, client: APIClient) -> None:
        sim, line = self._calculated_sim()
        resp = client.patch(
            f"/api/simulations/{sim.pk}/",
            {"market_params": {"fx_eur_rmb": "7.50", "fx_eur_usd": "1.10"}},
            format="json",
        )
        assert resp.status_code == 200
        line.refresh_from_db()
        sim.refresh_from_db()
        assert line.status == "dirty"
        assert sim.is_dirty is True


# ─── Archive / unarchive (CDC §6.9.11) ──────────────────────────────────────


class TestArchive:
    def test_archive_draft_returns_400(self, client: APIClient, draft: Simulation) -> None:
        resp = client.post(f"/api/simulations/{draft.pk}/archive/")
        assert resp.status_code == 400
        draft.refresh_from_db()
        assert draft.status == SimulationStatus.DRAFT

    def test_archive_unarchive_finalized(self, client: APIClient) -> None:
        sim = _finalized()
        assert client.post(f"/api/simulations/{sim.pk}/archive/").status_code == 200
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.ARCHIVED
        assert client.post(f"/api/simulations/{sim.pk}/unarchive/").status_code == 200
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.FINALIZED

    def test_list_includes_archived_by_default(self, client: APIClient, draft: Simulation) -> None:
        _archived()
        resp = client.get("/api/simulations/")
        assert resp.status_code == 200
        statuses = {row["status"] for row in resp.json()["results"]}
        assert SimulationStatus.ARCHIVED in statuses
        assert SimulationStatus.DRAFT in statuses

    def test_list_status_filter_can_exclude_archived(
        self, client: APIClient, draft: Simulation
    ) -> None:
        _archived()
        resp = client.get("/api/simulations/?status=draft,finalized")
        assert resp.status_code == 200
        statuses = {row["status"] for row in resp.json()["results"]}
        assert SimulationStatus.ARCHIVED not in statuses
        assert SimulationStatus.DRAFT in statuses

    def test_archive_does_not_touch_offers(self, client: APIClient) -> None:
        sim = _finalized()
        offer = Offer.objects.create(
            simulation=sim,
            offer_type=OfferType.TARIFF,
            label="Offre liée",
            currency=Currency.EUR,
            incoterm=Incoterm.EXW,
            export_format="excel",
            status=OfferStatus.DRAFT,
        )
        assert client.post(f"/api/simulations/{sim.pk}/archive/").status_code == 200
        offer.refresh_from_db()
        assert offer.simulation_id == sim.pk
        assert offer.status == OfferStatus.DRAFT


# ─── Duplicate (CDC §6.9.7) ─────────────────────────────────────────────────


class TestDuplicate:
    def _sim_with_frozen_line(self) -> tuple[Simulation, SimulationLine]:
        sim = Simulation.objects.create(
            label="Original",
            simulation_type=SimulationType.TARIFF,
            stock_purchase_mix_pct=30,
        )
        Simulation.objects.filter(pk=sim.pk).update(
            last_calculated_at=timezone.now(), is_dirty=False
        )
        sim.refresh_from_db()
        product = Product.objects.create(sku_code="DUP-1", name="x")
        line = SimulationLine.objects.create(
            simulation=sim,
            product=product,
            status="ok",
            margin_override=Decimal("0.1500"),
            stock_purchase_mix_pct_override=40,
            pa_net_eur=Decimal("100"),
            pr_eur=Decimal("110"),
            pv_eur=Decimal("130"),
            effective_margin_rate=Decimal("0.1500"),
            effective_mix_pct=40,
        )
        return sim, line

    def test_duplicate_is_full_copy_in_draft(self, client: APIClient) -> None:
        sim, line = self._sim_with_frozen_line()
        resp = client.post(f"/api/simulations/{sim.pk}/duplicate/", {}, format="json")
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == SimulationStatus.DRAFT
        assert body["label"] == "Original (copie)"
        assert body["last_calculated_at"] is not None  # inherited
        copy_line = body["lines"][0]
        assert copy_line["margin_override"] == "0.1500"
        assert copy_line["stock_purchase_mix_pct_override"] == 40
        assert copy_line["pv_eur"] == "130.0000"
        assert copy_line["effective_margin_rate"] == "0.1500"
        assert copy_line["effective_mix_pct"] == 40

    def test_duplicate_accepts_custom_label(self, client: APIClient) -> None:
        sim, _ = self._sim_with_frozen_line()
        resp = client.post(
            f"/api/simulations/{sim.pk}/duplicate/", {"label": "Variante B"}, format="json"
        )
        assert resp.status_code == 201
        assert resp.json()["label"] == "Variante B"

    def test_editing_original_does_not_affect_copy(self, client: APIClient) -> None:
        sim, line = self._sim_with_frozen_line()
        copy_id = client.post(f"/api/simulations/{sim.pk}/duplicate/", {}, format="json").json()[
            "id"
        ]
        # Mutate the original line.
        line.pv_eur = Decimal("999")
        line.margin_override = Decimal("0.9000")
        line.save(update_fields=["pv_eur", "margin_override"])
        copy = Simulation.objects.get(pk=copy_id)
        copy_line = copy.lines.first()
        assert copy_line is not None
        assert copy_line.pv_eur == Decimal("130")
        assert copy_line.margin_override == Decimal("0.1500")

    def test_duplicate_does_not_copy_offers(self, client: APIClient) -> None:
        sim, _ = self._sim_with_frozen_line()
        Offer.objects.create(
            simulation=sim,
            offer_type=OfferType.TARIFF,
            label="Offre",
            currency=Currency.EUR,
            incoterm=Incoterm.EXW,
            export_format="excel",
            status=OfferStatus.DRAFT,
        )
        copy_id = client.post(f"/api/simulations/{sim.pk}/duplicate/", {}, format="json").json()[
            "id"
        ]
        assert Offer.objects.filter(simulation_id=copy_id).count() == 0

    def test_duplicate_finalized_allowed(self, client: APIClient) -> None:
        sim, _ = self._sim_with_frozen_line()
        Simulation.objects.filter(pk=sim.pk).update(status=SimulationStatus.FINALIZED)
        resp = client.post(f"/api/simulations/{sim.pk}/duplicate/", {}, format="json")
        assert resp.status_code == 201
        assert resp.json()["status"] == SimulationStatus.DRAFT


# ─── Bulk-edit (CDC §6.9.5) ─────────────────────────────────────────────────


class TestBulkEdit:
    def _sim_with_lines(self, statuses=("ok", "ok")) -> tuple[Simulation, list[SimulationLine]]:
        sim = Simulation.objects.create(label="Bulk", simulation_type=SimulationType.TARIFF)
        lines = []
        for i, st in enumerate(statuses):
            product = Product.objects.create(sku_code=f"BK-{i}", name="x", brand="ACME", range="R1")
            lines.append(SimulationLine.objects.create(simulation=sim, product=product, status=st))
        return sim, lines

    def test_preview_counts_without_mutation(self, client: APIClient) -> None:
        sim, lines = self._sim_with_lines()
        resp = client.post(
            f"/api/simulations/{sim.pk}/lines/bulk/preview/",
            {"filter": {"brand": "ACME"}},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 2
        for line in lines:
            line.refresh_from_db()
            assert line.status == "ok"  # untouched

    def test_bulk_edit_marks_lines_dirty(self, client: APIClient) -> None:
        sim, lines = self._sim_with_lines()
        resp = client.post(
            f"/api/simulations/{sim.pk}/lines/bulk/",
            {"filter": {"brand": "ACME"}, "margin_override": "0.1500"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["updated"] == 2
        for line in lines:
            line.refresh_from_db()
            assert line.status == "dirty"
            assert str(line.margin_override) == "0.1500"
        sim.refresh_from_db()
        assert sim.is_dirty is True

    def test_bulk_edit_margin_and_mix_together(self, client: APIClient) -> None:
        sim, lines = self._sim_with_lines()
        resp = client.post(
            f"/api/simulations/{sim.pk}/lines/bulk/",
            {
                "filter": {"brand": "ACME"},
                "margin_override": "0.1800",
                "stock_purchase_mix_pct_override": 75,
            },
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["updated"] == 2
        for line in lines:
            line.refresh_from_db()
            assert line.status == "dirty"
            assert str(line.margin_override) == "0.1800"
            assert line.stock_purchase_mix_pct_override == 75

    def test_bulk_edit_finalized_returns_403(self, client: APIClient) -> None:
        sim, _ = self._sim_with_lines()
        Simulation.objects.filter(pk=sim.pk).update(status=SimulationStatus.FINALIZED)
        resp = client.post(
            f"/api/simulations/{sim.pk}/lines/bulk/",
            {"filter": {}, "margin_override": "0.1000"},
            format="json",
        )
        assert resp.status_code == 403

    def test_bulk_edit_by_line_ids(self, client: APIClient) -> None:
        sim, lines = self._sim_with_lines()
        target_id = str(lines[0].pk)
        resp = client.post(
            f"/api/simulations/{sim.pk}/lines/bulk/",
            {"filter": {"line_ids": [target_id]}, "margin_override": "0.2200"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["updated"] == 1
        lines[0].refresh_from_db()
        lines[1].refresh_from_db()
        assert str(lines[0].margin_override) == "0.2200"
        assert lines[0].status == "dirty"
        assert lines[1].margin_override is None


class TestSimulationLineDelete:
    def test_delete_line_clears_dirty_when_no_outstanding_lines(self, client: APIClient) -> None:
        sim = Simulation.objects.create(label="Del", simulation_type=SimulationType.TARIFF)
        product = Product.objects.create(sku_code="DEL-1", name="x")
        line = SimulationLine.objects.create(simulation=sim, product=product, status="ok")
        Simulation.objects.filter(pk=sim.pk).update(is_dirty=True)
        resp = client.delete(f"/api/simulation-lines/{line.pk}/")
        assert resp.status_code == 204
        assert not SimulationLine.objects.filter(pk=line.pk).exists()
        sim.refresh_from_db()
        assert sim.is_dirty is False

    def test_delete_line_finalized_returns_403(self, client: APIClient) -> None:
        # Build as draft, add the line, then finalize: the guard trigger blocks
        # line inserts on an already-finalized parent.
        sim = Simulation.objects.create(label="Del fin", simulation_type=SimulationType.TARIFF)
        product = Product.objects.create(sku_code="DEL-2", name="x")
        line = SimulationLine.objects.create(simulation=sim, product=product, status="ok")
        Simulation.objects.filter(pk=sim.pk).update(status=SimulationStatus.FINALIZED)
        resp = client.delete(f"/api/simulation-lines/{line.pk}/")
        assert resp.status_code == 403

    def test_bulk_delete_by_line_ids(self, client: APIClient) -> None:
        sim = Simulation.objects.create(label="Bulk del", simulation_type=SimulationType.TARIFF)
        products = [Product.objects.create(sku_code=f"BD-{i}", name="x") for i in range(3)]
        lines = [
            SimulationLine.objects.create(simulation=sim, product=p, status="ok") for p in products
        ]
        resp = client.post(
            f"/api/simulations/{sim.pk}/lines/bulk-delete/",
            {"line_ids": [str(lines[0].pk), str(lines[2].pk)]},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2
        assert SimulationLine.objects.filter(simulation=sim).count() == 1
        sim.refresh_from_db()
        assert sim.is_dirty is False


# ─── Compare (CDC §6.9.8, §6.9.12) ──────────────────────────────────────────


class TestCompare:
    def _sim_with_line(self, label: str, sku: str, pv: str) -> tuple[Simulation, Product]:
        sim = Simulation.objects.create(label=label, simulation_type=SimulationType.TARIFF)
        product, _ = Product.objects.get_or_create(sku_code=sku, defaults={"name": sku})
        SimulationLine.objects.create(
            simulation=sim,
            product=product,
            status="ok",
            pa_net_eur=Decimal("100"),
            pr_eur=Decimal("110"),
            pv_eur=Decimal(pv),
            effective_margin_rate=Decimal("0.2000"),
            effective_mix_pct=0,
        )
        return sim, product

    def test_compare_two_simulations_returns_matrix(self, client: APIClient) -> None:
        s1, p = self._sim_with_line("A", "CMP-1", "130")
        s2 = Simulation.objects.create(label="B", simulation_type=SimulationType.TARIFF)
        SimulationLine.objects.create(
            simulation=s2,
            product=p,
            status="ok",
            pv_eur=Decimal("140"),
            pr_eur=Decimal("115"),
            effective_margin_rate=Decimal("0.2500"),
            effective_mix_pct=10,
        )
        resp = client.post(
            "/api/simulations/compare",
            {"simulation_ids": [str(s1.pk), str(s2.pk)]},
            format="json",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert [c["type"] for c in body["columns"]] == ["simulation", "simulation"]
        assert body["columns"][0]["aggregates"]["avg_pv_eur"].startswith("130")
        assert body["columns"][0]["aggregates"]["line_count"] == 1
        row = next(r for r in body["products"] if r["product_sku"] == "CMP-1")
        c1 = body["columns"][0]["key"]
        c2 = body["columns"][1]["key"]
        assert row["values"][c1]["pv_eur"] == "130.0000"
        assert row["values"][c2]["pv_eur"] == "140.0000"
        assert row["values"][c2]["effective_margin_rate"] == "0.2500"
        assert row["values"][c2]["effective_mix_pct"] == 10
        ctx = body["columns"][0]["context"]
        assert "market_params" in ctx
        assert "symea_margin_rate" in ctx
        assert body["columns"][0]["aggregates"]["warnings_count"] == 0

    def test_compare_requires_two_to_four(self, client: APIClient) -> None:
        s1, _ = self._sim_with_line("A", "CMP-2", "130")
        resp = client.post(
            "/api/simulations/compare", {"simulation_ids": [str(s1.pk)]}, format="json"
        )
        assert resp.status_code == 400

    def test_compare_with_recalculation_snapshot(self, client: APIClient) -> None:
        s1, p = self._sim_with_line("A", "CMP-3", "150")
        recalc = SimulationRecalculation.objects.create(
            simulation=s1,
            calculated_at=timezone.now(),
            market_params={},
            calculation_chain={},
            stock_purchase_mix_pct=0,
            syskern_margin_rate=Decimal("0.2000"),
            symea_margin_rate=Decimal("0.0600"),
            aggregates={"line_count": 1, "avg_pv_eur": "120.0000"},
            line_snapshots=[
                {
                    "product_id": str(p.pk),
                    "sku": "CMP-3",
                    "designation": "x",
                    "pa_net_eur": "100.0000",
                    "pr_eur": "105.0000",
                    "pv_eur": "120.0000",
                    "effective_margin_rate": "0.2000",
                    "effective_mix_pct": 0,
                }
            ],
            trigger_type=RecalculationTrigger.MANUAL_CURRENT_PARAMS,
        )
        resp = client.post(
            "/api/simulations/compare",
            {"simulation_ids": [str(s1.pk)], "recalculation_ids": [str(recalc.pk)]},
            format="json",
        )
        assert resp.status_code == 200
        body = resp.json()
        types = [c["type"] for c in body["columns"]]
        assert types == ["simulation", "recalculation"]
        recalc_key = body["columns"][1]["key"]
        row = next(r for r in body["products"] if r["product_sku"] == "CMP-3")
        assert row["values"][recalc_key]["pv_eur"] == "120.0000"


# ─── Saved comparisons ───────────────────────────────────────────────────────


class TestSavedComparisons:
    def test_create_list_and_delete(self, client: APIClient) -> None:
        s1 = Simulation.objects.create(label="A", simulation_type=SimulationType.TARIFF)
        s2 = Simulation.objects.create(label="B", simulation_type=SimulationType.TARIFF)
        create = client.post(
            "/api/saved-comparisons/",
            {
                "label": "Ma comparaison",
                "simulation_ids": [str(s1.pk), str(s2.pk)],
                "note": "Test",
            },
            format="json",
        )
        assert create.status_code == 201
        body = create.json()
        assert body["label"] == "Ma comparaison"
        assert body["column_count"] == 2
        assert len(body["columns"]) == 2

        listed = client.get("/api/saved-comparisons/")
        assert listed.status_code == 200
        body_list = listed.json()
        assert body_list["count"] == 1
        assert len(body_list["results"]) == 1

        detail = client.get(f"/api/saved-comparisons/{body['id']}/")
        assert detail.status_code == 200
        assert detail.json()["simulation_ids"] == [str(s1.pk), str(s2.pk)]

        patch = client.patch(
            f"/api/saved-comparisons/{body['id']}/",
            {"label": "Renommée"},
            format="json",
        )
        assert patch.status_code == 200
        assert patch.json()["label"] == "Renommée"

        delete = client.delete(f"/api/saved-comparisons/{body['id']}/")
        assert delete.status_code == 204
        assert SavedComparison.objects.count() == 0

    def test_create_requires_two_columns(self, client: APIClient) -> None:
        s1 = Simulation.objects.create(label="A", simulation_type=SimulationType.TARIFF)
        resp = client.post(
            "/api/saved-comparisons/",
            {"label": "Solo", "simulation_ids": [str(s1.pk)]},
            format="json",
        )
        assert resp.status_code == 400

    def test_create_simulations_only_empty_recalc_list(self, client: APIClient) -> None:
        s1 = Simulation.objects.create(label="A", simulation_type=SimulationType.TARIFF)
        s2 = Simulation.objects.create(label="B", simulation_type=SimulationType.TARIFF)
        resp = client.post(
            "/api/saved-comparisons/",
            {
                "label": "Deux sims",
                "simulation_ids": [str(s1.pk), str(s2.pk)],
                "recalculation_ids": [],
            },
            format="json",
        )
        assert resp.status_code == 201
        assert resp.json()["recalculation_ids"] == []

    def test_patch_simulation_ids(self, client: APIClient) -> None:
        s1 = Simulation.objects.create(label="A", simulation_type=SimulationType.TARIFF)
        s2 = Simulation.objects.create(label="B", simulation_type=SimulationType.TARIFF)
        s3 = Simulation.objects.create(label="C", simulation_type=SimulationType.TARIFF)
        created = client.post(
            "/api/saved-comparisons/",
            {
                "label": "Initiale",
                "simulation_ids": [str(s1.pk), str(s2.pk)],
            },
            format="json",
        )
        assert created.status_code == 201
        comp_id = created.json()["id"]

        patch = client.patch(
            f"/api/saved-comparisons/{comp_id}/",
            {"simulation_ids": [str(s1.pk), str(s3.pk)]},
            format="json",
        )
        assert patch.status_code == 200
        assert patch.json()["simulation_ids"] == [str(s1.pk), str(s3.pk)]
        assert patch.json()["column_count"] == 2


# ─── Recalc history: pagination + detail (CDC §6.9.12) ──────────────────────


class TestRecalcHistory:
    def _sim_with_traces(self, n: int) -> Simulation:
        sim = Simulation.objects.create(label="Hist", simulation_type=SimulationType.TARIFF)
        base = timezone.now()
        for i in range(n):
            SimulationRecalculation.objects.create(
                simulation=sim,
                calculated_at=base + timedelta(minutes=i),
                market_params={},
                calculation_chain={},
                stock_purchase_mix_pct=0,
                syskern_margin_rate=Decimal("0.2000"),
                symea_margin_rate=Decimal("0.0600"),
                aggregates={"line_count": i},
                line_snapshots=[{"sku": f"S-{i}", "pv_eur": "100.0000"}],
                trigger_type=RecalculationTrigger.MANUAL_CURRENT_PARAMS,
            )
        return sim

    def test_list_paginated_desc(self, client: APIClient) -> None:
        sim = self._sim_with_traces(12)
        resp = client.get(f"/api/simulations/{sim.pk}/recalculations/?limit=10")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 12
        assert len(body["results"]) == 10
        # DESC: newest (largest minute offset → line_count 11) first.
        assert body["results"][0]["aggregates"]["line_count"] == 11
        # Light serializer: no per-line snapshot in the list.
        assert "line_snapshots" not in body["results"][0]

    def test_list_second_page(self, client: APIClient) -> None:
        sim = self._sim_with_traces(12)
        resp = client.get(f"/api/simulations/{sim.pk}/recalculations/?limit=10&offset=10")
        assert resp.status_code == 200
        assert len(resp.json()["results"]) == 2

    def test_detail_returns_line_snapshots(self, client: APIClient) -> None:
        sim = self._sim_with_traces(1)
        recalc = sim.recalculations.first()
        assert recalc is not None
        resp = client.get(f"/api/simulations/{sim.pk}/recalculations/{recalc.pk}/")
        assert resp.status_code == 200
        body = resp.json()
        assert body["line_snapshots"][0]["sku"] == "S-0"


# ─── Recalc scope → trigger mapping (CDC §6.9.4) ────────────────────────────


class TestRecalcScopeTrigger:
    def test_params_only_maps_to_current_params_trigger(self) -> None:
        sim = Simulation.objects.create(label="S", simulation_type=SimulationType.TARIFF)
        recalculate_task(str(sim.pk), scope="params_only")
        trace = SimulationRecalculation.objects.filter(simulation=sim).first()
        assert trace is not None
        assert trace.trigger_type == RecalculationTrigger.MANUAL_CURRENT_PARAMS

    def test_with_odoo_refresh_calls_refresh_and_maps_trigger(self, monkeypatch) -> None:
        sim = Simulation.objects.create(label="S", simulation_type=SimulationType.TARIFF)
        called = {}

        def fake_refresh(simulation):
            called["hit"] = True
            return timezone.now(), {}

        monkeypatch.setattr("apps.simulations.tasks.refresh_odoo_for_simulation", fake_refresh)
        recalculate_task(str(sim.pk), scope="with_odoo_refresh")
        assert called.get("hit") is True
        trace = SimulationRecalculation.objects.filter(simulation=sim).first()
        assert trace is not None
        assert trace.trigger_type == RecalculationTrigger.MANUAL_REFRESH_ODOO

    def test_odoo_failure_degrades_instead_of_aborting(self, monkeypatch) -> None:
        """CDC §6.6 robustness — an Odoo outage must not block the recalc."""
        sim = Simulation.objects.create(label="S", simulation_type=SimulationType.TARIFF)

        def boom(simulation):
            raise RuntimeError("Odoo 404")

        monkeypatch.setattr("apps.simulations.tasks.refresh_odoo_for_simulation", boom)

        # The task SUCCEEDS (degraded), surfacing the error rather than raising.
        result = recalculate_task(str(sim.pk), scope="with_odoo_refresh")
        assert "Odoo 404" in result["odoo_refresh_error"]

        # The recalc still ran on current params (trace appended).
        trace = SimulationRecalculation.objects.filter(simulation=sim).first()
        assert trace is not None
        assert trace.trigger_type == RecalculationTrigger.MANUAL_REFRESH_ODOO
        assert "Odoo indisponible" in trace.note


# ─── Odoo bulk refresh service (CDC §6.9.4) ─────────────────────────────────


class TestOdooRefreshService:
    def test_updates_stock_and_converts_pending_to_eur(self, monkeypatch) -> None:
        sim = Simulation.objects.create(
            label="S",
            simulation_type=SimulationType.TARIFF,
            market_params={"fx_eur_usd": "1.25"},
        )
        product = Product.objects.create(
            sku_code="OD-1", name="x", odoo_id=42, stock_quantity=Decimal("0")
        )
        SimulationLine.objects.create(simulation=sim, product=product)

        adapter = MagicMock()
        adapter.get_stock_quantities.return_value = {
            42: OdooStock(
                quantity=Decimal("10"),
                available_quantity=Decimal("8"),
                standard_price_eur=Decimal("5"),
            )
        }
        adapter.get_pending_purchases.return_value = {
            42: [
                OdooPurchaseLine(quantity=Decimal("4"), price_unit=Decimal("12.5"), currency="USD")
            ]
        }
        monkeypatch.setattr(odoo_refresh_mod, "get_odoo_adapter", lambda: adapter)

        _snapshot, pending = odoo_refresh_mod.refresh_odoo_for_simulation(sim)

        product.refresh_from_db()
        assert product.stock_quantity == Decimal("10")
        assert product.pamp_eur == Decimal("5")
        key = str(product.pk)
        assert key in pending
        # 12.5 USD / 1.25 (EUR→USD) = 10.0 EUR
        assert pending[key][0].price_unit_eur == Decimal("10")


# ─── Excel export (CDC §6.9) ────────────────────────────────────────────────


class TestSimulationExport:
    def test_workbook_has_three_sheets(self) -> None:
        sim = Simulation.objects.create(label="Export me", simulation_type=SimulationType.TARIFF)
        product = Product.objects.create(sku_code="XP-1", name="x", range="R")
        SimulationLine.objects.create(
            simulation=sim,
            product=product,
            status="ok",
            pa_net_eur=Decimal("100"),
            pr_eur=Decimal("100"),
            pv_eur=Decimal("130"),
        )
        wb = openpyxl.load_workbook(io.BytesIO(build_simulation_xlsx(sim)))
        assert wb.sheetnames == ["Synthèse", "Résultats", "Breakdown détaillé"]


class TestSavedComparisonFilters:
    """Sidebar filters: has_recalculations + sim_type multi-select (CDC §6.9.8)."""

    def test_has_recalculations_and_sim_type(self, client: APIClient) -> None:
        tariff = Simulation.objects.create(label="T", simulation_type=SimulationType.TARIFF)
        project = Simulation.objects.create(label="P", simulation_type=SimulationType.PROJECT)
        with_recalc = SavedComparison.objects.create(
            label="Avec recalc",
            simulation_ids=[tariff.pk],
            recalculation_ids=[uuid.uuid4()],
        )
        sim_only = SavedComparison.objects.create(
            label="Sim seules",
            simulation_ids=[project.pk],
            recalculation_ids=[],
        )

        def ids(resp):
            return {r["id"] for r in resp.json()["results"]}

        # Structure filter.
        assert ids(client.get("/api/saved-comparisons/?has_recalculations=true")) == {
            str(with_recalc.id)
        }
        assert ids(client.get("/api/saved-comparisons/?has_recalculations=false")) == {
            str(sim_only.id)
        }
        # sim_type: comparison containing a project sim.
        assert ids(client.get("/api/saved-comparisons/?sim_type=project")) == {str(sim_only.id)}
        # Multi-select ORs both types → both comparisons.
        assert ids(client.get("/api/saved-comparisons/?sim_type=tariff,project")) == {
            str(with_recalc.id),
            str(sim_only.id),
        }
