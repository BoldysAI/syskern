"""Odoo v19 adapter — JSON-RPC (same endpoint as v16, confirmed working).

Investigation (May 2026) confirmed:
  • The v19 staging instance responds to /jsonrpc execute_kw (same as v16).
  • v19 adds: brand_id, gtin_code fields on product.template.
  • TLS verification disabled on this staging instance (cert mismatch);
    production v19 MUST present a valid cert (ODOO_VERIFY_TLS=true in prod).
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal

from apps.odoo_sync.schemas import (
    OdooClient,
    OdooProduct,
    OdooPurchaseLine,
    OdooStock,
    OdooSupplierLink,
)

from ._rpc import JsonRpcMixin
from .base import OdooAdapter
from .v16 import (
    _PARTNER_FIELDS,
    _STOCK_FIELDS,
    _SUPPLIER_FIELDS,
    _many2one_id,
    _many2one_name,
    _normalize_client,
    _parse_write_date,
    _resolve_variant_to_tmpl,
    _split_category,
    _to_decimal,
    apply_packaging,
    fetch_packaging_map,
)

logger = logging.getLogger(__name__)

# ── v19 product fields (adds gtin_code + brand_id) ──────────────────────────

_PRODUCT_FIELDS_V19 = [
    "id",
    "name",
    "default_code",
    # Référence article native (~8 car.), distincte du SKU (FEEDBACK 2).
    "item_code",
    "categ_id",
    "barcode",
    "gtin_code",
    "weight",
    "hs_code",
    "type",
    "active",
    "standard_price",
    "list_price",
    "description",
    "description_sale",
    "description_purchase",
    "uom_id",
    "seller_ids",
    "brand_id",
    "write_date",
    "x_studio_num_dop_china",
    "x_studio_num_dop_trkiye",
    "x_studio_to_deliver",
]

_PO_LINE_FIELDS_V19 = [
    "id",
    "product_id",
    "product_qty",
    "qty_received",
    "price_unit",
    "currency_id",
    "date_planned",
    "state",
]


def _normalize_product_v19(
    raw: dict,
    supplier_map: dict[int, list[OdooSupplierLink]],
) -> OdooProduct:
    """CDC §5.3 field mapping (v19 variant — adds `gtin_code` + `brand_id`)."""
    tmpl_id: int = raw["id"]
    categ_name = _many2one_name(raw.get("categ_id"))
    universe, family, rng, sub_range = _split_category(categ_name)
    gtin = raw.get("gtin_code") or raw.get("barcode") or ""
    sku_code = raw.get("default_code") or raw.get("name") or ""
    commercial_name = raw.get("name") or sku_code
    return OdooProduct(
        odoo_id=tmpl_id,
        sku_code=sku_code,
        name=commercial_name,
        universe=universe,
        family=family,
        range=rng,
        sub_range=sub_range,
        description_marketing_fr=raw.get("description_sale") or "",
        description_technical_fr=raw.get("description") or "",
        gtin=str(gtin) if gtin else "",
        hs_code=raw.get("hs_code") or "",
        brand=_many2one_name(raw.get("brand_id")),
        dop_number=(raw.get("x_studio_num_dop_china") or raw.get("x_studio_num_dop_trkiye") or ""),
        item_code=raw.get("item_code") or "",
        uom_name=_many2one_name(raw.get("uom_id")),
        weight_kg=_to_decimal(raw.get("weight")),
        standard_price_eur=_to_decimal(raw.get("standard_price")),
        suppliers=supplier_map.get(tmpl_id, []),
        is_active=bool(raw.get("active", True)),
        last_modified=_parse_write_date(raw.get("write_date")),
    )


# ── Adapter ───────────────────────────────────────────────────────────────────


class OdooAdapterV19(JsonRpcMixin, OdooAdapter):
    """Read-only JSON-RPC client for Odoo 19.

    Uses the classic /jsonrpc endpoint (confirmed working on the staging instance).
    The JSON-2 API path can be enabled later if bearer-token auth is mandated.
    """

    def __init__(
        self,
        *,
        base_url: str,
        db_name: str,
        user: str,
        password: str,
        timeout: float = 60.0,
        verify_tls: bool = True,
    ):
        self.base_url = base_url.rstrip("/")
        self.db_name = db_name
        self.user = user
        self.password = password
        self.timeout = timeout
        self._verify_tls = verify_tls
        self._uid: int | None = None
        self._client = None

    # ── Products ──────────────────────────────────────────────────────────

    def _fetch_supplier_map(self, tmpl_ids: list[int]) -> dict[int, list[OdooSupplierLink]]:
        if not tmpl_ids:
            return {}
        rows = self._kw(
            "product.supplierinfo",
            "search_read",
            [[["product_tmpl_id", "in", tmpl_ids]]],
            {"fields": _SUPPLIER_FIELDS},
        )
        result: dict[int, list[OdooSupplierLink]] = {}
        for row in rows:
            tmpl_id = _many2one_id(row.get("product_tmpl_id"))
            if tmpl_id is None:
                continue
            link = OdooSupplierLink(
                name=_many2one_name(row.get("partner_id")),
                factory_code=row.get("product_code") or "",
                price=_to_decimal(row.get("price")),
                currency=_many2one_name(row.get("currency_id")) or "EUR",
                incoterm="",
            )
            result.setdefault(tmpl_id, []).append(link)
        return result

    def list_products(
        self,
        modified_since: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[OdooProduct]:
        domain: list = [["active", "=", True]]
        if modified_since:
            domain.append(["write_date", ">=", modified_since.strftime("%Y-%m-%d %H:%M:%S")])
        raws = self._kw(
            "product.template",
            "search_read",
            [domain],
            {"fields": _PRODUCT_FIELDS_V19, "limit": limit, "offset": offset},
        )
        if not raws:
            return []
        tmpl_ids = [r["id"] for r in raws]
        supplier_map = self._fetch_supplier_map(tmpl_ids)
        pkg_map = fetch_packaging_map(self._kw, tmpl_ids)
        products = [_normalize_product_v19(r, supplier_map) for r in raws]
        for op, r in zip(products, raws, strict=True):
            apply_packaging(op, pkg_map.get(r["id"], {}))
        return products

    def get_product(self, odoo_id: int) -> OdooProduct:
        raws = self._kw(
            "product.template",
            "read",
            [[odoo_id]],
            {"fields": _PRODUCT_FIELDS_V19},
        )
        if not raws:
            raise ValueError(f"product.template id={odoo_id} not found")
        supplier_map = self._fetch_supplier_map([odoo_id])
        op = _normalize_product_v19(raws[0], supplier_map)
        apply_packaging(op, fetch_packaging_map(self._kw, [odoo_id]).get(odoo_id, {}))
        return op

    def payload_from_product(self, product: OdooProduct) -> dict:
        """Same as v16 but also writes `gtin_code` (v19's canonical field)
        in addition to the legacy `barcode` for back-compatibility."""
        payload: dict = {
            "name": product.name or product.sku_code,
            "default_code": product.sku_code,
            "active": product.is_active,
            # Odoo 19 removed type='product' (v16 storable). Goods + tracked inventory
            # replaces the legacy storable product type (cf. odoo/odoo 19.0 product.template).
            "type": "consu",
            "is_storable": True,
        }
        # Odoo reste la source de l'item_code : on ne le repousse que s'il a été
        # saisi côté PIM, jamais vide (cf. v16).
        if product.item_code:
            payload["item_code"] = product.item_code
        if product.gtin:
            payload["gtin_code"] = product.gtin
            payload["barcode"] = product.gtin
        if product.hs_code:
            payload["hs_code"] = product.hs_code
        if product.weight_kg is not None:
            payload["weight"] = float(product.weight_kg)
        if product.description_marketing_fr:
            payload["description_sale"] = product.description_marketing_fr
        if product.description_technical_fr:
            payload["description"] = product.description_technical_fr
        # NOTE: standard_price (PAMP) is NEVER pushed — Odoo is source of truth.
        return payload

    def create_product(self, product: OdooProduct) -> int:
        """Create a product.template in Odoo v19 and return its new id."""
        payload = self.payload_from_product(product)
        new_id = self._kw("product.template", "create", [payload])
        logger.info(
            "Created Odoo v19 product id=%s sku=%s",
            new_id,
            product.sku_code,
        )
        return int(new_id)

    def update_product(self, odoo_id: int, fields: dict) -> None:
        """Update a product.template in Odoo v19. `fields` is an Odoo-shaped dict.

        Use `payload_from_product()` to translate from OdooProduct first.
        """
        if not fields:
            return
        self._kw("product.template", "write", [[odoo_id], fields])
        logger.info(
            "Updated Odoo v19 product id=%s fields=%s",
            odoo_id,
            sorted(fields.keys()),
        )

    # ── Stock ──────────────────────────────────────────────────────────────

    def get_stock_quantities(self, odoo_product_ids: list[int]) -> dict[int, OdooStock]:
        if not odoo_product_ids:
            return {}
        rows = self._kw(
            "stock.quant",
            "search_read",
            [
                [
                    ["product_tmpl_id", "in", odoo_product_ids],
                    ["location_id.usage", "=", "internal"],
                ]
            ],
            {"fields": _STOCK_FIELDS},
        )
        result: dict[int, OdooStock] = {}
        for row in rows:
            tmpl_id = _many2one_id(row.get("product_tmpl_id"))
            if tmpl_id is None:
                continue
            qty = Decimal(str(row.get("quantity") or 0))
            reserved = Decimal(str(row.get("reserved_quantity") or 0))
            if tmpl_id in result:
                existing = result[tmpl_id]
                result[tmpl_id] = OdooStock(
                    quantity=existing.quantity + qty,
                    available_quantity=existing.available_quantity + (qty - reserved),
                )
            else:
                result[tmpl_id] = OdooStock(
                    quantity=qty,
                    available_quantity=qty - reserved,
                )
        for tid in odoo_product_ids:
            if tid not in result:
                result[tid] = OdooStock(quantity=Decimal("0"), available_quantity=Decimal("0"))
        return result

    # ── Pending purchases ──────────────────────────────────────────────────

    def get_pending_purchases(
        self, odoo_product_ids: list[int]
    ) -> dict[int, list[OdooPurchaseLine]]:
        if not odoo_product_ids:
            return {}
        rows = self._kw(
            "purchase.order.line",
            "search_read",
            [
                [
                    ["product_id.product_tmpl_id", "in", odoo_product_ids],
                    ["state", "in", ["purchase", "done"]],
                ]
            ],
            {"fields": _PO_LINE_FIELDS_V19},
        )
        variant_lines: dict[int, list[OdooPurchaseLine]] = {}
        for row in rows:
            product_qty = Decimal(str(row.get("product_qty") or 0))
            qty_received = Decimal(str(row.get("qty_received") or 0))
            if qty_received >= product_qty:
                continue
            variant_id = _many2one_id(row.get("product_id"))
            if variant_id is None:
                continue
            line = OdooPurchaseLine(
                quantity=product_qty - qty_received,
                price_unit=Decimal(str(row.get("price_unit") or 0)),
                currency=_many2one_name(row.get("currency_id")) or "EUR",
                expected_date=_parse_write_date(row.get("date_planned")),
            )
            variant_lines.setdefault(variant_id, []).append(line)

        result = _resolve_variant_to_tmpl(self._kw, variant_lines, odoo_product_ids)
        for tid in odoo_product_ids:
            result.setdefault(tid, [])
        return result

    # ── Pending sales ──────────────────────────────────────────────────────

    def get_pending_sales(self, odoo_product_ids: list[int]) -> dict[int, list[OdooPurchaseLine]]:
        if not odoo_product_ids:
            return {}
        rows = self._kw(
            "sale.order.line",
            "search_read",
            [
                [
                    ["product_id.product_tmpl_id", "in", odoo_product_ids],
                    ["state", "in", ["sale", "done"]],
                ]
            ],
            {
                "fields": [
                    "id",
                    "product_id",
                    "product_uom_qty",
                    "qty_delivered",
                    "price_unit",
                    "currency_id",
                ]
            },
        )
        variant_lines: dict[int, list[OdooPurchaseLine]] = {}
        for row in rows:
            ordered = Decimal(str(row.get("product_uom_qty") or 0))
            delivered = Decimal(str(row.get("qty_delivered") or 0))
            if delivered >= ordered:
                continue
            variant_id = _many2one_id(row.get("product_id"))
            if variant_id is None:
                continue
            line = OdooPurchaseLine(
                quantity=ordered - delivered,
                price_unit=Decimal(str(row.get("price_unit") or 0)),
                currency=_many2one_name(row.get("currency_id")) or "EUR",
                expected_date=None,
            )
            variant_lines.setdefault(variant_id, []).append(line)

        result = _resolve_variant_to_tmpl(self._kw, variant_lines, odoo_product_ids)
        for tid in odoo_product_ids:
            result.setdefault(tid, [])
        return result

    # ── Clients ────────────────────────────────────────────────────────────

    def list_clients(
        self,
        modified_since: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[OdooClient]:
        domain: list = [["customer_rank", ">", 0]]
        if modified_since:
            domain.append(["write_date", ">=", modified_since.strftime("%Y-%m-%d %H:%M:%S")])
        rows = self._kw(
            "res.partner",
            "search_read",
            [domain],
            {"fields": _PARTNER_FIELDS, "limit": limit, "offset": offset},
        )
        return [_normalize_client(r) for r in rows]

    def get_client(self, odoo_id: int) -> OdooClient:
        rows = self._kw(
            "res.partner",
            "read",
            [[odoo_id]],
            {"fields": _PARTNER_FIELDS},
        )
        if not rows:
            raise ValueError(f"res.partner id={odoo_id} not found")
        return _normalize_client(rows[0])
