"""Model + backfill-logic tests for the Fournisseurs module (Épic FEEDBACK 1)."""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.products.models import Product, ProductSupplier
from apps.suppliers.models import Supplier
from apps.suppliers.services import get_or_create_supplier_by_name

pytestmark = pytest.mark.django_db


class TestSupplierModel:
    def test_str(self):
        s = Supplier.objects.create(name="Symea", code="SYM")
        assert str(s) == "Symea (SYM)"

    def test_code_is_unique(self):
        Supplier.objects.create(name="A", code="DUP")
        with pytest.raises(IntegrityError), transaction.atomic():
            Supplier.objects.create(name="B", code="DUP")


class TestGetOrCreateByName:
    """Mirrors the migration backfill + Odoo sync entity resolution."""

    def test_creates_once_and_is_idempotent(self):
        first = get_or_create_supplier_by_name("Mirsan", defaults={"currency_default": "EUR"})
        second = get_or_create_supplier_by_name("mirsan")  # case-insensitive
        assert first.pk == second.pk
        assert Supplier.objects.filter(name__iexact="mirsan").count() == 1
        assert first.currency_default == "EUR"

    def test_generates_unique_codes_for_similar_names(self):
        a = get_or_create_supplier_by_name("AYP!!!")
        b = get_or_create_supplier_by_name("A Y P")
        assert a.code != b.code

    def test_backfill_flow_links_existing_rows(self):
        """A ProductSupplier with a free-text name gets attached to an entity."""
        product = Product.objects.create(sku_code="BF-SKU-1", name="X", is_active=True)
        link = ProductSupplier.objects.create(product=product, supplier_name="Infoks")

        supplier = get_or_create_supplier_by_name("Infoks")
        ProductSupplier.objects.filter(supplier_name="Infoks", supplier__isnull=True).update(
            supplier=supplier
        )

        link.refresh_from_db()
        assert link.supplier_id == supplier.pk
