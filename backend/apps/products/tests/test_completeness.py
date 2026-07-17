"""Tests for catalog attribute completeness (PIM — FEEDBACK 1)."""

from __future__ import annotations

import pytest

from apps.attributes.models import (
    AttributeCategory,
    AttributeDataType,
    AttributeRegistry,
    ProductAttributeValue,
)
from apps.products.models import Product
from apps.products.services.completeness import build_attribute_completeness

pytestmark = pytest.mark.django_db


def _by_key(result: dict) -> dict:
    return {f["key"]: f for f in result["fields"]}


def test_empty_catalog_returns_zeroes():
    assert build_attribute_completeness() == {
        "total_products": 0,
        "average_percent": 0.0,
        "fields": [],
    }


def test_core_field_fill_rate_ignores_inactive():
    Product.objects.create(sku_code="P1", name="a", brand="X", gtin="123")
    Product.objects.create(sku_code="P2", name="b", brand="Y")  # no gtin
    Product.objects.create(sku_code="P3", name="c")  # no brand, no gtin
    Product.objects.create(sku_code="P4", name="d", brand="Z", gtin="456")
    Product.objects.create(sku_code="P5", name="e", brand="W", gtin="9", is_active=False)

    result = build_attribute_completeness()
    assert result["total_products"] == 4  # inactive product excluded
    fields = _by_key(result)
    assert fields["brand"]["filled"] == 3
    assert fields["brand"]["missing"] == 1
    assert fields["brand"]["percent"] == 75.0
    assert fields["gtin"]["filled"] == 2
    assert fields["gtin"]["percent"] == 50.0


def test_description_marketing_fr_counts_only_non_empty():
    Product.objects.create(sku_code="D1", name="a", description_marketing={"fr": "desc"})
    Product.objects.create(sku_code="D2", name="b", description_marketing={"fr": ""})
    Product.objects.create(sku_code="D3", name="c", description_marketing={"en": "only en"})
    Product.objects.create(sku_code="D4", name="d")  # {} default → fr absent

    fields = _by_key(build_attribute_completeness())
    assert fields["description_marketing"]["filled"] == 1  # only D1
    assert fields["description_marketing"]["percent"] == 25.0


def test_dynamic_attribute_fill_rate():
    p1 = Product.objects.create(sku_code="A1", name="a")
    p2 = Product.objects.create(sku_code="A2", name="b")
    Product.objects.create(sku_code="A3", name="c")
    attr = AttributeRegistry.objects.create(
        code="awg",
        label={"fr": "Calibre AWG"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.NUMBER,
    )
    ProductAttributeValue.objects.create(product=p1, attribute=attr, value="23")
    ProductAttributeValue.objects.create(product=p2, attribute=attr, value="")  # empty → excluded

    row = _by_key(build_attribute_completeness())[f"attr:{attr.id}"]
    assert row["label"] == "Calibre AWG"
    assert row["kind"] == "attribute"
    assert row["filled"] == 1  # only p1 has a non-empty value
    assert row["missing"] == 2
    assert row["percent"] == pytest.approx(33.3)


def test_fields_sorted_least_complete_first():
    Product.objects.create(sku_code="S1", name="a", brand="X", gtin="1")
    Product.objects.create(sku_code="S2", name="b", brand="Y")
    percents = [f["percent"] for f in build_attribute_completeness()["fields"]]
    assert percents == sorted(percents)
