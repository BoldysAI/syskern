"""Tests for the quarantine API (CDC §8.7): list, filters, facets, resolve.

Confirms there is no auto-reinjection endpoint and that DELETE is not allowed —
resolution (with resolver email + note) is the only mutation.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.data_migration.models import MigrationUnmatched, UnmatchedReason

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
