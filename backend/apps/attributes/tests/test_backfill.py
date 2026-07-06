"""Tests for default-value backfill on attribute creation (CDC §4.5)."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.attributes.models import (
    AttributeCategory,
    AttributeDataType,
    AttributeRegistry,
    ProductAttributeValue,
)
from apps.attributes.services.backfill import backfill_attribute_defaults
from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


class TestDefaultValueValidation:
    def test_required_attribute_must_have_default(self, client):
        resp = client.post(
            "/api/attributes/",
            {
                "code": "req_no_default",
                "label": {"fr": "Requis"},
                "category": "technical",
                "data_type": "text",
                "is_required": True,
            },
            format="json",
        )
        assert resp.status_code == 400
        assert "default_value" in resp.json()

    def test_boolean_false_default_is_valid(self, client):
        resp = client.post(
            "/api/attributes/",
            {
                "code": "bool_false_default",
                "label": {"fr": "Bool"},
                "category": "technical",
                "data_type": "boolean",
                "default_value": False,
            },
            format="json",
        )
        assert resp.status_code == 201
        assert resp.json()["default_value"] is False

    def test_number_zero_default_is_valid(self, client):
        resp = client.post(
            "/api/attributes/",
            {
                "code": "num_zero_default",
                "label": {"fr": "Nombre"},
                "category": "technical",
                "data_type": "number",
                "default_value": 0,
            },
            format="json",
        )
        assert resp.status_code == 201
        assert resp.json()["default_value"] == 0


class TestBackfillService:
    def test_backfill_creates_values_for_all_products(self):
        attr = AttributeRegistry.objects.create(
            code="backfill_test",
            label={"fr": "Test"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            default_value="default",
        )
        products = [
            Product.objects.create(
                sku_code=f"BF-{i}",
                name=f"P{i}",
                description_marketing={"fr": "x"},
            )
            for i in range(3)
        ]

        report = backfill_attribute_defaults(attr.pk)
        assert report["created"] == 3
        assert ProductAttributeValue.objects.filter(attribute=attr).count() == 3
        for p in products:
            pav = ProductAttributeValue.objects.get(product=p, attribute=attr)
            assert pav.value == "default"

    def test_backfill_skips_existing_values(self):
        attr = AttributeRegistry.objects.create(
            code="backfill_skip",
            label={"fr": "Test"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            default_value="default",
        )
        p1 = Product.objects.create(
            sku_code="BF-SKIP-1", name="P1", description_marketing={"fr": "x"}
        )
        p2 = Product.objects.create(
            sku_code="BF-SKIP-2", name="P2", description_marketing={"fr": "x"}
        )
        ProductAttributeValue.objects.create(product=p1, attribute=attr, value="custom")

        report = backfill_attribute_defaults(attr.pk)
        assert report["created"] == 1
        assert report["skipped"] == 1
        assert ProductAttributeValue.objects.get(product=p1, attribute=attr).value == "custom"
        assert ProductAttributeValue.objects.get(product=p2, attribute=attr).value == "default"


class TestCreateTriggersBackfill:
    def test_create_attribute_with_default_triggers_backfill(self, client):
        Product.objects.create(
            sku_code="API-BF-1", name="P", description_marketing={"fr": "x"}
        )
        resp = client.post(
            "/api/attributes/",
            {
                "code": "api_backfill",
                "label": {"fr": "API"},
                "category": "technical",
                "data_type": "text",
                "default_value": "x",
            },
            format="json",
        )
        assert resp.status_code == 201
        attr = AttributeRegistry.objects.get(code="api_backfill")
        assert ProductAttributeValue.objects.filter(attribute=attr, value="x").count() == 1

    @patch("apps.attributes.views.backfill_attribute_defaults_task.delay")
    def test_large_catalog_uses_celery(self, mock_delay, client):
        for i in range(101):
            Product.objects.create(
                sku_code=f"BULK-{i:03d}",
                name=f"P{i}",
                description_marketing={"fr": "x"},
            )
        resp = client.post(
            "/api/attributes/",
            {
                "code": "celery_backfill",
                "label": {"fr": "Celery"},
                "category": "technical",
                "data_type": "text",
                "default_value": "y",
            },
            format="json",
        )
        assert resp.status_code == 201
        mock_delay.assert_called_once()
