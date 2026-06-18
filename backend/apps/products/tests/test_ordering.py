"""Catalog ordering — NULLS LAST for wizard products without PAMP."""

from __future__ import annotations

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.products.models import Product

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


def _make(sku: str, **kwargs) -> Product:
    return Product.objects.create(
        sku_code=sku,
        name=sku,
        description_marketing={"fr": "x"},
        **kwargs,
    )


def _sku_order(resp) -> list[str]:
    return [r["sku_code"] for r in resp.data["results"]]


class TestPampOrdering:
    def test_pamp_desc_puts_null_pamp_last(self, client):
        """Wizard products (pamp_eur=NULL) must not top a descending PAMP sort."""
        _make("P-HIGH", pamp_eur=Decimal("100.0000"))
        _make("P-LOW", pamp_eur=Decimal("10.0000"))
        _make("P-WIZARD")  # no PAMP — typical wizard / not yet synced from Odoo

        resp = client.get("/api/products/", {"ordering": "-pamp_eur"})
        assert resp.status_code == 200
        order = _sku_order(resp)
        assert order.index("P-HIGH") < order.index("P-LOW") < order.index("P-WIZARD")

    def test_pamp_asc_puts_null_pamp_last(self, client):
        _make("P-HIGH", pamp_eur=Decimal("100.0000"))
        _make("P-WIZARD")

        resp = client.get("/api/products/", {"ordering": "pamp_eur"})
        assert resp.status_code == 200
        order = _sku_order(resp)
        assert order.index("P-WIZARD") > order.index("P-HIGH")

    def test_pamp_min_excludes_null(self, client):
        _make("P-OK", pamp_eur=Decimal("50.0000"))
        _make("P-WIZARD")

        resp = client.get("/api/products/", {"pamp_min": "10"})
        assert resp.status_code == 200
        assert _sku_order(resp) == ["P-OK"]
