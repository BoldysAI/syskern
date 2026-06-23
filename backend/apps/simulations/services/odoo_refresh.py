"""Bulk Odoo refresh for a simulation recalc (CDC §6.9.4 scopes 2 & 3).

Pulls fresh stock + PAMP + pending purchases for every product attached to a
simulation, in batch, through the Odoo adapter factory (never a direct Odoo
call — `/AGENTS.md` §5 r.3). The pending purchases feed the predictive PAMP
(`compute_predictive_pamp`); their `price_unit` is converted to EUR using the
simulation's frozen FX (`fx_eur_<currency>` in `market_params`). Lines whose
currency has no available FX are skipped (we never invent a rate).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from django.utils import timezone

from apps.odoo_sync.adapters.factory import get_odoo_adapter
from apps.products.models import Product

from .engine import PendingPurchase, to_decimal


def _to_eur(amount: Decimal, currency: str, market_params: dict) -> Decimal | None:
    """Convert *amount* in *currency* to EUR via `fx_eur_<currency>`.

    `fx_eur_usd = 1.15` means "1 EUR = 1.15 USD", so EUR = amount / fx.
    Returns None when the currency is unknown and no FX is available.
    """
    cur = (currency or "EUR").upper()
    if cur == "EUR":
        return to_decimal(amount)
    raw_fx = market_params.get(f"fx_eur_{cur.lower()}")
    if not raw_fx:
        return None
    fx = to_decimal(raw_fx)
    if fx <= 0:
        return None
    return to_decimal(amount) / fx


def refresh_odoo_for_simulation(
    simulation,
) -> tuple[datetime, dict[str, list[PendingPurchase]]]:
    """Refresh Odoo data for every product of `simulation`.

    Returns `(snapshot_at, pending_by_product)` where `pending_by_product`
    maps `str(product_id)` to the list of EUR-converted pending purchases.
    Raises on any Odoo failure so the caller (Celery task) surfaces it.
    """
    market_params = simulation.market_params or {}

    products = list(
        Product.objects.filter(
            simulation_lines__simulation=simulation,
            odoo_id__isnull=False,
        ).distinct()
    )
    snapshot_at = timezone.now()
    pending_by_product: dict[str, list[PendingPurchase]] = {}

    if not products:
        return snapshot_at, pending_by_product

    odoo_ids: list[int] = [p.odoo_id for p in products if p.odoo_id is not None]
    by_odoo_id = {p.odoo_id: p for p in products}

    adapter = get_odoo_adapter()
    adapter.authenticate()
    stock_map = adapter.get_stock_quantities(odoo_ids)
    pending_map = adapter.get_pending_purchases(odoo_ids)

    for odoo_id, stock in stock_map.items():
        product = by_odoo_id.get(odoo_id)
        if product is None:
            continue
        update_fields = {
            "stock_quantity": stock.quantity,
            "odoo_last_sync_at": snapshot_at,
        }
        if stock.standard_price_eur is not None:
            update_fields["pamp_eur"] = stock.standard_price_eur
            update_fields["pamp_synced_at"] = snapshot_at
        Product.objects.filter(pk=product.pk).update(**update_fields)

    for odoo_id, lines in pending_map.items():
        product = by_odoo_id.get(odoo_id)
        if product is None:
            continue
        converted: list[PendingPurchase] = []
        for raw in lines:
            price_eur = _to_eur(raw.price_unit, raw.currency, market_params)
            if price_eur is None:
                continue
            converted.append(
                PendingPurchase(quantity=to_decimal(raw.quantity), price_unit_eur=price_eur)
            )
        if converted:
            pending_by_product[str(product.pk)] = converted

    return snapshot_at, pending_by_product
