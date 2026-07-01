"""Tests for offer lifecycle (CDC §7.5 / §7.6): status transitions, versioning,
extend-expiration, and the daily expiration cron (auto-expire + J-7 alert)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.offers.models import Offer, OfferAlertConfig, OfferStatus, OfferType
from apps.offers.tasks import daily_expiration_check
from apps.simulations.models import Simulation

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client_api() -> APIClient:
    return APIClient()


@pytest.fixture()
def sim():
    return Simulation.objects.create(label="S", simulation_type="project", status="finalized")


def _offer(
    sim, *, offer_type=OfferType.PROJECT, status=OfferStatus.DRAFT, valid_to=None, version=1
):
    return Offer.objects.create(
        simulation=sim,
        offer_type=offer_type,
        label="Offre X",
        client_ids=[],
        currency="EUR",
        incoterm="EXW",
        export_format="devis_gamma" if offer_type == OfferType.PROJECT else "excel",
        status=status,
        valid_to=valid_to,
        version_number=version,
    )


# ── Status transitions ────────────────────────────────────────────────────────


def test_draft_to_sent_ok(client_api, sim):
    o = _offer(sim)
    resp = client_api.patch(f"/api/offers/{o.id}/status/", {"status": "sent"}, format="json")
    assert resp.status_code == 200
    o.refresh_from_db()
    assert o.status == "sent" and o.sent_at is not None


# ── Delete (only destructive action, guarded while generating) ────────────────


def test_delete_offer_ok(client_api, sim):
    o = _offer(sim)
    resp = client_api.delete(f"/api/offers/{o.id}/")
    assert resp.status_code == 204
    assert not Offer.objects.filter(id=o.id).exists()


def test_cannot_delete_generating_offer(client_api, sim):
    from apps.offers.models import GenerationStatus

    o = _offer(sim)
    Offer.objects.filter(id=o.id).update(generation_status=GenerationStatus.GENERATING)
    resp = client_api.delete(f"/api/offers/{o.id}/")
    assert resp.status_code == 400
    assert Offer.objects.filter(id=o.id).exists()


def test_draft_to_won_rejected(client_api, sim):
    o = _offer(sim)
    resp = client_api.patch(f"/api/offers/{o.id}/status/", {"status": "won"}, format="json")
    assert resp.status_code == 400  # must pass through sent


def test_sent_to_won_ok_for_project(client_api, sim):
    o = _offer(sim, status=OfferStatus.SENT)
    resp = client_api.patch(f"/api/offers/{o.id}/status/", {"status": "won"}, format="json")
    assert resp.status_code == 200
    o.refresh_from_db()
    assert o.status == "won" and o.won_at is not None


def test_won_lost_rejected_for_tariff(client_api, sim):
    o = _offer(sim, offer_type=OfferType.TARIFF, status=OfferStatus.SENT)
    resp = client_api.patch(f"/api/offers/{o.id}/status/", {"status": "won"}, format="json")
    assert resp.status_code == 400


# ── Versioning V1→V2→V3 ───────────────────────────────────────────────────────


def test_new_version_chains_project(client_api, sim):
    v1 = _offer(sim, status=OfferStatus.SENT)
    r2 = client_api.post(f"/api/offers/{v1.id}/new-version/")
    assert r2.status_code == 201
    v2 = Offer.objects.get(id=r2.json()["id"])
    assert v2.version_number == 2
    assert str(v2.previous_offer_id) == str(v1.id)
    assert v2.status == "draft"

    r3 = client_api.post(f"/api/offers/{v2.id}/new-version/")
    v3 = Offer.objects.get(id=r3.json()["id"])
    assert v3.version_number == 3

    # versions chain endpoint returns all three.
    chain = client_api.get(f"/api/offers/{v3.id}/versions/").json()
    assert [c["version_number"] for c in chain] == [1, 2, 3]


def test_new_version_rejected_for_tariff(client_api, sim):
    o = _offer(sim, offer_type=OfferType.TARIFF)
    assert client_api.post(f"/api/offers/{o.id}/new-version/").status_code == 400


# ── Extend expiration ─────────────────────────────────────────────────────────


def test_extend_expiration_ok(client_api, sim):
    o = _offer(sim, status=OfferStatus.SENT, valid_to=timezone.now().date() + timedelta(days=2))
    new_date = (timezone.now().date() + timedelta(days=30)).isoformat()
    resp = client_api.post(
        f"/api/offers/{o.id}/extend-expiration/", {"new_date": new_date}, format="json"
    )
    assert resp.status_code == 200
    o.refresh_from_db()
    assert o.valid_to.isoformat() == new_date


def test_extend_expiration_too_soon_rejected(client_api, sim):
    o = _offer(sim, status=OfferStatus.SENT)
    soon = (timezone.now().date() + timedelta(days=3)).isoformat()
    resp = client_api.post(
        f"/api/offers/{o.id}/extend-expiration/", {"new_date": soon}, format="json"
    )
    assert resp.status_code == 400


def test_extend_expiration_reactivates_expired(client_api, sim):
    o = _offer(sim, status=OfferStatus.EXPIRED, valid_to=timezone.now().date() - timedelta(days=1))
    new_date = (timezone.now().date() + timedelta(days=30)).isoformat()
    client_api.post(f"/api/offers/{o.id}/extend-expiration/", {"new_date": new_date}, format="json")
    o.refresh_from_db()
    assert o.status == "sent"


# ── Daily expiration cron ─────────────────────────────────────────────────────


def test_cron_auto_expires_overdue_sent(sim):
    o = _offer(sim, status=OfferStatus.SENT, valid_to=timezone.now().date() - timedelta(days=1))
    daily_expiration_check()
    o.refresh_from_db()
    assert o.status == "expired"


def test_cron_does_not_expire_won(sim):
    o = _offer(sim, status=OfferStatus.WON, valid_to=timezone.now().date() - timedelta(days=1))
    daily_expiration_check()
    o.refresh_from_db()
    assert o.status == "won"  # won/lost never auto-expired


def test_cron_alert_emailed_within_7_days(sim, settings, mailoutbox):
    settings.OFFERS = {"EXPIRATION_CRON_ENABLED": True, "FRONTEND_BASE_URL": "http://app"}
    OfferAlertConfig.objects.create(recipients=["yassine@boldys.ai"])  # UI-configured
    near = _offer(sim, status=OfferStatus.SENT, valid_to=timezone.now().date() + timedelta(days=5))
    _offer(sim, status=OfferStatus.SENT, valid_to=timezone.now().date() + timedelta(days=10))  # far

    daily_expiration_check()
    assert len(mailoutbox) == 1
    body = mailoutbox[0].body
    assert f"http://app/offers/{near.id}" in body
    assert mailoutbox[0].to == ["yassine@boldys.ai"]


def test_cron_no_email_without_configured_recipients(sim, settings, mailoutbox):
    """No recipients configured in the UI → no email even with expiring offers."""
    settings.OFFERS = {"EXPIRATION_CRON_ENABLED": True, "FRONTEND_BASE_URL": "http://app"}
    _offer(sim, status=OfferStatus.SENT, valid_to=timezone.now().date() + timedelta(days=5))
    daily_expiration_check()
    assert len(mailoutbox) == 0


def test_cron_no_alert_beyond_7_days(sim, settings, mailoutbox):
    settings.OFFERS = {"EXPIRATION_CRON_ENABLED": True, "FRONTEND_BASE_URL": "http://app"}
    OfferAlertConfig.objects.create(recipients=["yassine@boldys.ai"])
    _offer(sim, status=OfferStatus.SENT, valid_to=timezone.now().date() + timedelta(days=10))
    daily_expiration_check()
    assert len(mailoutbox) == 0


def test_cron_killswitch_disables(sim, settings):
    settings.OFFERS = {"EXPIRATION_CRON_ENABLED": False, "FRONTEND_BASE_URL": ""}
    o = _offer(sim, status=OfferStatus.SENT, valid_to=timezone.now().date() - timedelta(days=1))
    result = daily_expiration_check()
    assert result == {"enabled": False}
    o.refresh_from_db()
    assert o.status == "sent"  # untouched


# ── Alert recipients config (UI-editable) ─────────────────────────────────────


def test_alert_settings_get_default_empty(client_api):
    resp = client_api.get("/api/offers/alert-settings")
    assert resp.status_code == 200
    assert resp.json() == {"recipients": []}


def test_alert_settings_put_persists(client_api):
    resp = client_api.put(
        "/api/offers/alert-settings",
        {"recipients": ["a@x.com", "b@y.com"]},
        format="json",
    )
    assert resp.status_code == 200
    assert OfferAlertConfig.load().recipients == ["a@x.com", "b@y.com"]
    # Singleton: no duplicate rows created.
    assert OfferAlertConfig.objects.count() == 1


def test_alert_settings_rejects_invalid_email(client_api):
    resp = client_api.put(
        "/api/offers/alert-settings", {"recipients": ["not-an-email"]}, format="json"
    )
    assert resp.status_code == 400
