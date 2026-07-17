"""Integration tests for the Fournisseurs API (Épic FEEDBACK 1 — écart CDC §11.3).

Coverage:
  - Supplier CRUD + lookup by UUID or code
  - Soft-delete + 409 when SKUs are still linked
  - SKU linking from the supplier side (create pre-filled link / remove / dedupe / unknown SKU)
  - Price-history endpoint fed by a manual PO edit
  - Filters (is_active, has_skus)
"""

from __future__ import annotations

import uuid

import pytest
from rest_framework.test import APIClient

from apps.products.models import Product, ProductSupplier, SupplierPriceHistory
from apps.suppliers.models import Supplier

pytestmark = pytest.mark.django_db


@pytest.fixture()
def client() -> APIClient:
    return APIClient()


@pytest.fixture()
def product() -> Product:
    return Product.objects.create(sku_code="SUP-TEST-01", name="Produit test", is_active=True)


@pytest.fixture()
def supplier() -> Supplier:
    return Supplier.objects.create(
        name="Symea Shanghai",
        code="SYMEA-SH",
        currency_default="USD",
        incoterm_default="FOB",
        factory_code_default="21",
        location="Shanghai",
    )


class TestSupplierCrud:
    def test_create_returns_201(self, client):
        resp = client.post(
            "/api/suppliers/",
            {"name": "Nouveau Fourn", "code": "NEW-F", "currency_default": "EUR"},
            format="json",
        )
        assert resp.status_code == 201
        assert Supplier.objects.filter(code="NEW-F").exists()

    def test_list_includes_linked_count(self, client, supplier, product):
        ProductSupplier.objects.create(
            product=product, supplier=supplier, supplier_name=supplier.name
        )
        resp = client.get("/api/suppliers/")
        assert resp.status_code == 200
        row = next(r for r in resp.data["results"] if r["id"] == str(supplier.id))
        assert row["linked_skus_count"] == 1

    def test_retrieve_by_code(self, client, supplier):
        resp = client.get(f"/api/suppliers/{supplier.code}/")
        assert resp.status_code == 200
        assert resp.data["name"] == supplier.name

    def test_retrieve_by_uuid(self, client, supplier):
        resp = client.get(f"/api/suppliers/{supplier.id}/")
        assert resp.status_code == 200

    def test_unknown_uuid_returns_404(self, client):
        resp = client.get(f"/api/suppliers/{uuid.uuid4()}/")
        assert resp.status_code == 404


class TestSupplierDelete:
    def test_delete_without_links_soft_deletes(self, client, supplier):
        resp = client.delete(f"/api/suppliers/{supplier.id}/")
        assert resp.status_code == 204
        supplier.refresh_from_db()
        assert supplier.is_active is False
        # Row is preserved (soft-delete), not hard-deleted.
        assert Supplier.objects.filter(pk=supplier.pk).exists()

    def test_delete_with_links_returns_409(self, client, supplier, product):
        ProductSupplier.objects.create(
            product=product, supplier=supplier, supplier_name=supplier.name
        )
        resp = client.delete(f"/api/suppliers/{supplier.id}/")
        assert resp.status_code == 409
        supplier.refresh_from_db()
        assert supplier.is_active is True


