"""Tests for dynamic attribute columns on the product list API."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.attributes.models import (
    AttributeCategory,
    AttributeDataType,
    AttributeRegistry,
    ProductAttributeValue,
)
from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


class TestAttrColumns:
    def test_list_includes_requested_attribute_values(self, client):
        attr = AttributeRegistry.objects.create(
            code="cpr_level",
            label={"fr": "CPR"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
        )
        product = Product.objects.create(
            sku_code="COL-01", name="P", description_marketing={"fr": "x"}
        )
        ProductAttributeValue.objects.create(product=product, attribute=attr, value="Dca")

        resp = client.get("/api/products/?attr_columns=cpr_level")
        assert resp.status_code == 200
        row = resp.json()["results"][0]
        assert row["attribute_values"] == {"cpr_level": "Dca"}

    def test_list_omits_attribute_values_when_not_requested(self, client):
        Product.objects.create(sku_code="COL-02", name="P", description_marketing={"fr": "x"})
        resp = client.get("/api/products/")
        assert resp.status_code == 200
        row = resp.json()["results"][0]
        assert row["attribute_values"] == {}
