"""Tests for the quarantine API (CDC §8.7): list, filters, facets, resolve.

Confirms there is no auto-reinjection endpoint and that DELETE is not allowed —
resolution (with resolver email + note) is the only mutation.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.data_migration.models import MigrationUnmatched, ResolutionAction, UnmatchedReason
from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def rows():
    a = MigrationUnmatched.objects.create(
        source_file="PO_Symea.xlsx",
        source_row_number=3,
        raw_data={"sku": "A"},
        reason=UnmatchedReason.NO_MATCH,
    )
    b = MigrationUnmatched.objects.create(
        source_file="PO_Symea.xlsx",
        source_row_number=8,
        raw_data={"sku": "B"},
        reason=UnmatchedReason.DUPLICATE_MATCH,
    )
    c = MigrationUnmatched.objects.create(
        source_file="technique.xlsx",
        source_row_number=1,
        raw_data={"sku": "C"},
        reason=UnmatchedReason.NO_SKU,
    )
    return a, b, c


def test_list_paginated(client, rows):
    resp = client.get("/api/migration/unmatched/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 3
    assert len(body["results"]) == 3


def test_filter_by_reason(client, rows):
    resp = client.get("/api/migration/unmatched/?reason=no_match")
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_filter_by_source_file(client, rows):
    resp = client.get("/api/migration/unmatched/?source_file=PO_Symea.xlsx")
    assert resp.json()["count"] == 2


def test_filter_by_resolved_status(client, rows):
    a, _b, _c = rows
    client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"resolved_by": "olivier@syskern.com", "resolution_notes": "créé manuellement"},
        format="json",
    )
    assert client.get("/api/migration/unmatched/?resolved=true").json()["count"] == 1
    assert client.get("/api/migration/unmatched/?resolved=false").json()["count"] == 2


def test_facets(client, rows):
    resp = client.get("/api/migration/unmatched/facets/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert body["unresolved"] == 3
    assert body["by_reason"]["no_match"] == 1
    assert set(body["source_files"]) == {"PO_Symea.xlsx", "technique.xlsx"}


def test_resolve_persists_via_post(client, rows):
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"resolved_by": "olivier@syskern.com", "resolution_notes": "produit créé via /catalog/new"},
        format="json",
    )
    assert resp.status_code == 200
    a.refresh_from_db()
    assert a.resolved_at is not None
    assert a.resolved_by == "olivier@syskern.com"
    assert a.resolution_notes == "produit créé via /catalog/new"


def test_resolve_persists_via_patch(client, rows):
    a, _b, _c = rows
    resp = client.patch(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"resolved_by": "paul@syskern.com"},
        format="json",
    )
    assert resp.status_code == 200
    a.refresh_from_db()
    assert a.resolved_by == "paul@syskern.com"


def test_resolve_requires_valid_email(client, rows):
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"resolved_by": "not-an-email"},
        format="json",
    )
    assert resp.status_code == 400


def test_delete_not_allowed_no_reinjection(client, rows):
    """No destructive / auto-reinject endpoint by design (CDC §8.7)."""
    a, _b, _c = rows
    resp = client.delete(f"/api/migration/unmatched/{a.id}/")
    assert resp.status_code == 405


# ── Resolution actions execute the arbitrage (A3 UX) ──────────────────────────


def test_resolve_ignore_records_action(client, rows):
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"action": "ignore", "resolved_by": "olivier@syskern.com"},
        format="json",
    )
    assert resp.status_code == 200
    a.refresh_from_db()
    assert a.resolution_action == ResolutionAction.IGNORE
    assert a.resolved_at is not None


def test_resolve_delete_records_action_soft(client, rows):
    """`delete` flags the row resolved+discarded — no hard-delete (audit kept)."""
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"action": "delete", "resolved_by": "olivier@syskern.com"},
        format="json",
    )
    assert resp.status_code == 200
    a.refresh_from_db()
    assert a.resolution_action == ResolutionAction.DELETE
    assert MigrationUnmatched.objects.filter(id=a.id).exists()  # still there, just resolved


def test_resolve_create_makes_product(client, rows):
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {
            "action": "create",
            "product": {"sku_code": "KCFF6A4PZHDBL5-21", "name": "Câble cat7"},
        },
        format="json",
    )
    assert resp.status_code == 200
    product = Product.objects.get(sku_code="KCFF6A4PZHDBL5-21")
    assert product.name == "Câble cat7"
    # SKU parsing wired: factory_code / parent_reference derived.
    assert product.factory_code == "21"
    assert product.parent_reference == "KCFF6A4PZHDBL5"
    a.refresh_from_db()
    assert a.resolution_action == ResolutionAction.CREATE
    assert "KCFF6A4PZHDBL5-21" in a.resolution_notes


def test_resolve_create_applies_attribute_defaults(client, rows):
    from apps.attributes.models import (
        AttributeCategory,
        AttributeDataType,
        AttributeRegistry,
        ProductAttributeValue,
    )

    attr = AttributeRegistry.objects.create(
        code="quarantine_default",
        label={"fr": "Défaut quarantaine"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.NUMBER,
        default_value=10,
        is_filterable=True,
    )
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {
            "action": "create",
            "product": {"sku_code": "Q-DEFAULT-1", "name": "Produit quarantaine"},
        },
        format="json",
    )
    assert resp.status_code == 200
    product = Product.objects.get(sku_code="Q-DEFAULT-1")
    pav = ProductAttributeValue.objects.get(product=product, attribute=attr)
    assert pav.value == 10


def test_resolve_create_requires_product(client, rows):
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"action": "create"},
        format="json",
    )
    assert resp.status_code == 400


def test_resolve_create_rejects_duplicate_sku(client, rows):
    a, _b, _c = rows
    Product.objects.create(sku_code="DUP-1", name="Exists")
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/",
        {"action": "create", "product": {"sku_code": "DUP-1"}},
        format="json",
    )
    assert resp.status_code == 400
    a.refresh_from_db()
    assert a.resolved_at is None  # not resolved when creation fails


def test_resolve_defaults_resolved_by_when_absent(client, rows):
    a, _b, _c = rows
    resp = client.post(
        f"/api/migration/unmatched/{a.id}/resolve/", {"action": "ignore"}, format="json"
    )
    assert resp.status_code == 200
    a.refresh_from_db()
    assert a.resolved_by  # falls back (logged-in email or "système"), never blank-required
