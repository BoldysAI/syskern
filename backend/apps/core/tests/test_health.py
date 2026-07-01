"""Tests for the health endpoint (CDC §9.6)."""

from __future__ import annotations

from unittest import mock

import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_ok(client):
    """DB reachable → 200 + status ok."""
    resp = client.get(reverse("health"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"


@pytest.mark.django_db
def test_health_no_auth_required(client):
    """The endpoint is public (no session / token needed)."""
    resp = client.get("/api/health")
    assert resp.status_code == 200


def test_health_db_down_returns_503():
    """DB failure → 503 with the error detail, never a 500 traceback."""
    with mock.patch(
        "apps.core.health.connection.cursor",
        side_effect=Exception("could not connect to server"),
    ):
        from django.test import Client

        resp = Client().get("/api/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "error"
    assert body["database"] == "error"
    assert "could not connect" in body["detail"]
