"""`POST /api/odoo/sync/trigger` — c'est le déploiement qui choisit l'instance.

Régression réelle : le serializer ET le client front posaient tous deux
`api_version="v19"` en dur. Un environnement configuré `ODOO_API_VERSION=v16`
partait donc quand même sur l'instance d'upgrade v19 et échouait en
`Connection refused` — sans que la config y change quoi que ce soit.
"""

from __future__ import annotations

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from apps.accounts.models import Profile, Role
from apps.odoo_sync.serializers import TriggerSyncSerializer

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client() -> APIClient:
    user = User.objects.create_user(username="a@b.c", email="a@b.c", password="x")
    Profile.objects.update_or_create(user=user, defaults={"role": Role.ADMIN})
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_api_version_omitted_leaves_the_choice_to_the_deployment():
    ser = TriggerSyncSerializer(data={"scope": "all"})
    assert ser.is_valid(), ser.errors
    # Ni clé, ni valeur : `sync()` retombera sur settings.ODOO["API_VERSION"].
    assert ser.validated_data.get("api_version") is None


def test_api_version_still_overridable_explicitly():
    ser = TriggerSyncSerializer(data={"scope": "products", "api_version": "v19"})
    assert ser.is_valid(), ser.errors
    assert ser.validated_data["api_version"] == "v19"


def test_invalid_api_version_rejected():
    ser = TriggerSyncSerializer(data={"scope": "all", "api_version": "v42"})
    assert not ser.is_valid()
    assert "api_version" in ser.errors


def test_trigger_without_version_uses_settings(admin_client, settings, monkeypatch):
    """Le bout en bout : config v16 + appel sans version → la tâche reçoit v16."""
    settings.ODOO = {**settings.ODOO, "API_VERSION": "v16"}
    captured: dict = {}

    class _Result:
        id = "task-123"

    def _fake_delay(**kwargs):
        captured.update(kwargs)
        return _Result()

    monkeypatch.setattr("apps.odoo_sync.views.sync_task.delay", _fake_delay)

    resp = admin_client.post("/api/odoo/sync/trigger", {"scope": "all"}, format="json")
    assert resp.status_code == 202
    # La vue transmet None → `sync()` lira ODOO_API_VERSION (v16 ici).
    assert captured["api_version"] is None
    assert captured["scope"] == "all"
