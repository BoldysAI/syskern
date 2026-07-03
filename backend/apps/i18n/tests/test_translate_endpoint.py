"""POST /api/translate endpoint (CDC §10.4.2)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.i18n import views
from apps.offers.services.translation import (
    TranslationError,
    TranslationQuotaError,
    TranslationUnavailableError,
)

pytestmark = pytest.mark.django_db


@pytest.fixture()
def api() -> APIClient:
    return APIClient()


def test_single_translation(api, monkeypatch):
    monkeypatch.setattr(views, "translate_cached", lambda *a, **k: ("Hello", False))
    resp = api.post(
        "/api/translate",
        {"text": "Bonjour", "source_lang": "fr", "target_lang": "en"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data == {"translated_text": "Hello", "from_cache": False}


def test_batch_translation(api, monkeypatch):
    monkeypatch.setattr(
        views,
        "translate_many_cached",
        lambda *a, **k: [("Hello", False), ("World", True)],
    )
    resp = api.post(
        "/api/translate",
        {"texts": ["Bonjour", "Monde"], "source_lang": "fr", "target_lang": "en"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["translations"] == [
        {"translated_text": "Hello", "from_cache": False},
        {"translated_text": "World", "from_cache": True},
    ]


def test_rejects_both_text_and_texts(api):
    resp = api.post(
        "/api/translate",
        {"text": "a", "texts": ["b"], "target_lang": "en"},
        format="json",
    )
    assert resp.status_code == 400


def test_rejects_neither(api):
    resp = api.post("/api/translate", {"target_lang": "en"}, format="json")
    assert resp.status_code == 400


def test_rejects_same_source_and_target(api):
    resp = api.post(
        "/api/translate",
        {"text": "a", "source_lang": "en", "target_lang": "en"},
        format="json",
    )
    assert resp.status_code == 400


def test_quota_maps_to_402(api, monkeypatch):
    def _boom(*a, **k):
        raise TranslationQuotaError("Quota de traduction dépassé.")

    monkeypatch.setattr(views, "translate_cached", _boom)
    resp = api.post(
        "/api/translate",
        {"text": "a", "source_lang": "fr", "target_lang": "en"},
        format="json",
    )
    assert resp.status_code == 402
    assert "Quota" in resp.data["detail"]


def test_not_configured_maps_to_503(api, monkeypatch):
    def _boom(*a, **k):
        raise TranslationError("Service de traduction non configuré.")

    monkeypatch.setattr(views, "translate_cached", _boom)
    resp = api.post(
        "/api/translate",
        {"text": "a", "source_lang": "fr", "target_lang": "en"},
        format="json",
    )
    assert resp.status_code == 503
    assert "non configuré" in resp.data["detail"]


def test_unavailable_maps_to_503(api, monkeypatch):
    def _boom(*a, **k):
        raise TranslationUnavailableError("Service de traduction temporairement indisponible.")

    monkeypatch.setattr(views, "translate_cached", _boom)
    resp = api.post(
        "/api/translate",
        {"text": "a", "source_lang": "fr", "target_lang": "en"},
        format="json",
    )
    assert resp.status_code == 503
