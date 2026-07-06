"""Catalog filter tests (CDC §4.1.1): brand multi, supplier, stock, attributes."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.attributes.models import (
    AttributeCategory,
    AttributeDataType,
    AttributeRegistry,
    ProductAttributeValue,
)
from apps.products.models import Product, ProductSupplier

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


def _make(sku: str, **kwargs) -> Product:
    return Product.objects.create(
        sku_code=sku,
        name=kwargs.pop("name", sku),
        description_marketing={"fr": "x"},
        **kwargs,
    )


def _skus(resp) -> set[str]:
    return {r["sku_code"] for r in resp.data["results"]}


class TestHierarchyAndBrandFilters:
    def test_brand_multi_select(self, client):
        _make("B-1", brand="Nexans")
        _make("B-2", brand="Acome")
        _make("B-3", brand="Other")
        resp = client.get("/api/products/", {"brand": "Nexans,Acome"})
        assert resp.status_code == 200
        assert _skus(resp) == {"B-1", "B-2"}

    def test_universe_combinable_with_family(self, client):
        _make("H-1", universe="COPPER", family="CABLE")
        _make("H-2", universe="COPPER", family="WIRE")
        resp = client.get("/api/products/", {"universe": "COPPER", "family": "CABLE"})
        assert _skus(resp) == {"H-1"}

    def test_family_multi_select(self, client):
        _make("F-1", family="CABLE")
        _make("F-2", family="WIRE")
        _make("F-3", family="OTHER")
        resp = client.get("/api/products/", {"family": "CABLE,WIRE"})
        assert _skus(resp) == {"F-1", "F-2"}


class TestStockFilters:
    def test_stock_min(self, client):
        _make("S-1", stock_quantity=5)
        _make("S-2", stock_quantity=50)
        resp = client.get("/api/products/", {"stock_min": "10"})
        assert _skus(resp) == {"S-2"}

    def test_in_stock_false_is_rupture(self, client):
        _make("S-3", stock_quantity=0)
        _make("S-4", stock_quantity=10)
        resp = client.get("/api/products/", {"in_stock": "false"})
        assert _skus(resp) == {"S-3"}


class TestSupplierFilter:
    def test_filter_by_supplier_name(self, client):
        p1 = _make("SUP-1")
        p2 = _make("SUP-2")
        ProductSupplier.objects.create(product=p1, supplier_name="Symea Shanghai")
        ProductSupplier.objects.create(product=p2, supplier_name="Autre")
        resp = client.get("/api/products/", {"supplier": "Symea Shanghai"})
        assert _skus(resp) == {"SUP-1"}

    def test_supplier_multi_select(self, client):
        p1 = _make("SUP-M1")
        p2 = _make("SUP-M2")
        p3 = _make("SUP-M3")
        ProductSupplier.objects.create(product=p1, supplier_name="Symea Shanghai")
        ProductSupplier.objects.create(product=p2, supplier_name="Autre")
        ProductSupplier.objects.create(product=p3, supplier_name="Tiers")
        resp = client.get("/api/products/", {"supplier": "Symea Shanghai,Autre"})
        assert _skus(resp) == {"SUP-M1", "SUP-M2"}

    def test_filter_by_inactive_supplier_name(self, client):
        """`supplier` matches any linked source, not only the active one."""
        p = _make("SUP-INACT")
        ProductSupplier.objects.create(
            product=p, supplier_name="Symea Shanghai", is_active=False
        )
        ProductSupplier.objects.create(
            product=p, supplier_name="Autre", is_active=True
        )
        resp = client.get("/api/products/", {"supplier": "Symea Shanghai"})
        assert _skus(resp) == {"SUP-INACT"}

    def test_filter_by_active_supplier_name(self, client):
        p = _make("SUP-ACT")
        ProductSupplier.objects.create(
            product=p, supplier_name="Symea Shanghai", is_active=False
        )
        ProductSupplier.objects.create(product=p, supplier_name="Autre", is_active=True)
        resp = client.get("/api/products/", {"active_supplier": "Autre"})
        assert _skus(resp) == {"SUP-ACT"}

    def test_active_supplier_ignores_inactive_match(self, client):
        p = _make("SUP-ACT2")
        ProductSupplier.objects.create(
            product=p, supplier_name="Symea Shanghai", is_active=False
        )
        ProductSupplier.objects.create(product=p, supplier_name="Autre", is_active=True)
        resp = client.get("/api/products/", {"active_supplier": "Symea Shanghai"})
        assert _skus(resp) == set()

    def test_active_supplier_multi_select(self, client):
        p1 = _make("SUP-AM1")
        p2 = _make("SUP-AM2")
        p3 = _make("SUP-AM3")
        ProductSupplier.objects.create(product=p1, supplier_name="Symea Shanghai", is_active=True)
        ProductSupplier.objects.create(product=p2, supplier_name="Autre", is_active=True)
        ProductSupplier.objects.create(product=p3, supplier_name="Tiers", is_active=True)
        resp = client.get("/api/products/", {"active_supplier": "Symea Shanghai,Autre"})
        assert _skus(resp) == {"SUP-AM1", "SUP-AM2"}

    def test_filter_no_supplier_linked(self, client):
        p_none = _make("SUP-NONE")
        p_with = _make("SUP-WITH")
        ProductSupplier.objects.create(product=p_with, supplier_name="Symea Shanghai")
        resp = client.get("/api/products/", {"supplier": "__none__"})
        assert _skus(resp) == {"SUP-NONE"}

    def test_filter_no_supplier_or_named(self, client):
        p_none = _make("SUP-NONE2")
        p_named = _make("SUP-NAMED2")
        ProductSupplier.objects.create(product=p_named, supplier_name="Symea Shanghai")
        resp = client.get("/api/products/", {"supplier": "__none__,Symea Shanghai"})
        assert _skus(resp) == {"SUP-NONE2", "SUP-NAMED2"}

    def test_filter_no_active_supplier(self, client):
        p_none = _make("SUP-ANO")
        p_inactive = _make("SUP-INACTONLY")
        p_active = _make("SUP-ACTOK")
        ProductSupplier.objects.create(
            product=p_inactive, supplier_name="Symea Shanghai", is_active=False
        )
        ProductSupplier.objects.create(product=p_active, supplier_name="Autre", is_active=True)
        resp = client.get("/api/products/", {"active_supplier": "__none__"})
        assert _skus(resp) == {"SUP-ANO", "SUP-INACTONLY"}


class TestAttributeFilters:
    def test_filterable_attribute_matches(self, client):
        attr = AttributeRegistry.objects.create(
            code="shielding_type",
            label={"fr": "Blindage"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.SELECT,
            options=[{"value": "SFTP", "label": {"fr": "S/FTP"}}],
            is_filterable=True,
        )
        p1 = _make("ATTR-1")
        p2 = _make("ATTR-2")
        ProductAttributeValue.objects.create(product=p1, attribute=attr, value="SFTP")
        ProductAttributeValue.objects.create(product=p2, attribute=attr, value="UTP")
        resp = client.get("/api/products/", {"attr_shielding_type": "SFTP"})
        assert _skus(resp) == {"ATTR-1"}

    def test_non_filterable_attribute_is_ignored(self, client):
        attr = AttributeRegistry.objects.create(
            code="not_filterable",
            label={"fr": "Non filtrable"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            is_filterable=False,
        )
        p1 = _make("NF-1")
        _make("NF-2")
        ProductAttributeValue.objects.create(product=p1, attribute=attr, value="red")
        # The attr_ param is ignored → both products returned.
        resp = client.get("/api/products/", {"attr_not_filterable": "red"})
        assert _skus(resp) == {"NF-1", "NF-2"}

    def test_number_attribute_minimum_filter_json_string(self, client):
        """Number filters are minimum (>=) thresholds; JSON string storage is supported."""
        attr = AttributeRegistry.objects.create(
            code="unit_weight",
            label={"fr": "Poids"},
            category=AttributeCategory.LOGISTIC,
            data_type=AttributeDataType.NUMBER,
            unit="kg",
            is_filterable=True,
        )
        p1 = _make("NUM-1")
        p2 = _make("NUM-2")
        ProductAttributeValue.objects.create(product=p1, attribute=attr, value="10")
        ProductAttributeValue.objects.create(product=p2, attribute=attr, value=15)
        resp = client.get("/api/products/", {"attr_unit_weight": "10"})
        assert _skus(resp) == {"NUM-1", "NUM-2"}

    def test_number_attribute_minimum_includes_higher_values(self, client):
        attr = AttributeRegistry.objects.create(
            code="filter_num_json",
            label={"fr": "Palette"},
            category=AttributeCategory.LOGISTIC,
            data_type=AttributeDataType.NUMBER,
            is_filterable=True,
        )
        p1 = _make("NUM-N1")
        p2 = _make("NUM-N2")
        ProductAttributeValue.objects.create(product=p1, attribute=attr, value=10)
        ProductAttributeValue.objects.create(product=p2, attribute=attr, value=140)
        resp = client.get("/api/products/", {"attr_filter_num_json": "78"})
        assert _skus(resp) == {"NUM-N2"}


class TestDistinctBrandsEndpoint:
    def test_includes_brands_from_inactive_products(self, client):
        """Sidebar brand list must match the catalog list (all products by default)."""
        _make("BR-ACT", brand="Nexans", is_active=True)
        _make("BR-OEM", brand="OEM", is_active=False)
        resp = client.get("/api/brands")
        assert resp.status_code == 200
        assert set(resp.data["values"]) == {"Nexans", "OEM"}

    def test_excludes_empty_and_legacy_typo_brands(self, client):
        _make("BR-EMPTY", brand="")
        _make("BR-TYPO", brand="Unnikern")
        _make("BR-OK", brand="Acome")
        resp = client.get("/api/brands")
        assert resp.data["values"] == ["Acome"]
