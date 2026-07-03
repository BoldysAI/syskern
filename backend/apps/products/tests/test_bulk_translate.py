"""Bulk product translation task + endpoint (CDC §10.3.2)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.i18n import services as i18n_services
from apps.offers.services.translation import TranslationQuotaError
from apps.products.models import Product
from apps.products.tasks import bulk_translate_products_task

pytestmark = pytest.mark.django_db


@pytest.fixture()
def api() -> APIClient:
    return APIClient()


def _fake_translate(text, source_lang, target_lang, **_kwargs):
    return f"[{target_lang}]{text}", False


def test_bulk_fills_empty_target_languages(monkeypatch):
    monkeypatch.setattr(i18n_services, "translate_cached", _fake_translate)
    p1 = Product.objects.create(sku_code="P1", name="P1", description_marketing={"fr": "Bonjour"})
    p2 = Product.objects.create(
        sku_code="P2",
        name="P2",
        description_marketing={"fr": "Salut"},
        description_technical={"fr": "Tech"},
    )

    result = bulk_translate_products_task.apply(
        args=[[str(p1.id), str(p2.id)], "fr", ["en"], ["marketing", "technical"]]
    ).get()

    assert result["product_count"] == 2
    assert result["processed"] == 2
    p1.refresh_from_db()
    p2.refresh_from_db()
    assert p1.description_marketing["en"] == "[en]Bonjour"
    assert p2.description_marketing["en"] == "[en]Salut"
    assert p2.description_technical["en"] == "[en]Tech"


def test_bulk_does_not_overwrite_existing(monkeypatch):
    monkeypatch.setattr(i18n_services, "translate_cached", _fake_translate)
    p = Product.objects.create(
        sku_code="P3",
        name="P3",
        description_marketing={"fr": "Bonjour", "en": "Existing"},
    )
    bulk_translate_products_task.apply(args=[[str(p.id)], "fr", ["en"], ["marketing"]]).get()
    p.refresh_from_db()
    assert p.description_marketing["en"] == "Existing"


def test_bulk_aborts_on_quota(monkeypatch):
    def _quota(*a, **k):
        raise TranslationQuotaError("Quota de traduction dépassé.")

    monkeypatch.setattr(i18n_services, "translate_cached", _quota)
    p = Product.objects.create(sku_code="P4", name="P4", description_marketing={"fr": "Bonjour"})
    result = bulk_translate_products_task.apply(
        args=[[str(p.id)], "fr", ["en"], ["marketing"]]
    )
    assert result.failed()
    assert "Quota" in str(result.result)


def test_bulk_endpoint_returns_202(api):
    p = Product.objects.create(sku_code="P5", name="P5", description_marketing={"fr": "x"})
    resp = api.post(
        "/api/products/bulk-translate/",
        {"ids": [str(p.id)], "target_langs": ["en", "es"]},
        format="json",
    )
    assert resp.status_code == 202
    assert "task_id" in resp.json()
    assert resp.json()["product_count"] == 1


def test_bulk_endpoint_rejects_source_only_target(api):
    p = Product.objects.create(sku_code="P6", name="P6", description_marketing={"fr": "x"})
    resp = api.post(
        "/api/products/bulk-translate/",
        {"ids": [str(p.id)], "source_lang": "fr", "target_langs": ["fr"]},
        format="json",
    )
    assert resp.status_code == 400
