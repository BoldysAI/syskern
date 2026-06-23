"""Tests for the bulk SKU lookup endpoint (CDC §6.9.2).

`POST /api/products/lookup-bulk` powers the simulation wizard's file-import
path: resolve a batch of SKU codes into found products vs not-found codes.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.products.models import Product

pytestmark = pytest.mark.django_db

URL = "/api/products/lookup-bulk"


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def products() -> list[Product]:
    return [
        Product.objects.create(sku_code="SKU-A", name="Produit A", is_active=True),
        Product.objects.create(sku_code="SKU-B", name="Produit B", is_active=True),
        Product.objects.create(sku_code="SKU-INACTIVE", name="Inactif", is_active=False),
    ]


def test_found_and_not_found(client: APIClient, products: list[Product]) -> None:
    resp = client.post(
        URL,
        {"skus": ["SKU-A", "SKU-B", "SKU-UNKNOWN"]},
        format="json",
    )
    assert resp.status_code == 200
    data = resp.json()
    assert [row["sku_code"] for row in data["found"]] == ["SKU-A", "SKU-B"]
    assert data["not_found"] == ["SKU-UNKNOWN"]
    assert {"id", "sku_code", "name"} == set(data["found"][0].keys())


def test_inactive_products_are_not_found(client: APIClient, products: list[Product]) -> None:
    resp = client.post(URL, {"skus": ["SKU-INACTIVE"]}, format="json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] == []
    assert data["not_found"] == ["SKU-INACTIVE"]


def test_deduplication_and_order_preserved(client: APIClient, products: list[Product]) -> None:
    resp = client.post(
        URL,
        {"skus": ["SKU-B", "SKU-A", "SKU-B", "  SKU-A  ", ""]},
        format="json",
    )
    assert resp.status_code == 200
    data = resp.json()
    # First-seen order preserved, duplicates and blanks collapsed.
    assert [row["sku_code"] for row in data["found"]] == ["SKU-B", "SKU-A"]
    assert data["not_found"] == []


def test_empty_skus_rejected(client: APIClient) -> None:
    resp = client.post(URL, {"skus": []}, format="json")
    assert resp.status_code == 400


def test_performance_thousand_skus(client: APIClient, django_assert_max_num_queries) -> None:
    Product.objects.bulk_create(
        Product(sku_code=f"PERF-{i:04d}", name=f"Produit {i}", is_active=True) for i in range(1000)
    )
    skus = [f"PERF-{i:04d}" for i in range(1000)] + ["MISSING-1", "MISSING-2"]

    # The whole batch is resolved by a single `sku_code__in` query.
    with django_assert_max_num_queries(1):
        resp = client.post(URL, {"skus": skus}, format="json")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["found"]) == 1000
    assert data["not_found"] == ["MISSING-1", "MISSING-2"]
