"""Catalog ordering — NULLS LAST for wizard products without PAMP."""

from __future__ import annotations

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


def _make(sku: str, **kwargs) -> Product:
    return Product.objects.create(
        sku_code=sku,
        name=sku,
        description_marketing={"fr": "x"},
        **kwargs,
    )


def _sku_order(resp) -> list[str]:
    return [r["sku_code"] for r in resp.data["results"]]


class TestPampOrdering:
    def test_pamp_desc_puts_null_pamp_last(self, client):
        """Wizard products (pamp_eur=NULL) must not top a descending PAMP sort."""
        _make("P-HIGH", pamp_eur=Decimal("100.0000"))
        _make("P-LOW", pamp_eur=Decimal("10.0000"))
        _make("P-WIZARD")  # no PAMP — typical wizard / not yet synced from Odoo

        resp = client.get("/api/products/", {"ordering": "-pamp_eur"})
        assert resp.status_code == 200
        order = _sku_order(resp)
        assert order.index("P-HIGH") < order.index("P-LOW") < order.index("P-WIZARD")

    def test_pamp_asc_puts_null_pamp_last(self, client):
        _make("P-HIGH", pamp_eur=Decimal("100.0000"))
        _make("P-WIZARD")

        resp = client.get("/api/products/", {"ordering": "pamp_eur"})
        assert resp.status_code == 200
        order = _sku_order(resp)
        assert order.index("P-WIZARD") > order.index("P-HIGH")

    def test_pamp_min_excludes_null(self, client):
        _make("P-OK", pamp_eur=Decimal("50.0000"))
        _make("P-WIZARD")

        resp = client.get("/api/products/", {"pamp_min": "10"})
        assert resp.status_code == 200
        assert _sku_order(resp) == ["P-OK"]


class TestAttributeOrdering:
    def test_order_by_dynamic_number_attribute(self, client):
        from apps.attributes.models import (
            AttributeCategory,
            AttributeDataType,
            AttributeRegistry,
            ProductAttributeValue,
        )

        attr = AttributeRegistry.objects.create(
            code="sort_weight",
            label={"fr": "Poids"},
            category=AttributeCategory.LOGISTIC,
            data_type=AttributeDataType.NUMBER,
        )
        p_low = _make("SORT-LOW")
        p_high = _make("SORT-HIGH")
        _make("SORT-NONE")  # no attribute value → sorts NULLS LAST
        ProductAttributeValue.objects.create(product=p_low, attribute=attr, value=5)
        ProductAttributeValue.objects.create(product=p_high, attribute=attr, value=50)

        resp = client.get("/api/products/", {"ordering": "attr_sort_weight"})
        assert resp.status_code == 200
        order = _sku_order(resp)
        assert order.index("SORT-LOW") < order.index("SORT-HIGH")
        assert order.index("SORT-NONE") > order.index("SORT-HIGH")

    def test_order_by_dynamic_text_attribute_desc(self, client):
        from apps.attributes.models import (
            AttributeCategory,
            AttributeDataType,
            AttributeRegistry,
            ProductAttributeValue,
        )

        attr = AttributeRegistry.objects.create(
            code="sort_label",
            label={"fr": "Libellé"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
        )
        p_a = _make("SORT-A")
        p_z = _make("SORT-Z")
        ProductAttributeValue.objects.create(product=p_a, attribute=attr, value="Alpha")
        ProductAttributeValue.objects.create(product=p_z, attribute=attr, value="Zulu")

        resp = client.get("/api/products/", {"ordering": "-attr_sort_label"})
        assert resp.status_code == 200
        order = _sku_order(resp)
        assert order.index("SORT-Z") < order.index("SORT-A")


class TestCompletenessOrdering:
    def test_orders_catalog_by_completeness(self, client):
        from apps.attributes.models import (
            AttributeCategory,
            AttributeDataType,
            AttributeRegistry,
            ProductAttributeValue,
        )

        rich = _make("RICH", brand="B", gtin="1", universe="U", family="F", hs_code="H")
        attr = AttributeRegistry.objects.create(
            code="awgc",
            label={"fr": "AWG"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.NUMBER,
        )
        ProductAttributeValue.objects.create(product=rich, attribute=attr, value="23")
        _make("POOR")  # only name + description_marketing FR (via _make)

        desc = _sku_order(client.get("/api/products/", {"ordering": "-completeness_pct"}))
        assert desc.index("RICH") < desc.index("POOR")
        asc = _sku_order(client.get("/api/products/", {"ordering": "completeness_pct"}))
        assert asc.index("POOR") < asc.index("RICH")
