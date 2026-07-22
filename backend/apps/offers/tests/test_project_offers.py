"""Tests for project-offer generation (CDC §7.3) — OpenAI + Gamma orchestration.

External calls are mocked: a fake GammaClient and a stubbed `generate_arguments`.
Covers offer/line creation with quantities, the 5-section payload, OpenAI-failure
(offer still generated), Gamma-failure (error status + retry), and the 400 guards.
"""

from __future__ import annotations

import types
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.clients.models import Client
from apps.offers.models import GenerationStatus, Offer, OfferType
from apps.offers.services import project_generator as pg
from apps.offers.services.gamma import GammaError, GammaGeneration
from apps.offers.tasks import generate_project_offer_task, regenerate_project_offer_task
from apps.products.models import Product
from apps.simulations.models import Simulation, SimulationLine

pytestmark = pytest.mark.django_db


# ── Fakes ────────────────────────────────────────────────────────────────────


class FakeGamma:
    """Succeeds, returning a completed generation + HTML snapshot."""

    def generate_and_wait(self, payload, **kwargs):
        self.payload = payload
        return GammaGeneration(
            generation_id="gen_abc123",
            status="completed",
            gamma_url="https://gamma.app/docs/abc123",
            export_url="https://export/abc123.pdf",
        )

    def fetch_public_html(self, url):
        return "<html><body>devis</body></html>"


class FailingGamma:
    def generate_and_wait(self, payload, **kwargs):
        raise GammaError("Gamma 500: boom")

    def fetch_public_html(self, url):
        return None


@pytest.fixture()
def client_api() -> APIClient:
    return APIClient()


@pytest.fixture()
def snapshot_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(pg, "SNAPSHOT_DIR", tmp_path)
    return tmp_path


@pytest.fixture()
def fake_args(monkeypatch):
    monkeypatch.setattr(
        pg,
        "generate_arguments",
        lambda **kwargs: {"technical": "Tech", "commercial": "Comm", "logistic": "Logi"},
    )


@pytest.fixture()
def project_sim():
    # Build as draft, add the lines, then finalize: the DB guard trigger
    # (simulation_lines_guard_finalized_parent) blocks line inserts once the
    # parent is finalized, so the lines must exist first.
    sim = Simulation.objects.create(
        label="Datacenter Marseille",
        simulation_type="project",
        status="draft",
        market_params={"fx_eur_usd": "1.15"},
    )
    p1 = Product.objects.create(sku_code="CABLE-1", name="Câble cat7", range="Cat7")
    p2 = Product.objects.create(sku_code="RACK-1", name="Baie 42U", range="Racks")
    SimulationLine.objects.create(simulation=sim, product=p1, pv_eur=Decimal("487.70"), status="ok")
    SimulationLine.objects.create(
        simulation=sim, product=p2, pv_eur=Decimal("1200.00"), status="ok"
    )
    Simulation.objects.filter(pk=sim.pk).update(status="finalized")
    sim.refresh_from_db()
    return sim


@pytest.fixture()
def project_client():
    return Client.objects.create(name="Datacenter Corp")


def _params(client, **over):
    p = {
        "client_id": str(client.id),
        "project_name": "Datacenter Marseille — Phase 1",
        "quantities": {"CABLE-1": 50, "RACK-1": 4},
        "language": "fr",
        "expiration_date": "2026-09-30",
        "ai_instructions": "Mettre en avant la conformité CPR.",
        "sections_config": None,
    }
    p.update(over)
    return p


# ── Endpoint guards ──────────────────────────────────────────────────────────


def test_endpoint_returns_202(client_api, project_sim, project_client, monkeypatch):
    monkeypatch.setattr(
        generate_project_offer_task, "delay", lambda *a, **k: types.SimpleNamespace(id="task-1")
    )
    resp = client_api.post(
        f"/api/simulations/{project_sim.id}/generate-project-offer/",
        _params(project_client),
        format="json",
    )
    assert resp.status_code == 202
    assert resp.json()["task_id"] == "task-1"


def test_tariff_simulation_returns_400(client_api, project_client):
    sim = Simulation.objects.create(label="T", simulation_type="tariff", status="finalized")
    resp = client_api.post(
        f"/api/simulations/{sim.id}/generate-project-offer/",
        _params(project_client),
        format="json",
    )
    assert resp.status_code == 400


