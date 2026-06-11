"""Model-level tests for the EAV registry (CDC §3.2, §4.1.4).

Covers DB- and validator-enforced invariants:
  - UNIQUE(product, attribute)
  - cascade delete from product → values
  - cascade delete from attribute → values (CDC §4.1.4)
  - snake_case regex validation on `code`
"""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.attributes.models import (
    AttributeCategory,
    AttributeDataType,
    AttributeRegistry,
    ProductAttributeValue,
)
from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture()
def product() -> Product:
    return Product.objects.create(
        sku_code="ATTR-TEST-01",
        name="Produit de test",
        description_marketing={"fr": "Description"},
    )


@pytest.fixture()
def attribute() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="cable_color",
        label={"fr": "Couleur"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.TEXT,
    )


class TestUniqueProductAttribute:
    def test_duplicate_pair_rejected(self, product, attribute):
        ProductAttributeValue.objects.create(product=product, attribute=attribute, value="Rouge")
        with pytest.raises(IntegrityError), transaction.atomic():
            ProductAttributeValue.objects.create(product=product, attribute=attribute, value="Bleu")

    def test_same_attribute_distinct_products_allowed(self, attribute):
        p1 = Product.objects.create(sku_code="A-1", name="A", description_marketing={"fr": "a"})
        p2 = Product.objects.create(sku_code="A-2", name="B", description_marketing={"fr": "b"})
        ProductAttributeValue.objects.create(product=p1, attribute=attribute, value="X")
        ProductAttributeValue.objects.create(product=p2, attribute=attribute, value="Y")
        assert attribute.values.count() == 2


class TestCascadeDelete:
    def test_delete_product_removes_values(self, product, attribute):
        ProductAttributeValue.objects.create(product=product, attribute=attribute, value="Rouge")
        product.delete()
        assert ProductAttributeValue.objects.filter(attribute=attribute).count() == 0

    def test_delete_attribute_removes_values(self, product, attribute):
        ProductAttributeValue.objects.create(product=product, attribute=attribute, value="Rouge")
        attribute.delete()
        assert ProductAttributeValue.objects.filter(product=product).count() == 0


class TestCodeValidation:
    def test_valid_snake_case_passes(self):
        attr = AttributeRegistry(
            code="conductor_diameter_2",
            label={"fr": "Diamètre"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.NUMBER,
        )
        attr.full_clean()

    @pytest.mark.parametrize(
        "bad_code", ["Cable_Color", "2cable", "cable-color", "_cable", "câble"]
    )
    def test_invalid_code_rejected(self, bad_code):
        attr = AttributeRegistry(
            code=bad_code,
            label={"fr": "X"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
        )
        with pytest.raises(ValidationError):
            attr.full_clean()
