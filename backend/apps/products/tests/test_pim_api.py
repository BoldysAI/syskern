"""Integration tests for the PIM REST API (CDC §4.4 / §4.5).

Coverage:
  - 1.A  SKU-based product lookup (GET /api/products/{sku})
  - 1.B  Attribute value type validation (PUT /api/products/{id}/attributes/{attr_id})
  - 1.C  Nested attribute endpoints (GET / PUT / DELETE)
  - 1.D  Nested supplier endpoints (POST / PATCH / DELETE / activate)
  - 1.E  Excel export (POST /api/products/export)

All tests use `@pytest.mark.django_db` and DRF's `APIClient`.
"""
from __future__ import annotations

import uuid

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.attributes.models import AttributeCategory, AttributeDataType, AttributeRegistry, ProductAttributeValue
from apps.products.models import Product, ProductSupplier

pytestmark = pytest.mark.django_db


# ─── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def product() -> Product:
    return Product.objects.create(
        sku_code="TEST-SKU-01",
        name="Produit de test",
        description_marketing={"fr": "Description de test"},
        is_active=True,
    )


@pytest.fixture()
def supplier(product: Product) -> ProductSupplier:
    return ProductSupplier.objects.create(
        product=product,
        supplier_name="Fournisseur A",
        factory_code="21",
        is_active=False,
    )


@pytest.fixture()
def text_attr() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="cable_color",
        label={"fr": "Couleur du câble"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.TEXT,
    )


@pytest.fixture()
def number_attr() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="conductor_diameter",
        label={"fr": "Diamètre conducteur"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.NUMBER,
        unit="mm",
    )


@pytest.fixture()
def boolean_attr() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="is_shielded",
        label={"fr": "Blindé"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.BOOLEAN,
    )


@pytest.fixture()
def date_attr() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="certification_date",
        label={"fr": "Date de certification"},
        category=AttributeCategory.STRUCTURAL,
        data_type=AttributeDataType.DATE,
    )


@pytest.fixture()
def select_attr() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="shielding_type",
        label={"fr": "Type de blindage"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.SELECT,
        options=[
            {"value": "UTP", "label": {"fr": "UTP"}},
            {"value": "STP", "label": {"fr": "STP"}},
            {"value": "SFTP", "label": {"fr": "S/FTP"}},
        ],
    )


@pytest.fixture()
def multiselect_attr() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="certifications",
        label={"fr": "Certifications"},
        category=AttributeCategory.STRUCTURAL,
        data_type=AttributeDataType.MULTISELECT,
        options=[
            {"value": "CE", "label": {"fr": "CE"}},
            {"value": "UL", "label": {"fr": "UL"}},
            {"value": "RoHS", "label": {"fr": "RoHS"}},
        ],
    )


# ─── 1.A — SKU lookup ────────────────────────────────────────────────────────


class TestSkuLookup:
    def test_get_by_uuid_returns_product(self, client, product):
        url = f"/api/products/{product.pk}/"
        resp = client.get(url)
        assert resp.status_code == 200
        assert resp.data["sku_code"] == product.sku_code

    def test_get_by_sku_returns_product(self, client, product):
        url = f"/api/products/{product.sku_code}/"
        resp = client.get(url)
        assert resp.status_code == 200
        assert str(resp.data["id"]) == str(product.pk)

    def test_get_by_unknown_sku_returns_404(self, client):
        resp = client.get("/api/products/DOES-NOT-EXIST/")
        assert resp.status_code == 404

    def test_get_by_unknown_uuid_returns_404(self, client):
        resp = client.get(f"/api/products/{uuid.uuid4()}/")
        assert resp.status_code == 404

    def test_patch_by_sku_applies_update(self, client, product):
        url = f"/api/products/{product.sku_code}/"
        resp = client.patch(url, {"name": "Nouveau nom"}, format="json")
        assert resp.status_code == 200
        product.refresh_from_db()
        assert product.name == "Nouveau nom"


# ─── 1.B — Attribute value type validation ───────────────────────────────────