def test_draft_simulation_returns_400(client_api, project_sim, project_client):
    project_sim.status = "draft"
    project_sim.save(update_fields=["status"])
    resp = client_api.post(
        f"/api/simulations/{project_sim.id}/generate-project-offer/",
        _params(project_client),
        format="json",
    )
    assert resp.status_code == 400


def test_invalid_quantity_rejected(client_api, project_sim, project_client):
    resp = client_api.post(
        f"/api/simulations/{project_sim.id}/generate-project-offer/",
        _params(project_client, quantities={"CABLE-1": 0}),
        format="json",
    )
    assert resp.status_code == 400


# ── Generation (task run eagerly with fakes) ──────────────────────────────────


def _run(sim, params):
    return generate_project_offer_task.apply(args=[str(sim.id), params]).get()


def test_generation_success(snapshot_dir, fake_args, monkeypatch, project_sim, project_client):
    monkeypatch.setattr(pg, "GammaClient", FakeGamma)
    result = _run(project_sim, _params(project_client))

    assert result["generation_status"] == GenerationStatus.READY
    assert result["gamma_document_id"] == "gen_abc123"
    offer = Offer.objects.get(id=result["offer_id"])
    assert offer.offer_type == OfferType.PROJECT
    assert [str(c) for c in offer.client_ids] == [str(project_client.id)]
    assert offer.generated_file_url == "https://gamma.app/docs/abc123"
    assert offer.project_info["gamma_export_url"] == "https://export/abc123.pdf"
    # Quantities landed on the lines.
    qmap = {ln.product.sku_code: ln.quantity for ln in offer.lines.select_related("product")}
    assert qmap == {"CABLE-1": Decimal("50"), "RACK-1": Decimal("4")}
    # AI arguments cached, snapshot written.
    assert offer.ai_arguments["technical"] == "Tech"
    assert (snapshot_dir / f"{offer.id}.html").is_file()


def test_openai_failure_still_generates(snapshot_dir, monkeypatch, project_sim, project_client):
    monkeypatch.setattr(pg, "GammaClient", FakeGamma)
    monkeypatch.setattr(pg, "generate_arguments", lambda **kwargs: None)  # OpenAI down
    result = _run(project_sim, _params(project_client))

    assert result["generation_status"] == GenerationStatus.READY  # offer still generated
    offer = Offer.objects.get(id=result["offer_id"])
    assert not any(offer.ai_arguments.get(k) for k in ("technical", "commercial", "logistic"))


def test_gamma_failure_marks_error_then_retry_succeeds(
    snapshot_dir, fake_args, monkeypatch, project_sim, project_client
):
    monkeypatch.setattr(pg, "GammaClient", FailingGamma)
    result = _run(project_sim, _params(project_client))
    assert result["generation_status"] == GenerationStatus.ERROR
    assert "boom" in result["error"]
    offer_id = result["offer_id"]

    # Retry with Gamma back up.
    monkeypatch.setattr(pg, "GammaClient", FakeGamma)
    retry = regenerate_project_offer_task.apply(args=[offer_id]).get()
    assert retry["generation_status"] == GenerationStatus.READY
    assert Offer.objects.get(id=offer_id).generation_error == ""


def test_regenerate_endpoint(
    client_api, snapshot_dir, fake_args, monkeypatch, project_sim, project_client
):
    monkeypatch.setattr(pg, "GammaClient", FailingGamma)
    offer_id = _run(project_sim, _params(project_client))["offer_id"]
    monkeypatch.setattr(
        regenerate_project_offer_task, "delay", lambda *a, **k: types.SimpleNamespace(id="rt-1")
    )
    resp = client_api.post(f"/api/offers/{offer_id}/regenerate/")
    assert resp.status_code == 202
    assert resp.json()["task_id"] == "rt-1"


# ── B1: generation must ALWAYS reach a terminal state (never stuck) ───────────


class BrokenGamma:
    """Raises a non-Gamma exception (network/library bug) mid-generation."""

    def generate_and_wait(self, payload, **kwargs):
        raise RuntimeError("network exploded")

    def fetch_public_html(self, url):
        return None


class TimeoutGamma:
    def generate_and_wait(self, payload, **kwargs):
        from celery.exceptions import SoftTimeLimitExceeded

        raise SoftTimeLimitExceeded()

    def fetch_public_html(self, url):
        return None


