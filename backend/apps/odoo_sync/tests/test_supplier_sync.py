"""Multi-supplier import in the Odoo sync (C1 fix).

Previously the runner imported only ``op.suppliers[0]``, so the catalog supplier
picker only ever listed one company. ``_sync_suppliers`` now mirrors every Odoo
supplier, keeping exactly one active (the first).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from apps.odoo_sync.schemas import OdooSupplierLink
from apps.odoo_sync.services.runner import _sync_suppliers
from apps.products.models import Product, ProductSupplier

pytestmark = pytest.mark.django_db


def _links(*names: str) -> list[OdooSupplierLink]:
    return [
        OdooSupplierLink(name=n, factory_code="", price=Decimal("10"), currency="EUR")
        for n in names
    ]


def test_imports_all_suppliers_first_active() -> None:
    product = Product.objects.create(sku_code="SKU-1", name="Câble")
    _sync_suppliers(product, _links("Symea", "AYP", "Mirsan"), ProductSupplier)

    assert set(product.suppliers.values_list("supplier_name", flat=True)) == {
        "Symea",
        "AYP",
        "Mirsan",
    }
    active = list(product.suppliers.filter(is_active=True).values_list("supplier_name", flat=True))
    assert active == ["Symea"]  # only the first is active


def test_resync_switches_primary_keeps_single_active() -> None:
    product = Product.objects.create(sku_code="SKU-2", name="Câble")
    _sync_suppliers(product, _links("Symea", "AYP"), ProductSupplier)
    # Re-sync with a different order → primary switches; still exactly one active.
    _sync_suppliers(product, _links("AYP", "Symea", "Infoks"), ProductSupplier)

    assert product.suppliers.count() == 3
    assert list(
        product.suppliers.filter(is_active=True).values_list("supplier_name", flat=True)
    ) == ["AYP"]


def test_deduplicates_repeated_names() -> None:
    product = Product.objects.create(sku_code="SKU-3", name="Câble")
    _sync_suppliers(product, _links("Symea", "Symea"), ProductSupplier)
    assert product.suppliers.count() == 1


def test_empty_suppliers_is_noop() -> None:
    product = Product.objects.create(sku_code="SKU-4", name="Câble")
    _sync_suppliers(product, [], ProductSupplier)
    assert product.suppliers.count() == 0
