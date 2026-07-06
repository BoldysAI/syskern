"""Unit tests for OdooAdapterV16 and OdooAdapterV19.

All network calls are mocked — no real Odoo connection is made.
Tests verify:
  1. Field normalisation (name→sku_code, categ hierarchy, suppliers, etc.)
  2. Pending purchases / sales filtering (only outstanding qty)
  3. Stock aggregation across variants
  4. Client upsert mapping
  5. Both adapters produce identical output from identical payloads.
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock

from django.test import TestCase

from apps.odoo_sync.adapters.v16 import OdooAdapterV16, _split_category
from apps.odoo_sync.adapters.v19 import OdooAdapterV19

# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_product_raw(
    odoo_id=100,
    name="CAT6ASSTPOH0,3GS",
    categ="All / COPPER / DATA CABLES / SOLID CABLE CAT6A",
    weight=0.052,
    standard_price=8.50,
    barcode="3701234567890",
    write_date="2026-04-01 12:00:00",
    active=True,
):
    return {
        "id": odoo_id,
        "name": name,
        "default_code": False,
        "categ_id": [5, categ],
        "barcode": barcode,
        "weight": weight,
        "hs_code": "8544.49.91",
        "type": "product",
        "active": active,
        "standard_price": standard_price,
        "list_price": 10.0,
        "description": False,
        "description_sale": "Cat6A câble blindé",
        "description_purchase": False,
        "uom_id": [1, "Units"],
        "seller_ids": [201],
        "write_date": write_date,
        "x_studio_num_dop_china": "DOP-CN-001",
        "x_studio_num_dop_trkiye": False,
        "x_studio_to_deliver": 50.0,
    }


def _make_supplier_raw(tmpl_id=100, supplier_name="SYMEA SHANGAÏ", price=65.0, currency="EUR"):
    return {
        "id": 201,
        "partner_id": [9, supplier_name],
        "product_code": "SYM-CAT6A",
        "price": price,
        "currency_id": [1, currency],
        "product_tmpl_id": [tmpl_id, "CAT6ASSTPOH0,3GS"],
        "min_qty": 0.0,
    }


def _make_adapter_v16() -> OdooAdapterV16:
    adapter = OdooAdapterV16(
        base_url="http://mock-odoo-v16",
        db_name="testdb",
        user="user",
        password="pass",
    )
    adapter._uid = 12  # skip authenticate()
    return adapter


def _make_adapter_v19() -> OdooAdapterV19:
    adapter = OdooAdapterV19(
        base_url="http://mock-odoo-v19",
        db_name="testdb",
        user="user",
        password="pass",
    )
    adapter._uid = 12
    return adapter


# ── Category splitting ────────────────────────────────────────────────────────


class TestSplitCategory(TestCase):
    def test_four_levels(self):
        u, f, r, s = _split_category("All / COPPER / DATA CABLES / SOLID CABLE CAT6A")
        self.assertEqual(u, "COPPER")
        self.assertEqual(f, "DATA CABLES")
        self.assertEqual(r, "SOLID CABLE CAT6A")
        self.assertEqual(s, "")

    def test_two_levels(self):
        u, f, r, s = _split_category("ALL / COPPER / BUILDING CABLES")
        self.assertEqual(u, "COPPER")
        self.assertEqual(f, "BUILDING CABLES")
        self.assertEqual(r, "")
        self.assertEqual(s, "")

    def test_root_only(self):
        u, f, r, s = _split_category("All")
        self.assertEqual((u, f, r, s), ("", "", "", ""))

    def test_full_four_with_sub_range(self):
        u, f, r, s = _split_category("All / COPPER / BUILDING CABLES / OR SYT / SHIELDED")
        self.assertEqual(u, "COPPER")
        self.assertEqual(f, "BUILDING CABLES")
        self.assertEqual(r, "OR SYT")
        self.assertEqual(s, "SHIELDED")


# ── V16 product normalisation ─────────────────────────────────────────────────


class TestV16ListProducts(TestCase):
    def _run(self, raw_product, raw_supplier=None):
        adapter = _make_adapter_v16()

        def kw_side_effect(model, method, args, kwargs=None):
            if model == "product.template":
                return [raw_product]
            if model == "product.supplierinfo":
                return [raw_supplier] if raw_supplier else []
            return []

        adapter._kw = MagicMock(side_effect=kw_side_effect)
        return adapter.list_products(limit=10)

    def test_basic_field_mapping(self):
        products = self._run(_make_product_raw())
        self.assertEqual(len(products), 1)
        p = products[0]
        self.assertEqual(p.odoo_id, 100)
        self.assertEqual(p.sku_code, "CAT6ASSTPOH0,3GS")
        self.assertEqual(p.universe, "COPPER")
        self.assertEqual(p.family, "DATA CABLES")
        self.assertEqual(p.range, "SOLID CABLE CAT6A")
        self.assertEqual(p.sub_range, "")
        self.assertEqual(p.gtin, "3701234567890")
        self.assertEqual(p.weight_kg, Decimal("0.052"))
        self.assertEqual(p.standard_price_eur, Decimal("8.5"))
        self.assertEqual(p.description_marketing_fr, "Cat6A câble blindé")
        self.assertTrue(p.is_active)
        # Enrichment fields previously dropped on the floor.
        self.assertEqual(p.dop_number, "DOP-CN-001")
        self.assertEqual(p.uom_name, "Units")
        self.assertEqual(p.brand, "")  # v16 has no brand_id field

    def test_supplier_linked(self):
        products = self._run(
            _make_product_raw(),
            _make_supplier_raw(),
        )
        p = products[0]
        self.assertEqual(len(p.suppliers), 1)
        s = p.suppliers[0]
        self.assertEqual(s.name, "SYMEA SHANGAÏ")
        self.assertEqual(s.factory_code, "SYM-CAT6A")
        self.assertEqual(s.price, Decimal("65.0"))
        self.assertEqual(s.currency, "EUR")

    def test_no_supplier(self):
        products = self._run(_make_product_raw())
        self.assertEqual(products[0].suppliers, [])

    def test_false_weight_becomes_decimal_zero(self):
        raw = _make_product_raw(weight=0.0)
        products = self._run(raw)
        self.assertEqual(products[0].weight_kg, Decimal("0"))

    def test_inactive_product(self):
        raw = _make_product_raw(active=False)
        products = self._run(raw)
        self.assertFalse(products[0].is_active)


# ── V16 pending purchases ─────────────────────────────────────────────────────


class TestV16PendingPurchases(TestCase):
    def _run(self, po_lines, variants):
        adapter = _make_adapter_v16()

        def kw_side_effect(model, method, args, kwargs=None):
            if model == "purchase.order.line":
                return po_lines
            if model == "product.product":
                return variants
            return []

        adapter._kw = MagicMock(side_effect=kw_side_effect)
        return adapter.get_pending_purchases([100, 101])

    def test_outstanding_qty_returned(self):
        po_lines = [
            {
                "id": 1,
                "product_id": [500, "CAT6ASSTPOH0,3GS"],
                "product_qty": 100.0,
                "qty_received": 30.0,
                "price_unit": 65.0,
                "currency_id": [1, "EUR"],
                "date_planned": "2026-06-01 00:00:00",
                "state": "purchase",
            }
        ]
        variants = [{"id": 500, "product_tmpl_id": [100, "CAT6ASSTPOH0,3GS"]}]

        result = self._run(po_lines, variants)
        self.assertIn(100, result)
        self.assertEqual(len(result[100]), 1)
        line = result[100][0]
        self.assertEqual(line.quantity, Decimal("70"))  # 100 - 30
        self.assertEqual(line.price_unit, Decimal("65"))
        self.assertEqual(line.currency, "EUR")

    def test_fully_received_line_excluded(self):
        po_lines = [
            {
                "id": 2,
                "product_id": [500, "X"],
                "product_qty": 50.0,
                "qty_received": 50.0,  # fully received
                "price_unit": 10.0,
                "currency_id": [1, "EUR"],
                "date_planned": False,
                "state": "done",
            }
        ]
        variants = [{"id": 500, "product_tmpl_id": [100, "X"]}]
        result = self._run(po_lines, variants)
        self.assertEqual(result.get(100, []), [])

    def test_empty_ids_returns_empty(self):
        adapter = _make_adapter_v16()
        adapter._kw = MagicMock()
        result = adapter.get_pending_purchases([])
        self.assertEqual(result, {})
        adapter._kw.assert_not_called()


# ── V16 stock aggregation ─────────────────────────────────────────────────────


class TestV16Stock(TestCase):
    def test_aggregates_variants(self):
        adapter = _make_adapter_v16()
        quants = [
            {"product_tmpl_id": [100, "X"], "quantity": 30.0, "reserved_quantity": 5.0},
            {"product_tmpl_id": [100, "X"], "quantity": 20.0, "reserved_quantity": 0.0},
        ]
        adapter._kw = MagicMock(return_value=quants)
        result = adapter.get_stock_quantities([100])
        self.assertIn(100, result)
        self.assertEqual(result[100].quantity, Decimal("50"))  # 30+20
        self.assertEqual(result[100].available_quantity, Decimal("45"))  # 50 - 5

    def test_zeroes_for_missing_product(self):
        adapter = _make_adapter_v16()
        adapter._kw = MagicMock(return_value=[])
        result = adapter.get_stock_quantities([999])
        self.assertEqual(result[999].quantity, Decimal("0"))
        self.assertEqual(result[999].available_quantity, Decimal("0"))


# ── V16 clients ───────────────────────────────────────────────────────────────


class TestV16Clients(TestCase):
    def test_client_mapping(self):
        adapter = _make_adapter_v16()
        raw = [
            {
                "id": 27,
                "name": "ELENDIL LYON",
                "email": "contact@elendil.fr",
                "phone": "+33 4 72 00 00 00",
                "street": "5 rue des Câbles",
                "city": "Saint-Priest",
                "zip": "69800",
                "country_id": [75, "France"],
                "lang": "fr_FR",
                "customer_rank": 1,
                "write_date": "2026-03-15 10:00:00",
            }
        ]
        adapter._kw = MagicMock(return_value=raw)
        clients = adapter.list_clients(limit=10)
        self.assertEqual(len(clients), 1)
        c = clients[0]
        self.assertEqual(c.odoo_id, 27)
        self.assertEqual(c.name, "ELENDIL LYON")
        self.assertEqual(c.address_country, "France")
        self.assertEqual(c.preferred_language, "fr_FR")  # adapter returns raw lang


# ── V19 parity — same inputs produce same outputs ─────────────────────────────


class TestV19Parity(TestCase):
    """V19 adapter must produce the same normalised data as V16 for identical payloads."""

    def test_list_products_parity(self):
        raw = _make_product_raw()
        supplier_raw = _make_supplier_raw()

        def kw_v16(model, method, args, kwargs=None):
            if model == "product.template":
                return [raw]
            if model == "product.supplierinfo":
                return [supplier_raw]
            return []

        def kw_v19(model, method, args, kwargs=None):
            # v19 raw includes gtin_code (preferred) + barcode
            r = dict(raw)
            r["gtin_code"] = raw.get("barcode")
            r["brand_id"] = [3, "Boldys"]
            if model == "product.template":
                return [r]
            if model == "product.supplierinfo":
                return [supplier_raw]
            return []

        v16 = _make_adapter_v16()
        v16._kw = MagicMock(side_effect=kw_v16)
        p16 = v16.list_products(limit=5)[0]

        v19 = _make_adapter_v19()
        v19._kw = MagicMock(side_effect=kw_v19)
        p19 = v19.list_products(limit=5)[0]

        self.assertEqual(p16.odoo_id, p19.odoo_id)
        self.assertEqual(p16.sku_code, p19.sku_code)
        self.assertEqual(p16.universe, p19.universe)
        self.assertEqual(p16.family, p19.family)
        self.assertEqual(p16.standard_price_eur, p19.standard_price_eur)
        self.assertEqual(p16.gtin, p19.gtin)  # v19 prefers gtin_code
        self.assertEqual(len(p16.suppliers), len(p19.suppliers))
        self.assertEqual(p16.suppliers[0].name, p19.suppliers[0].name)
        # Enrichment: DoP + UoM on both; brand only on v19 (no brand_id in v16).
        self.assertEqual(p16.dop_number, "DOP-CN-001")
        self.assertEqual(p19.dop_number, "DOP-CN-001")
        self.assertEqual(p16.uom_name, "Units")
        self.assertEqual(p19.uom_name, "Units")
        self.assertEqual(p16.brand, "")
        self.assertEqual(p19.brand, "Boldys")


class TestV19Payload(TestCase):
    def test_payload_from_product_uses_consu_and_is_storable(self):
        from apps.odoo_sync.schemas import OdooProduct

        v19 = _make_adapter_v19()
        dto = OdooProduct(
            odoo_id=0,
            sku_code="TEST-SKU-01",
            name="Produit test",
            is_active=True,
        )
        payload = v19.payload_from_product(dto)
        self.assertEqual(payload["type"], "consu")
        self.assertTrue(payload["is_storable"])