class SnapshotFailGamma(FakeGamma):
    def fetch_public_html(self, url):
        raise OSError("disk full")


def _new_offer(project_sim, project_client):
    return pg.create_project_offer(
        simulation=project_sim,
        client=project_client,
        project_name="X",
        quantities={},
        language="fr",
        expiration_date=None,
        ai_instructions="",
        sections_config=None,
    )


def test_unexpected_exception_marks_error_not_stuck(
    snapshot_dir, fake_args, monkeypatch, project_sim, project_client
):
    """A non-GammaError failure must end the offer in ERROR, never GENERATING."""
    monkeypatch.setattr(pg, "GammaClient", BrokenGamma)
    result = _run(project_sim, _params(project_client))
    assert result["generation_status"] == GenerationStatus.ERROR
    offer = Offer.objects.get(id=result["offer_id"])
    assert offer.generation_status == GenerationStatus.ERROR
    assert "network exploded" in offer.generation_error


def test_payload_build_failure_marks_error(
    snapshot_dir, fake_args, monkeypatch, project_sim, project_client
):
    """A failure BEFORE the Gamma call (payload/OpenAI) must also terminalise."""

    def _boom(*args, **kwargs):
        raise ValueError("payload broken")

    monkeypatch.setattr(pg, "GammaClient", FakeGamma)
    monkeypatch.setattr(pg, "build_gamma_payload", _boom)
    result = _run(project_sim, _params(project_client))
    assert result["generation_status"] == GenerationStatus.ERROR
    assert "payload broken" in Offer.objects.get(id=result["offer_id"]).generation_error


def test_soft_time_limit_marks_error_and_reraises(
    snapshot_dir, fake_args, monkeypatch, project_sim, project_client
):
    from celery.exceptions import SoftTimeLimitExceeded

    monkeypatch.setattr(pg, "GammaClient", TimeoutGamma)
    offer = _new_offer(project_sim, project_client)
    with pytest.raises(SoftTimeLimitExceeded):
        pg.run_generation(offer)
    offer.refresh_from_db()
    assert offer.generation_status == GenerationStatus.ERROR


def test_snapshot_failure_keeps_ready(
    snapshot_dir, fake_args, monkeypatch, project_sim, project_client
):
    """A best-effort HTML snapshot error must NOT flip a READY offer to error."""
    monkeypatch.setattr(pg, "GammaClient", SnapshotFailGamma)
    result = _run(project_sim, _params(project_client))
    assert result["generation_status"] == GenerationStatus.READY


def test_reap_stuck_generation_marks_error(project_sim, project_client):
    from datetime import timedelta

    from django.utils import timezone

    from apps.offers.tasks import reap_stuck_generations

    offer = _new_offer(project_sim, project_client)
    old = timezone.now() - timedelta(minutes=30)
    Offer.objects.filter(pk=offer.pk).update(
        generation_status=GenerationStatus.GENERATING, updated_at=old
    )
    result = reap_stuck_generations.apply(args=[15]).get()
    assert result["reaped"] == 1
    offer.refresh_from_db()
    assert offer.generation_status == GenerationStatus.ERROR
    assert "interrompue" in offer.generation_error


def test_reap_leaves_recent_generation(project_sim, project_client):
    from apps.offers.tasks import reap_stuck_generations

    offer = _new_offer(project_sim, project_client)
    Offer.objects.filter(pk=offer.pk).update(generation_status=GenerationStatus.GENERATING)
    result = reap_stuck_generations.apply(args=[15]).get()
    assert result["reaped"] == 0
    offer.refresh_from_db()
    assert offer.generation_status == GenerationStatus.GENERATING


def test_regenerate_rejected_for_tariff(client_api, project_sim):
    offer = Offer.objects.create(
        simulation=project_sim,
        offer_type=OfferType.TARIFF,
        label="t",
        client_ids=[],
        currency="EUR",
        incoterm="EXW",
        export_format="excel",
    )
    resp = client_api.post(f"/api/offers/{offer.id}/regenerate/")
    assert resp.status_code == 400


# ── Gamma payload builder ──────────────────────────────────────────────────────