class TestSupplierSkuLinks:
    def test_link_sku_creates_prefilled_link(self, client, supplier, product):
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/", {"sku": product.sku_code}, format="json"
        )
        assert resp.status_code == 201
        link = ProductSupplier.objects.get(supplier=supplier, product=product)
        # Pre-filled from supplier defaults.
        assert link.supplier_name == supplier.name
        assert link.po_currency == supplier.currency_default
        assert link.incoterm == supplier.incoterm_default
        assert link.factory_code == supplier.factory_code_default
        assert link.is_active is False

    def test_link_unknown_sku_returns_404(self, client, supplier):
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/", {"sku": "DOES-NOT-EXIST"}, format="json"
        )
        assert resp.status_code == 404

    def test_link_duplicate_returns_409(self, client, supplier, product):
        client.post(f"/api/suppliers/{supplier.id}/skus/", {"sku": product.sku_code}, format="json")
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/", {"sku": product.sku_code}, format="json"
        )
        assert resp.status_code == 409

    def test_list_and_remove_link(self, client, supplier, product):
        create = client.post(
            f"/api/suppliers/{supplier.id}/skus/", {"sku": product.sku_code}, format="json"
        )
        link_id = create.data["id"]

        listed = client.get(f"/api/suppliers/{supplier.id}/skus/")
        assert listed.status_code == 200
        assert listed.data[0]["product_sku"] == product.sku_code

        removed = client.delete(f"/api/suppliers/{supplier.id}/skus/{link_id}/")
        assert removed.status_code == 204
        assert not ProductSupplier.objects.filter(pk=link_id).exists()


class TestSupplierPriceHistory:
    def test_manual_po_edit_records_history(self, client, supplier, product):
        link = ProductSupplier.objects.create(
            product=product,
            supplier=supplier,
            supplier_name=supplier.name,
            po_base_price="1.0000",
            po_currency="USD",
        )
        # Manual edit via the product-side nested endpoint.
        resp = client.patch(
            f"/api/products/{product.id}/suppliers/{link.id}/",
            {"po_base_price": "2.5000"},
            format="json",
        )
        assert resp.status_code == 200

        history = client.get(f"/api/suppliers/{supplier.id}/price-history/")
        assert history.status_code == 200
        assert len(history.data) == 1
        assert history.data[0]["source"] == "manual"
        assert str(history.data[0]["new_po_base_price"]) == "2.5000"
        assert SupplierPriceHistory.objects.filter(product_supplier=link).count() == 1

    def test_no_history_when_po_unchanged(self, client, supplier, product):
        link = ProductSupplier.objects.create(
            product=product, supplier=supplier, supplier_name=supplier.name, po_base_price="1.0000"
        )
        client.patch(
            f"/api/products/{product.id}/suppliers/{link.id}/",
            {"incoterm_location": "Shanghai"},
            format="json",
        )
        assert SupplierPriceHistory.objects.filter(product_supplier=link).count() == 0