class TestAttributeValueTypeValidation:
    """Test each data_type: valid values pass, invalid values return 400."""

    # text
    def test_text_valid(self, client, product, text_attr):
        url = f"/api/products/{product.pk}/attributes/{text_attr.pk}/"
        resp = client.put(url, {"value": "Rouge"}, format="json")
        assert resp.status_code == 200

    def test_text_integer_is_rejected(self, client, product, text_attr):
        url = f"/api/products/{product.pk}/attributes/{text_attr.pk}/"
        resp = client.put(url, {"value": 42}, format="json")
        assert resp.status_code == 400
        assert "value" in resp.data

    # number
    def test_number_valid_decimal(self, client, product, number_attr):
        url = f"/api/products/{product.pk}/attributes/{number_attr.pk}/"
        resp = client.put(url, {"value": "3.14"}, format="json")
        assert resp.status_code == 200

    def test_number_valid_int(self, client, product, number_attr):
        url = f"/api/products/{product.pk}/attributes/{number_attr.pk}/"
        resp = client.put(url, {"value": 42}, format="json")
        assert resp.status_code == 200

    def test_number_string_rejected(self, client, product, number_attr):
        url = f"/api/products/{product.pk}/attributes/{number_attr.pk}/"
        resp = client.put(url, {"value": "not-a-number"}, format="json")
        assert resp.status_code == 400

    # boolean
    def test_boolean_true_valid(self, client, product, boolean_attr):
        url = f"/api/products/{product.pk}/attributes/{boolean_attr.pk}/"
        resp = client.put(url, {"value": True}, format="json")
        assert resp.status_code == 200

    def test_boolean_string_rejected(self, client, product, boolean_attr):
        url = f"/api/products/{product.pk}/attributes/{boolean_attr.pk}/"
        resp = client.put(url, {"value": "true"}, format="json")
        assert resp.status_code == 400

    # date
    def test_date_valid_iso(self, client, product, date_attr):
        url = f"/api/products/{product.pk}/attributes/{date_attr.pk}/"
        resp = client.put(url, {"value": "2026-04-28"}, format="json")
        assert resp.status_code == 200

    def test_date_wrong_format_rejected(self, client, product, date_attr):
        url = f"/api/products/{product.pk}/attributes/{date_attr.pk}/"
        resp = client.put(url, {"value": "28/04/2026"}, format="json")
        assert resp.status_code == 400

    # select
    def test_select_valid_option(self, client, product, select_attr):
        url = f"/api/products/{product.pk}/attributes/{select_attr.pk}/"
        resp = client.put(url, {"value": "SFTP"}, format="json")
        assert resp.status_code == 200

    def test_select_invalid_option_rejected(self, client, product, select_attr):
        url = f"/api/products/{product.pk}/attributes/{select_attr.pk}/"
        resp = client.put(url, {"value": "COAX"}, format="json")
        assert resp.status_code == 400
        assert "value" in resp.data

    def test_select_malformed_options_returns_400_not_500(self, client, product):
        attr = AttributeRegistry.objects.create(
            code="bad_select_opts",
            label={"fr": "Options invalides"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.SELECT,
            options=[{"label": {"fr": "UTP"}}],
        )
        url = f"/api/products/{product.pk}/attributes/{attr.pk}/"
        resp = client.put(url, {"value": "UTP"}, format="json")
        assert resp.status_code == 400
        assert "options" in resp.data

    # multiselect
    def test_multiselect_valid_list(self, client, product, multiselect_attr):
        url = f"/api/products/{product.pk}/attributes/{multiselect_attr.pk}/"
        resp = client.put(url, {"value": ["CE", "RoHS"]}, format="json")
        assert resp.status_code == 200

    def test_multiselect_invalid_member_rejected(self, client, product, multiselect_attr):
        url = f"/api/products/{product.pk}/attributes/{multiselect_attr.pk}/"
        resp = client.put(url, {"value": ["CE", "INVALID"]}, format="json")
        assert resp.status_code == 400

    def test_multiselect_not_a_list_rejected(self, client, product, multiselect_attr):
        url = f"/api/products/{product.pk}/attributes/{multiselect_attr.pk}/"
        resp = client.put(url, {"value": "CE"}, format="json")
        assert resp.status_code == 400

    def test_multiselect_malformed_options_returns_400_not_500(self, client, product):
        attr = AttributeRegistry.objects.create(
            code="bad_multi_opts",
            label={"fr": "Options invalides"},
            category=AttributeCategory.STRUCTURAL,
            data_type=AttributeDataType.MULTISELECT,
            options=[{"label": {"fr": "CE"}}],
        )
        url = f"/api/products/{product.pk}/attributes/{attr.pk}/"
        resp = client.put(url, {"value": ["CE"]}, format="json")
        assert resp.status_code == 400
        assert "options" in resp.data


# ─── 1.C — Nested attribute endpoints ────────────────────────────────────────


class TestNestedAttributeEndpoints:
    def test_list_attributes_empty(self, client, product):
        url = f"/api/products/{product.pk}/attributes/"
        resp = client.get(url)
        assert resp.status_code == 200
        assert resp.data == []

    def test_put_creates_value(self, client, product, text_attr):
        url = f"/api/products/{product.pk}/attributes/{text_attr.pk}/"
        resp = client.put(url, {"value": "Bleu"}, format="json")
        assert resp.status_code == 200
        assert ProductAttributeValue.objects.filter(
            product=product, attribute=text_attr
        ).exists()

    def test_put_updates_existing_value(self, client, product, text_attr):
        ProductAttributeValue.objects.create(product=product, attribute=text_attr, value="Rouge")
        url = f"/api/products/{product.pk}/attributes/{text_attr.pk}/"
        resp = client.put(url, {"value": "Vert"}, format="json")
        assert resp.status_code == 200
        pav = ProductAttributeValue.objects.get(product=product, attribute=text_attr)
        assert pav.value == "Vert"

    def test_put_is_idempotent(self, client, product, text_attr):
        url = f"/api/products/{product.pk}/attributes/{text_attr.pk}/"
        client.put(url, {"value": "X"}, format="json")
        client.put(url, {"value": "X"}, format="json")
        assert ProductAttributeValue.objects.filter(product=product, attribute=text_attr).count() == 1

    def test_list_attributes_shows_set_values(self, client, product, text_attr, boolean_attr):
        ProductAttributeValue.objects.create(product=product, attribute=text_attr, value="Blanc")
        ProductAttributeValue.objects.create(product=product, attribute=boolean_attr, value=True)
        url = f"/api/products/{product.pk}/attributes/"
        resp = client.get(url)
        assert resp.status_code == 200
        assert len(resp.data) == 2

    def test_delete_removes_value(self, client, product, text_attr):
        ProductAttributeValue.objects.create(product=product, attribute=text_attr, value="Noir")
        url = f"/api/products/{product.pk}/attributes/{text_attr.pk}/"
        resp = client.delete(url)
        assert resp.status_code == 204
        assert not ProductAttributeValue.objects.filter(product=product, attribute=text_attr).exists()

    def test_delete_nonexistent_value_returns_404(self, client, product, text_attr):
        url = f"/api/products/{product.pk}/attributes/{text_attr.pk}/"
        resp = client.delete(url)
        assert resp.status_code == 404

    def test_put_unknown_attribute_id_returns_404(self, client, product):
        url = f"/api/products/{product.pk}/attributes/{uuid.uuid4()}/"
        resp = client.put(url, {"value": "X"}, format="json")
        assert resp.status_code == 404


# ─── 1.D — Nested supplier endpoints ─────────────────────────────────────────


class TestNestedSupplierEndpoints:
    def test_list_suppliers_empty(self, client, product):
        url = f"/api/products/{product.pk}/suppliers/"
        resp = client.get(url)
        assert resp.status_code == 200
        assert resp.data == []

    def test_post_creates_supplier(self, client, product):
        url = f"/api/products/{product.pk}/suppliers/"
        resp = client.post(
            url,
            {"supplier_name": "Symea Shanghai", "factory_code": "21"},
            format="json",
        )
        assert resp.status_code == 201
        assert ProductSupplier.objects.filter(product=product, factory_code="21").exists()

    def test_list_shows_created_supplier(self, client, product, supplier):
        url = f"/api/products/{product.pk}/suppliers/"
        resp = client.get(url)
        assert resp.status_code == 200
        assert len(resp.data) == 1
        assert resp.data[0]["supplier_name"] == supplier.supplier_name

    def test_patch_updates_supplier(self, client, product, supplier):
        url = f"/api/products/{product.pk}/suppliers/{supplier.pk}/"
        resp = client.patch(url, {"supplier_name": "Symea Updated"}, format="json")
        assert resp.status_code == 200
        supplier.refresh_from_db()
        assert supplier.supplier_name == "Symea Updated"

    def test_delete_removes_supplier(self, client, product, supplier):
        url = f"/api/products/{product.pk}/suppliers/{supplier.pk}/"
        resp = client.delete(url)
        assert resp.status_code == 204
        assert not ProductSupplier.objects.filter(pk=supplier.pk).exists()

    def test_delete_supplier_of_different_product_returns_404(self, client, product):
        other_product = Product.objects.create(
            sku_code="OTHER-SKU",
            name="Autre produit",
            description_marketing={"fr": "Autre"},
        )
        other_supplier = ProductSupplier.objects.create(
            product=other_product,
            supplier_name="Autre fournisseur",
        )
        url = f"/api/products/{product.pk}/suppliers/{other_supplier.pk}/"
        resp = client.delete(url)
        assert resp.status_code == 404

    def test_activate_sets_is_active_and_deactivates_others(self, client, product):
        s1 = ProductSupplier.objects.create(
            product=product, supplier_name="Fournisseur 1", is_active=True
        )
        s2 = ProductSupplier.objects.create(
            product=product, supplier_name="Fournisseur 2", is_active=False
        )
        url = f"/api/products/{product.pk}/suppliers/{s2.pk}/activate/"
        resp = client.post(url)
        assert resp.status_code == 200
        s1.refresh_from_db()
        s2.refresh_from_db()
        assert s2.is_active is True
        assert s1.is_active is False

    def test_activate_unknown_supplier_returns_404(self, client, product):
        url = f"/api/products/{product.pk}/suppliers/{uuid.uuid4()}/activate/"
        resp = client.post(url)
        assert resp.status_code == 404


# ─── 1.E — Excel export ───────────────────────────────────────────────────────


class TestExcelExport:
    def test_export_returns_xlsx_content_type(self, client, product):
        resp = client.post("/api/products/export/", {}, format="json")
        assert resp.status_code == 200
        assert (
            resp["Content-Type"]
            == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    def test_export_has_content_disposition(self, client, product):
        resp = client.post("/api/products/export/", {}, format="json")
        assert "attachment" in resp["Content-Disposition"]
        assert ".xlsx" in resp["Content-Disposition"]

    def test_export_returns_non_empty_bytes(self, client, product):
        resp = client.post("/api/products/export/", {}, format="json")
        assert len(resp.content) > 0

    def test_export_with_sku_filter_returns_subset(self, client):
        Product.objects.create(
            sku_code="EXPORT-A",
            name="Produit A",
            description_marketing={"fr": "A"},
        )
        Product.objects.create(
            sku_code="EXPORT-B",
            name="Produit B",
            description_marketing={"fr": "B"},
        )
        resp_all = client.post("/api/products/export/", {}, format="json")
        resp_filtered = client.post(
            "/api/products/export/", {"sku_code": "EXPORT-A"}, format="json"
        )
        # Both succeed; the filtered response is smaller (fewer rows → smaller file).
        assert resp_all.status_code == 200
        assert resp_filtered.status_code == 200
        assert len(resp_filtered.content) < len(resp_all.content)
