"""Integration tests for the attribute registry admin API (CDC §4.1.4 / §4.3).

Coverage:
  - list endpoint exposes the registry with `value_count`
  - create works for every `data_type`
  - `code` is immutable after creation (PATCH → 400)
  - `POST /api/attributes/reorder/` persists `display_order`
  - deleting an attribute cascade-deletes its `product_attribute_values`
"""

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


@pytest.fixture()
def text_attr() -> AttributeRegistry:
    return AttributeRegistry.objects.create(
        code="cable_color",
        label={"fr": "Couleur du câble"},
        category=AttributeCategory.TECHNICAL,
        data_type=AttributeDataType.TEXT,
        display_order=0,
    )


# ─── List ──────────────────────────────────────────────────────────────────


class TestList:
    def test_list_returns_registry_with_value_count(self, client, text_attr):
        p = Product.objects.create(sku_code="LIST-01", name="P", description_marketing={"fr": "x"})
        ProductAttributeValue.objects.create(product=p, attribute=text_attr, value="Rouge")

        resp = client.get("/api/attributes/")
        assert resp.status_code == 200
        results = resp.json()["results"]
        row = next(r for r in results if r["code"] == "cable_color")
        assert row["value_count"] == 1

    def test_list_filters_by_is_filterable(self, client):
        AttributeRegistry.objects.create(
            code="filterable_attr",
            label={"fr": "Filtrable"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            is_filterable=True,
        )
        AttributeRegistry.objects.create(
            code="hidden_attr",
            label={"fr": "Masqué"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            is_filterable=False,
        )

        resp = client.get("/api/attributes/?is_filterable=true")
        assert resp.status_code == 200
        codes = {r["code"] for r in resp.json()["results"]}
        assert codes == {"filterable_attr"}


# ─── Create (all data types) ─────────────────────────────────────────────────


class TestCreate:
    def _post(self, client, payload):
        return client.post("/api/attributes/", payload, format="json")

    @pytest.mark.parametrize(
        "payload",
        [
            {
                "code": "attr_text",
                "label": {"fr": "Texte"},
                "category": "technical",
                "data_type": "text",
            },
            {
                "code": "attr_number",
                "label": {"fr": "Nombre"},
                "category": "technical",
                "data_type": "number",
                "unit": "mm",
            },
            {
                "code": "attr_boolean",
                "label": {"fr": "Booléen"},
                "category": "marketing",
                "data_type": "boolean",
            },
            {
                "code": "attr_date",
                "label": {"fr": "Date"},
                "category": "commercial",
                "data_type": "date",
            },
            {
                "code": "attr_select",
                "label": {"fr": "Choix"},
                "category": "technical",
                "data_type": "select",
                "options": [{"value": "a", "label": {"fr": "A"}}],
            },
            {
                "code": "attr_multiselect",
                "label": {"fr": "Choix multiple"},
                "category": "technical",
                "data_type": "multiselect",
                "options": [
                    {"value": "a", "label": {"fr": "A"}},
                    {"value": "b", "label": {"fr": "B"}},
                ],
            },
        ],
    )
    def test_create_each_data_type(self, client, payload):
        resp = self._post(client, payload)
        assert resp.status_code == 201, resp.json()
        body = resp.json()
        assert body["code"] == payload["code"]
        assert body["value_count"] == 0

    def test_create_select_without_options_rejected(self, client):
        resp = self._post(
            client,
            {
                "code": "attr_bad_select",
                "label": {"fr": "Choix"},
                "category": "technical",
                "data_type": "select",
            },
        )
        assert resp.status_code == 400
        assert "options" in resp.json()

    def test_create_without_french_label_rejected(self, client):
        resp = self._post(
            client,
            {
                "code": "attr_no_fr",
                "label": {"en": "English only"},
                "category": "technical",
                "data_type": "text",
            },
        )
        assert resp.status_code == 400
        assert "label" in resp.json()

    def test_create_invalid_code_rejected(self, client):
        resp = self._post(
            client,
            {
                "code": "Bad-Code",
                "label": {"fr": "X"},
                "category": "technical",
                "data_type": "text",
            },
        )
        assert resp.status_code == 400
        assert "code" in resp.json()


# ─── Immutable code ──────────────────────────────────────────────────────────


class TestImmutableCode:
    def test_patch_code_rejected(self, client, text_attr):
        resp = client.patch(
            f"/api/attributes/{text_attr.pk}/",
            {"code": "renamed_code"},
            format="json",
        )
        assert resp.status_code == 400
        assert "code" in resp.json()
        text_attr.refresh_from_db()
        assert text_attr.code == "cable_color"

    def test_patch_other_field_allowed(self, client, text_attr):
        resp = client.patch(
            f"/api/attributes/{text_attr.pk}/",
            {"label": {"fr": "Nouvelle couleur"}},
            format="json",
        )
        assert resp.status_code == 200
        text_attr.refresh_from_db()
        assert text_attr.label == {"fr": "Nouvelle couleur"}


# ─── Reorder ─────────────────────────────────────────────────────────────────


class TestReorder:
    def test_reorder_persists_display_order(self, client):
        a = AttributeRegistry.objects.create(
            code="attr_a",
            label={"fr": "A"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            display_order=0,
        )
        b = AttributeRegistry.objects.create(
            code="attr_b",
            label={"fr": "B"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            display_order=1,
        )
        c = AttributeRegistry.objects.create(
            code="attr_c",
            label={"fr": "C"},
            category=AttributeCategory.TECHNICAL,
            data_type=AttributeDataType.TEXT,
            display_order=2,
        )

        resp = client.post(
            "/api/attributes/reorder/",
            {"ids": [str(c.pk), str(a.pk), str(b.pk)]},
            format="json",
        )
        assert resp.status_code == 200
        a.refresh_from_db()
        b.refresh_from_db()
        c.refresh_from_db()
        assert (c.display_order, a.display_order, b.display_order) == (0, 1, 2)


# ─── Cascade delete ──────────────────────────────────────────────────────────


class TestCascadeDelete:
    def test_delete_attribute_cascade_deletes_values(self, client, text_attr):
        products = [
            Product.objects.create(
                sku_code=f"CASCADE-{i}",
                name=f"P{i}",
                description_marketing={"fr": "x"},
            )
            for i in range(5)
        ]
        for p in products:
            ProductAttributeValue.objects.create(product=p, attribute=text_attr, value="Rouge")
        assert ProductAttributeValue.objects.filter(attribute=text_attr).count() == 5

        resp = client.delete(f"/api/attributes/{text_attr.pk}/")
        assert resp.status_code == 204
        assert not AttributeRegistry.objects.filter(pk=text_attr.pk).exists()
        assert ProductAttributeValue.objects.filter(attribute=text_attr).count() == 0
