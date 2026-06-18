"""Full-text search tests (CDC §4.1.1 — `tsvector` french + simple).

Exercise the `?q=` param backed by the Postgres `search_vector` generated
column. Requires a real PostgreSQL backend (the generated column and GIN
index are created by migration 0004).
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def fr_product() -> Product:
    return Product.objects.create(
        sku_code="CABLE-FR-01",
        name="Câble cuivre blindé",
        description_marketing={"fr": "Câble haute performance pour réseaux"},
        is_active=True,
    )


@pytest.fixture()
def en_product() -> Product:
    return Product.objects.create(
        sku_code="FIBER-EN-01",
        name="Optical patch cord",
        description_marketing={"en": "High performance fiber optic cable"},
        is_active=True,
    )


def _skus(resp) -> set[str]:
    results = resp.data.get("results", resp.data)
    return {r["sku_code"] for r in results}


class TestFullTextSearch:
    def test_fr_stemming_matches(self, client, fr_product):
        """French stemming: plural 'câbles' matches singular 'câble'."""
        resp = client.get("/api/products/", {"q": "câbles"})
        assert resp.status_code == 200
        assert fr_product.sku_code in _skus(resp)

    def test_en_description_matches(self, client, en_product):
        resp = client.get("/api/products/", {"q": "fiber"})
        assert resp.status_code == 200
        assert en_product.sku_code in _skus(resp)

    def test_search_matches_sku_code(self, client, fr_product):
        resp = client.get("/api/products/", {"q": "CABLE-FR-01"})
        assert resp.status_code == 200
        assert fr_product.sku_code in _skus(resp)

    def test_search_excludes_non_matching(self, client, fr_product, en_product):
        resp = client.get("/api/products/", {"q": "optical"})
        assert resp.status_code == 200
        skus = _skus(resp)
        assert en_product.sku_code in skus
        assert fr_product.sku_code not in skus

    def test_search_combinable_with_filter(self, client, fr_product, en_product):
        """Full-text search combines with other filters (here: is_active)."""
        Product.objects.create(
            sku_code="CABLE-FR-02",
            name="Câble inactif",
            description_marketing={"fr": "Câble"},
            is_active=False,
        )
        resp = client.get("/api/products/", {"q": "câble", "is_active": "true"})
        assert resp.status_code == 200
        skus = _skus(resp)
        assert fr_product.sku_code in skus
        assert "CABLE-FR-02" not in skus
