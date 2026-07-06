"""Tests for the offer list filters (left-sidebar module parity, CDC §7.5).

Covers the CSV multi-select behaviour of ``OfferFilter`` (type / status /
generation) + the ``q`` search, exercised through the list endpoint.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.offers.models import GenerationStatus, Offer, OfferStatus, OfferType
from apps.simulations.models import Simulation

pytestmark = pytest.mark.django_db


@pytest.fixture()
def api() -> APIClient:
    return APIClient()


@pytest.fixture()
def sim():
    return Simulation.objects.create(label="S", simulation_type="project", status="finalized")


def _offer(sim, *, label, offer_type, status, generation=GenerationStatus.READY, project=""):
    return Offer.objects.create(
        simulation=sim,
        offer_type=offer_type,
        label=label,
        project_name=project,
        client_ids=[],
        currency="EUR",
        incoterm="EXW",
        export_format="devis_gamma" if offer_type == OfferType.PROJECT else "excel",
        status=status,
        generation_status=generation,
    )


def _ids(resp):
    data = resp.json()
    rows = data["results"] if isinstance(data, dict) else data
    return {r["id"] for r in rows}


def test_status_multi_select_ors_values(api, sim):
    draft = _offer(sim, label="A", offer_type=OfferType.TARIFF, status=OfferStatus.DRAFT)
    sent = _offer(sim, label="B", offer_type=OfferType.PROJECT, status=OfferStatus.SENT)
    won = _offer(sim, label="C", offer_type=OfferType.PROJECT, status=OfferStatus.WON)

    resp = api.get("/api/offers/", {"status": "draft,sent"})
    assert resp.status_code == 200
    got = _ids(resp)
    assert str(draft.id) in got and str(sent.id) in got
    assert str(won.id) not in got


def test_offer_type_and_generation_multi_select(api, sim):
    tariff = _offer(sim, label="T", offer_type=OfferType.TARIFF, status=OfferStatus.DRAFT)
    proj_err = _offer(
        sim,
        label="P",
        offer_type=OfferType.PROJECT,
        status=OfferStatus.DRAFT,
        generation=GenerationStatus.ERROR,
    )

    assert _ids(api.get("/api/offers/", {"offer_type": "tariff"})) == {str(tariff.id)}
    assert _ids(api.get("/api/offers/", {"generation_status": "error,generating"})) == {
        str(proj_err.id)
    }


def test_q_searches_label_and_project_name(api, sim):
    a = _offer(sim, label="Câble blindé", offer_type=OfferType.TARIFF, status=OfferStatus.DRAFT)
    b = _offer(
        sim,
        label="Autre",
        offer_type=OfferType.PROJECT,
        status=OfferStatus.DRAFT,
        project="Chantier blindé",
    )
    _offer(sim, label="Rien", offer_type=OfferType.TARIFF, status=OfferStatus.DRAFT)

    got = _ids(api.get("/api/offers/", {"q": "blindé"}))
    assert got == {str(a.id), str(b.id)}


def test_empty_or_unknown_values_are_ignored(api, sim):
    o = _offer(sim, label="X", offer_type=OfferType.TARIFF, status=OfferStatus.DRAFT)
    # Unknown token → filter is a no-op (returns everything), never a 500.
    assert str(o.id) in _ids(api.get("/api/offers/", {"status": "bogus"}))
    assert str(o.id) in _ids(api.get("/api/offers/", {"status": ""}))
