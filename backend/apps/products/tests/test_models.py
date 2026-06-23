"""Model-level tests for the PIM (CDC §3.2).

Covers DB-enforced invariants not reachable through the API layer:
  - partial unique index: at most one active supplier per product
  - cascade delete from product → suppliers
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.products.models import Product, ProductSupplier

pytestmark = pytest.mark.django_db


@pytest.fixture()
def product() -> Product:
    return Product.objects.create(
        sku_code="MODEL-TEST-01",
        name="Produit de test",
        description_marketing={"fr": "Description"},
    )


class TestOneActiveSupplierConstraint:
    def test_first_active_supplier_accepted(self, product):
        supplier = ProductSupplier.objects.create(
            product=product, supplier_name="Fournisseur 1", is_active=True
        )
        assert supplier.pk is not None

    def test_second_active_supplier_rejected(self, product):
        ProductSupplier.objects.create(
            product=product, supplier_name="Fournisseur 1", is_active=True
        )
        with pytest.raises(IntegrityError), transaction.atomic():
            ProductSupplier.objects.create(
                product=product, supplier_name="Fournisseur 2", is_active=True
            )

    def test_two_inactive_suppliers_allowed(self, product):
        ProductSupplier.objects.create(
            product=product, supplier_name="Fournisseur 1", is_active=False
        )
        ProductSupplier.objects.create(
            product=product, supplier_name="Fournisseur 2", is_active=False
        )
        assert product.suppliers.count() == 2

    def test_active_supplier_allowed_on_distinct_products(self):
        p1 = Product.objects.create(sku_code="P-1", name="P1", description_marketing={"fr": "a"})
        p2 = Product.objects.create(sku_code="P-2", name="P2", description_marketing={"fr": "b"})
        ProductSupplier.objects.create(product=p1, supplier_name="S", is_active=True)
        ProductSupplier.objects.create(product=p2, supplier_name="S", is_active=True)
        assert ProductSupplier.objects.filter(is_active=True).count() == 2


class TestSupplierCascadeDelete:
    def test_delete_product_removes_suppliers(self, product):
        ProductSupplier.objects.create(product=product, supplier_name="S1", is_active=False)
        ProductSupplier.objects.create(product=product, supplier_name="S2", is_active=False)
        product_pk = product.pk
        product.delete()
        assert ProductSupplier.objects.filter(product_id=product_pk).count() == 0


class TestProductDesignation:
    def test_prefers_fr_marketing_copy(self):
        p = Product(
            sku_code="SKU-1",
            name="SKU-1",
            description_marketing={"fr": "Câble instrumentation 4x1.5"},
        )
        assert p.designation == "Câble instrumentation 4x1.5"

    def test_falls_back_to_name(self):
        p = Product(sku_code="COMM", name="Communication", description_marketing={})
        assert p.designation == "Communication"
