"""DeepL client behaviour (CDC §10.4.1 / §10.4.4).

Covers: success, empty short-circuit, quota 456, 503 retry-then-fail, generic
5xx retry-then-success, oversized input, auth-failure alert.
"""

from __future__ import annotations

import httpx
import pytest

from apps.offers.services import translation as tr
from apps.offers.services.translation import (
    DeepLClient,
    TranslationInputError,
    TranslationQuotaError,
    TranslationUnavailableError,
    apply_source_casing,
)


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    """Context-manager stand-in for ``httpx.Client`` returning scripted responses."""

    def __init__(self, responses: list, calls: list):
        self._responses = responses
        self._calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, _url: str, data: dict | None = None, headers: dict | None = None):
        self._calls.append({"data": data, "headers": headers})
        resp = self._responses.pop(0)
        if isinstance(resp, Exception):
            raise resp
        return resp


@pytest.fixture()
def patch_httpx(monkeypatch):
    """Return a helper that installs a scripted fake httpx.Client."""

    def _install(responses: list) -> list:
        calls: list = []
        # Share one queue across httpx.Client() instantiations: the client opens
        # a fresh context manager on every retry attempt, so pops must persist.
        queue = list(responses)

        def _factory(*_args, **_kwargs):
            return _FakeClient(queue, calls)

        monkeypatch.setattr(tr.httpx, "Client", _factory)
        return calls

    return _install


@pytest.fixture(autouse=True)
def _api_key(monkeypatch):
    monkeypatch.setattr(tr.settings, "DEEPL_API_KEY", "test-key", raising=False)


def test_translate_success(patch_httpx):
    calls = patch_httpx([_FakeResponse(200, {"translations": [{"text": "Hello"}]})])
    out = DeepLClient().translate(source_text="Bonjour", source_lang="fr", target_lang="en")
    assert out == "Hello"
    assert "Authorization" in calls[0]["headers"]
    assert "auth_key" not in (calls[0]["data"] or {})
    assert "formality" not in (calls[0]["data"] or {})


def test_empty_short_circuits(patch_httpx):
    calls = patch_httpx([])
    out = DeepLClient().translate(source_text="   ", source_lang="fr", target_lang="en")
    assert out == ""
    assert calls == []  # DeepL never called


def test_quota_456(patch_httpx):
    patch_httpx([_FakeResponse(456, text="quota")])
    with pytest.raises(TranslationQuotaError):
        DeepLClient().translate(source_text="x", source_lang="fr", target_lang="en")


def test_503_retries_then_fails(patch_httpx):
    calls = patch_httpx([_FakeResponse(503), _FakeResponse(503), _FakeResponse(503)])
    with pytest.raises(TranslationUnavailableError):
        DeepLClient().translate(source_text="x", source_lang="fr", target_lang="en")
    assert len(calls) == 3  # initial + 2 retries (CDC §10.4.4)


def test_5xx_retry_then_success(patch_httpx):
    calls = patch_httpx(
        [_FakeResponse(500), _FakeResponse(200, {"translations": [{"text": "ok"}]})]
    )
    out = DeepLClient().translate(source_text="x", source_lang="fr", target_lang="en")
    assert out == "ok"
    assert len(calls) == 2


def test_network_error_retries_then_fails(patch_httpx):
    calls = patch_httpx(
        [httpx.ConnectError("boom"), httpx.ConnectError("boom"), httpx.ConnectError("boom")]
    )
    with pytest.raises(TranslationUnavailableError):
        DeepLClient().translate(source_text="x", source_lang="fr", target_lang="en")
    assert len(calls) == 3


def test_too_long_rejected(patch_httpx):
    calls = patch_httpx([])
    with pytest.raises(TranslationInputError):
        DeepLClient().translate(source_text="a" * 5001, source_lang="fr", target_lang="en")
    assert calls == []


def test_auth_failure_alerts(patch_httpx, monkeypatch, mailoutbox):
    monkeypatch.setattr(tr.settings, "TRANSLATION_AUTH_ALERT_RECIPIENTS", ["a@b.co"], raising=False)
    patch_httpx([_FakeResponse(403, text="forbidden")])
    with pytest.raises(tr.TranslationError):
        DeepLClient().translate(source_text="x", source_lang="fr", target_lang="en")
    assert len(mailoutbox) == 1
    assert "a@b.co" in mailoutbox[0].to


def test_translate_batch_preserves_empty_slots(patch_httpx):
    calls = patch_httpx([_FakeResponse(200, {"translations": [{"text": "A"}, {"text": "B"}]})])
    out = DeepLClient().translate_batch(["a", "", "b"], "fr", "en")
    assert out == ["A", "", "B"]
    # Only the two non-empty texts are sent to DeepL.
    assert calls[0]["data"]["text"] == ["a", "b"]


def test_free_key_uses_free_api_host(monkeypatch):
    monkeypatch.setattr(tr.settings, "DEEPL_API_KEY", "abc123:fx", raising=False)
    assert DeepLClient().base_url == DeepLClient.FREE_BASE_URL


def test_pro_key_uses_pro_api_host(monkeypatch):
    monkeypatch.setattr(tr.settings, "DEEPL_API_KEY", "abc123-pro-key", raising=False)
    assert DeepLClient().base_url == DeepLClient.PRO_BASE_URL


def test_formality_sent_for_spanish_target(patch_httpx):
    calls = patch_httpx([_FakeResponse(200, {"translations": [{"text": "Hola"}]})])
    DeepLClient().translate(source_text="Bonjour", source_lang="fr", target_lang="es")
    assert calls[0]["data"]["formality"] == "more"


def test_formality_sent_for_french_target(patch_httpx):
    calls = patch_httpx([_FakeResponse(200, {"translations": [{"text": "Bonjour"}]})])
    DeepLClient().translate(source_text="Hello", source_lang="en", target_lang="fr")
    assert calls[0]["data"]["formality"] == "more"


@pytest.mark.parametrize(
    ("source", "raw", "expected"),
    [
        ("TECHNICAL DATA", "données techniques", "DONNÉES TECHNIQUES"),
        ("High Quality Product", "produit de haute qualité", "Produit De Haute Qualité"),
        ("Product overview", "aperçu du produit", "Aperçu du produit"),
        ("all lower source", "tout en minuscules", "tout en minuscules"),
    ],
)
def test_apply_source_casing(source, raw, expected):
    assert apply_source_casing(source, raw) == expected


def test_apply_source_casing_multiline():
    source = "HEADING ONE\nSecond line"
    raw = "titre un\ndeuxième ligne"
    assert apply_source_casing(source, raw) == "TITRE UN\nDeuxième ligne"


def test_translate_restores_all_caps_from_english(patch_httpx):
    patch_httpx(
        [_FakeResponse(200, {"translations": [{"text": "spécifications techniques"}]})]
    )
    out = DeepLClient().translate(
        source_text="TECHNICAL SPECIFICATIONS",
        source_lang="en",
        target_lang="fr",
    )
    assert out == "SPÉCIFICATIONS TECHNIQUES"