def test_build_gamma_payload_has_5_sections_and_price_table(fake_args, project_sim, project_client):
    offer = pg.create_project_offer(
        simulation=project_sim,
        client=project_client,
        project_name="Datacenter Marseille",
        quantities={"CABLE-1": 50, "RACK-1": 4},
        language="fr",
        expiration_date=None,
        ai_instructions="conformité CPR",
    )
    payload = pg.build_gamma_payload(
        offer, arguments={"technical": "T", "commercial": "C", "logistic": "L"}
    )
    assert payload["format"] == "presentation"
    assert payload["numCards"] == 5  # all sections enabled by default
    assert payload["textOptions"]["language"] == "fr"
    assert payload["exportAs"] == "pdf"
    assert payload["additionalInstructions"] == "conformité CPR"
    # Gamma best practices: preserve mode + split on our section breaks (avoids
    # `deck_too_large` export failures); `amount` is ignored in preserve mode.
    assert payload["textMode"] == "preserve"
    assert payload["cardSplit"] == "inputTextBreaks"
    assert "amount" not in payload["textOptions"]
    text = payload["inputText"]
    assert "Datacenter Marseille" in text
    assert "CABLE-1" in text and "RACK-1" in text  # price table rows
    assert "487.70 EUR" in text


def test_price_table_ends_with_grand_total(fake_args, project_sim, project_client):
    """Le tableau de prix se termine par le total général (FEEDBACK 2)."""
    offer = pg.create_project_offer(
        simulation=project_sim,
        client=project_client,
        project_name="Datacenter Marseille",
        quantities={"CABLE-1": 50, "RACK-1": 4},
        language="fr",
        expiration_date=None,
        ai_instructions="",
    )
    table = pg._price_table_markdown(offer, "fr")
    expected = sum(
        (ln.final_price or Decimal(0)) * (ln.quantity or Decimal(0)) for ln in offer.lines.all()
    )
    last_row = table.splitlines()[-1]
    assert "**Total général**" in last_row
    assert f"**{expected:.2f} {offer.currency}**" in last_row
    # Une ligne par produit + en-tête + séparateur + total.
    assert len(table.splitlines()) == offer.lines.count() + 3


def test_price_table_grand_total_is_localised(fake_args, project_sim, project_client):
    offer = pg.create_project_offer(
        simulation=project_sim,
        client=project_client,
        project_name="P",
        quantities={"CABLE-1": 1},
        language="en",
        expiration_date=None,
        ai_instructions="",
    )
    assert "**Grand total**" in pg._price_table_markdown(offer, "en").splitlines()[-1]
    assert "**Total general**" in pg._price_table_markdown(offer, "es").splitlines()[-1]


def test_build_payload_respects_disabled_sections(fake_args, project_sim, project_client):
    offer = pg.create_project_offer(
        simulation=project_sim,
        client=project_client,
        project_name="P",
        quantities={"CABLE-1": 1},
        language="en",
        expiration_date=None,
        ai_instructions="",
        sections_config={
            "cover": True,
            "presentation": False,
            "pricing": True,
            "arguments": False,
            "conditions": True,
        },
    )
    payload = pg.build_gamma_payload(offer, arguments=None)
    assert payload["numCards"] == 3


# ── ai_arguments (OpenAI wrapper) ──────────────────────────────────────────────


class _OAIOk:
    def generate_json(self, **kwargs):
        self.kwargs = kwargs
        return {"technical": "T", "commercial": "C", "logistic": "L"}


class _OAIFail:
    def generate_json(self, **kwargs):
        from apps.offers.services.openai_client import OpenAIError

        raise OpenAIError("429 rate limited")


def test_generate_arguments_returns_three(monkeypatch):
    from apps.offers.services.ai_arguments import generate_arguments

    out = generate_arguments(
        products=[{"sku_code": "A", "name": "Câble", "range": "Cat7"}],
        client_info={"name": "X"},
        project_name="P",
        user_instructions="CPR",
        language="fr",
        client=_OAIOk(),
    )
    assert out == {"technical": "T", "commercial": "C", "logistic": "L"}


def test_generate_arguments_none_on_openai_error():
    from apps.offers.services.ai_arguments import generate_arguments

    out = generate_arguments(
        products=[],
        client_info={},
        project_name="P",
        user_instructions="",
        language="fr",
        client=_OAIFail(),
    )
    assert out is None  # no exception, graceful fallback