class TestBulkPoUpdate:
    def _link(self, supplier, sku, price):
        product = Product.objects.create(sku_code=sku, name=sku, is_active=True)
        return ProductSupplier.objects.create(
            product=product,
            supplier=supplier,
            supplier_name=supplier.name,
            po_base_price=price,
            po_currency="USD",
        )

    def test_set_mode_updates_all_and_writes_history(self, client, supplier):
        a = self._link(supplier, "BULK-A", "1.0000")
        b = self._link(supplier, "BULK-B", "2.0000")
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/",
            {"link_ids": [str(a.id), str(b.id)], "mode": "set", "value": "9.5"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["updated"] == 2
        a.refresh_from_db()
        b.refresh_from_db()
        assert str(a.po_base_price) == "9.5000"
        assert str(b.po_base_price) == "9.5000"
        assert SupplierPriceHistory.objects.filter(product_supplier__supplier=supplier).count() == 2

    def test_pct_mode_increases(self, client, supplier):
        a = self._link(supplier, "BULK-PCT", "100.0000")
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/",
            {"link_ids": [str(a.id)], "mode": "pct", "value": "10"},
            format="json",
        )
        assert resp.status_code == 200
        a.refresh_from_db()
        assert str(a.po_base_price) == "110.0000"

    def test_abs_negative_clamps_to_zero(self, client, supplier):
        a = self._link(supplier, "BULK-CLAMP", "5.0000")
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/",
            {"link_ids": [str(a.id)], "mode": "abs", "value": "-9"},
            format="json",
        )
        assert resp.status_code == 200
        a.refresh_from_db()
        assert str(a.po_base_price) == "0.0000"

    def test_pct_skips_links_without_price(self, client, supplier):
        a = self._link(supplier, "BULK-NULL", None)
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/",
            {"link_ids": [str(a.id)], "mode": "pct", "value": "10"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["updated"] == 0
        assert resp.data["skipped"] == 1

    def test_set_negative_rejected(self, client, supplier):
        a = self._link(supplier, "BULK-NEG", "1.0000")
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/",
            {"link_ids": [str(a.id)], "mode": "set", "value": "-1"},
            format="json",
        )
        assert resp.status_code == 400

    def test_set_by_product_ids(self, client, supplier):
        a = self._link(supplier, "BULK-PID", "1.0000")
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/",
            {"product_ids": [str(a.product_id)], "mode": "set", "value": "7.5"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["updated"] == 1
        a.refresh_from_db()
        assert str(a.po_base_price) == "7.5000"

    def test_no_target_rejected(self, client, supplier):
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/",
            {"mode": "set", "value": "1"},
            format="json",
        )
        assert resp.status_code == 400

    def test_preview_lists_per_sku_outcomes(self, client, supplier):
        a = self._link(supplier, "PREV-A", "10.0000")
        b = self._link(supplier, "PREV-B", None)
        c = self._link(supplier, "PREV-C", "10.0000")
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-po/preview/",
            {
                "link_ids": [str(a.id), str(b.id), str(c.id)],
                "mode": "pct",
                "value": "10",
            },
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["summary"]["will_update"] == 2
        assert resp.data["summary"]["skip_no_po"] == 1
        assert len(resp.data["lines"]) == 3
        by_sku = {row["product_sku"]: row for row in resp.data["lines"]}
        assert by_sku["PREV-A"]["status"] == "will_update"
        assert by_sku["PREV-A"]["new_po_base_price"] == "11.0000"
        assert by_sku["PREV-B"]["status"] == "skip_no_po"


class TestBulkLink:
    def test_bulk_link_creates_and_skips_existing(self, client, supplier):
        p1 = Product.objects.create(sku_code="LINK-1", name="L1", is_active=True)
        p2 = Product.objects.create(sku_code="LINK-2", name="L2", is_active=True)
        # p2 already linked → should be skipped.
        ProductSupplier.objects.create(product=p2, supplier=supplier, supplier_name=supplier.name)

        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-link/",
            {"product_ids": [str(p1.id), str(p2.id)]},
            format="json",
        )
        assert resp.status_code == 201
        assert resp.data["created"] == 1
        assert resp.data["skipped"] == 1
        link = ProductSupplier.objects.get(product=p1, supplier=supplier)
        assert link.po_currency == supplier.currency_default
        assert link.is_active is False

    def test_bulk_link_empty_rejected(self, client, supplier):
        resp = client.post(
            f"/api/suppliers/{supplier.id}/skus/bulk-link/",
            {"product_ids": []},
            format="json",
        )
        assert resp.status_code == 400


class TestSupplierFilters:
    def test_filter_has_skus(self, client, supplier, product):
        linked = supplier
        ProductSupplier.objects.create(product=product, supplier=linked, supplier_name=linked.name)
        Supplier.objects.create(name="Sans SKU", code="NO-SKU")

        with_skus = client.get("/api/suppliers/?has_skus=true")
        codes = {r["code"] for r in with_skus.data["results"]}
        assert linked.code in codes
        assert "NO-SKU" not in codes

        without = client.get("/api/suppliers/?has_skus=false")
        codes_without = {r["code"] for r in without.data["results"]}
        assert "NO-SKU" in codes_without

    def test_filter_is_active(self, client, supplier):
        Supplier.objects.create(name="Inactif", code="INACT", is_active=False)
        resp = client.get("/api/suppliers/?is_active=false")
        codes = {r["code"] for r in resp.data["results"]}
        assert "INACT" in codes
        assert supplier.code not in codes
