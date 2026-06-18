"""Odoo v16 adapter — JSON-RPC / execute_kw (CDC §5.2).

Field mapping decisions confirmed by odoo_explore investigation (April–May 2026):
  • SKU              ← product.template.name  (default_code is always False)
  • category levels  ← categ_id.complete_name split on " / "
  • weight_kg        ← weight  (kg, native Odoo unit)
  • standard_price   ← standard_price  (EUR, cost price in this instance)
  • suppliers        ← product.supplierinfo (seller_ids)
  • stock            ← stock.quant aggregated per product_tmpl_id
  • pending POs      ← purchase.order.line  state∈('purchase','done')
                        product_qty > qty_received; resolved via product_id→tmpl
  • clients          ← res.partner  customer_rank > 0
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

logger = logging.getLogger(__name__)

# ── Field sets ───────────────────────────────────────────────────────────────

_PRODUCT_FIELDS = [
    "id",
    "name",
    "default_code",
    "categ_id",
    "barcode",
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
    "write_date",
    "x_studio_num_dop_china",
    "x_studio_num_dop_trkiye",
    "x_studio_to_deliver",
]

_SUPPLIER_FIELDS = [
    "id",
    "partner_id",
    "product_code",
    "price",
    "currency_id",
    "product_tmpl_id",
    "min_qty",
]

_STOCK_FIELDS = [
    "product_tmpl_id",
    "quantity",
    "reserved_quantity",
]

_PARTNER_FIELDS = [
    "id",
    "name",
    "email",
    "phone",
    "street",
    "city",
    "zip",
    "country_id",
    "lang",
    "customer_rank",
    "write_date",
]

# Note: product_tmpl_id is NOT in here — it's not a stored/searchable field on
# purchase.order.line in all Odoo versions.  We resolve via product_id instead.
_PO_LINE_FIELDS = [
    "id",
    "product_id",
    "product_qty",
    "qty_received",
    "price_unit",
    "currency_id",
    "date_planned",
    "state",
]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _split_category(complete_name: str) -> tuple[str, str, str, str]:
    """Return (universe, family, range, sub_range) from a categ complete_name.

    Examples:
      "All / COPPER / DATA CABLES / SOLID CABLE CAT5E"
        → ("COPPER", "DATA CABLES", "SOLID CABLE CAT5E", "")
      "ALL / COPPER / BUILDING CABLES"
        → ("COPPER", "BUILDING CABLES", "", "")
    """
    parts = [p.strip() for p in complete_name.split("/")]
    parts = [p for p in parts if p.lower() not in ("all",)]
    levels = (parts + ["", "", "", ""])[:4]
    return tuple(levels)  # type: ignore[return-value]


def _to_decimal(value) -> Decimal | None:
    if value is None or value is False:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _parse_write_date(raw) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _many2one_name(field_value) -> str:
    if isinstance(field_value, list | tuple) and len(field_value) >= 2:
        return str(field_value[1])
    return ""


def _many2one_id(field_value) -> int | None:
    if isinstance(field_value, list | tuple) and field_value:
        return int(field_value[0])
    if isinstance(field_value, int):
        return field_value
    return None


# ── Normalisation ─────────────────────────────────────────────────────────────


def _normalize_product(
    raw: dict,
    supplier_map: dict[int, list[OdooSupplierLink]],
) -> OdooProduct:
    """CDC §5.3 field mapping.

    Per the CDC: `sku_code ↔ default_code`, `name ↔ name` (commercial).
    Defensive fallback to `name` for SKU is preserved because Syskern's
    historical Odoo data stores the SKU in `name` (investigation report).
    """
    tmpl_id: int = raw["id"]
    categ_name = _many2one_name(raw.get("categ_id"))
    universe, family, rng, sub_range = _split_category(categ_name)
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
        gtin=raw.get("barcode") or "",
        hs_code=raw.get("hs_code") or "",
        weight_kg=_to_decimal(raw.get("weight")),
        standard_price_eur=_to_decimal(raw.get("standard_price")),
        suppliers=supplier_map.get(tmpl_id, []),
        is_active=bool(raw.get("active", True)),
        last_modified=_parse_write_date(raw.get("write_date")),
    )


def _normalize_client(raw: dict) -> OdooClient:
    country = _many2one_name(raw.get("country_id"))
    return OdooClient(
        odoo_id=raw["id"],
        name=raw.get("name") or "",
        email=raw.get("email") or "",
        phone=raw.get("phone") or "",
        address_street=raw.get("street") or "",
        address_city=raw.get("city") or "",
        address_zip=raw.get("zip") or "",
        address_country=country,
        preferred_language=raw.get("lang") or "fr",
        is_customer=bool(raw.get("customer_rank", 0)),
        last_modified=_parse_write_date(raw.get("write_date")),
    )


# ── Shared resolution helper ──────────────────────────────────────────────────


def _resolve_variant_to_tmpl(
    kw_fn,
    variant_lines: dict[int, list[OdooPurchaseLine]],
    allowed_tmpl_ids: list[int],
) -> dict[int, list[OdooPurchaseLine]]:
    """Given a dict keyed by variant_id, return one keyed by tmpl_id.

    ``kw_fn`` is the adapter's ``_kw`` method (passed to avoid circular refs).
    Only includes tmpl_ids that are in ``allowed_tmpl_ids``.
    """
    if not variant_lines:
        return {}
    variant_ids = list(variant_lines.keys())
    variants = kw_fn(
        "product.product",
        "read",
        [variant_ids],
        {"fields": ["id", "product_tmpl_id"]},
    )
    result: dict[int, list[OdooPurchaseLine]] = {}
    for v in variants:
        tmpl_id = _many2one_id(v.get("product_tmpl_id"))
        if tmpl_id is not None and tmpl_id in allowed_tmpl_ids:
            result.setdefault(tmpl_id, []).extend(variant_lines.get(v["id"], []))
    return result


# ── Adapter ───────────────────────────────────────────────────────────────────


class OdooAdapterV16(JsonRpcMixin, OdooAdapter):
    """Read-only JSON-RPC client for Odoo 16.

    Phase-A: all read operations implemented.
    Write operations raise NotImplementedError until Olivier approves sync strategy.
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
            {"fields": _PRODUCT_FIELDS, "limit": limit, "offset": offset},
        )
        if not raws:
            return []
        tmpl_ids = [r["id"] for r in raws]
        supplier_map = self._fetch_supplier_map(tmpl_ids)
        return [_normalize_product(r, supplier_map) for r in raws]

    def get_product(self, odoo_id: int) -> OdooProduct:
        raws = self._kw(
            "product.template",
            "read",
            [[odoo_id]],
            {"fields": _PRODUCT_FIELDS},
        )
        if not raws:
            raise ValueError(f"product.template id={odoo_id} not found")
        supplier_map = self._fetch_supplier_map([odoo_id])
        return _normalize_product(raws[0], supplier_map)

    def payload_from_product(self, product: OdooProduct) -> dict:
        """Translate the platform's OdooProduct DTO → Odoo v16 write/create dict.

        Field mapping per CDC §5.3 (writeable fields only — pricelist,
        category, brand, dynamic attributes are NOT pushed back):
          • sku_code              → default_code
          • name (commercial)     → name
          • gtin                  → barcode  (v19 also writes gtin_code)
          • hs_code               → hs_code
          • weight_kg             → weight
          • is_active             → active
          • description_marketing → description_sale
          • description_technical → description
        """
        payload: dict = {
            "name": product.name or product.sku_code,
            "default_code": product.sku_code,
            "active": product.is_active,
            "type": "product",
        }
        if product.gtin:
            payload["barcode"] = product.gtin
        if product.hs_code:
            payload["hs_code"] = product.hs_code
        if product.weight_kg is not None:
            payload["weight"] = float(product.weight_kg)
        if product.description_marketing_fr:
            payload["description_sale"] = product.description_marketing_fr
        if product.description_technical_fr:
            payload["description"] = product.description_technical_fr
        # NOTE: standard_price (PAMP) is NEVER pushed — it's Odoo's source of truth.
        return payload

    def create_product(self, product: OdooProduct) -> int:
        """Create a product.template in Odoo v16 and return its new id."""
        payload = self.payload_from_product(product)
        new_id = self._kw("product.template", "create", [payload])
        logger.info(
            "Created Odoo v16 product id=%s sku=%s",
            new_id,
            product.sku_code,
        )
        return int(new_id)

    def update_product(self, odoo_id: int, fields: dict) -> None:
        """Update a product.template in Odoo v16. `fields` is an Odoo-shaped dict.

        Use `payload_from_product()` to translate from OdooProduct first.
        """
        if not fields:
            return
        self._kw("product.template", "write", [[odoo_id], fields])
        logger.info(
            "Updated Odoo v16 product id=%s fields=%s",
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
        """PO lines confirmed but not yet fully received (PAMP predictive source)."""
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
            {"fields": _PO_LINE_FIELDS},
        )

        # Collect by variant_id first; resolve to tmpl_id in one batch call.
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
        """Sale lines confirmed but not yet fully delivered."""
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
