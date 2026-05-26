"""Sync orchestration — pulls Odoo data into the platform DB.

Each pull is wrapped in a ``SyncLog`` row (CDC §5.4.3).
The runner is tolerant: a single failed item does not abort the whole sync;
failures are accumulated and surfaced through the log.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from apps.odoo_sync.adapters.base import OdooAdapter
from apps.odoo_sync.adapters.factory import get_odoo_adapter
from apps.odoo_sync.models import SyncLog, SyncScope, SyncStatus, SyncType
from apps.odoo_sync.schemas import OdooClient, OdooProduct

logger = logging.getLogger(__name__)

# Regex that matches valid Syskern SKU codes — must stay in sync with the
# SKU_VALIDATOR in apps/products/models.py.
_SKU_RE = re.compile(r"^[A-Z0-9\-]+$")

# Page size for paginated Odoo pulls.
_PAGE_SIZE = 200


def sync(
    *,
    scope: SyncScope,
    sync_type: SyncType,
    triggered_by: str = "system",
    adapter: OdooAdapter | None = None,
) -> SyncLog:
    """Entry-point for any sync (manual, cron, on-demand).

    Returns the persisted ``SyncLog`` row.
    """
    adapter = adapter or get_odoo_adapter()
    log = SyncLog.objects.create(
        sync_type=sync_type,
        scope=scope,
        odoo_api_version=settings.ODOO.get("API_VERSION", "v19"),
        started_at=timezone.now(),
        status=SyncStatus.RUNNING,
        triggered_by=triggered_by,
    )

    try:
        adapter.authenticate()
        last_run_at = _last_successful_sync_at(scope)

        if scope in {SyncScope.ALL, SyncScope.PRODUCTS}:
            _sync_products(adapter, log, modified_since=last_run_at)
        if scope in {SyncScope.ALL, SyncScope.STOCK}:
            _sync_stock(adapter, log)
        if scope in {SyncScope.ALL, SyncScope.CLIENTS}:
            _sync_clients(adapter, log, modified_since=last_run_at)
        # purchases / sales are fetched lazily per-simulation by the runner.

        log.status = (
            SyncStatus.SUCCESS if log.items_failed == 0 else SyncStatus.PARTIAL_FAILURE
        )
    except Exception as exc:
        log.status = SyncStatus.FAILED
        log.errors.append({"item_id": None, "error_message": str(exc)})
        logger.exception("Odoo sync failed: %s", exc)
    finally:
        log.completed_at = timezone.now()
        log.save()

    return log


def _last_successful_sync_at(scope: SyncScope) -> datetime | None:
    last = (
        SyncLog.objects.filter(
            scope__in=[scope, SyncScope.ALL],
            status=SyncStatus.SUCCESS,
        )
        .order_by("-completed_at")
        .first()
    )
    return last.completed_at if last else None


# ── Products ──────────────────────────────────────────────────────────────────

def _sync_products(
    adapter: OdooAdapter,
    log: SyncLog,
    modified_since: datetime | None = None,
) -> None:
    """Pull products + suppliers from Odoo and upsert into the platform.

    Strategy:
    - Paginate through all active product.templates from Odoo.
    - Upsert by odoo_id (update if exists, create otherwise).
    - SKU validation: only products whose Odoo name matches [A-Z0-9-] are
      synced; others are skipped with a warning (typical for service products).
    - Suppliers: upsert the first active supplier per product (one-supplier
      constraint in Syskern; arbitration with Olivier pending for multi-supplier).
    """
    # Late import to avoid circular dependency at module load time.
    from apps.products.models import Product, ProductSupplier

    offset = 0
    while True:
        try:
            records = adapter.list_products(
                modified_since=modified_since,
                limit=_PAGE_SIZE,
                offset=offset,
            )
        except Exception as exc:
            log.errors.append({"item_id": f"page_offset={offset}", "error_message": str(exc)})
            log.items_failed += 1
            log.save(update_fields=["items_failed", "errors"])
            break

        if not records:
            break

        for op in records:
            _upsert_product(op, log, Product, ProductSupplier)

        if len(records) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE

    logger.info(
        "Product sync done: created=%d updated=%d failed=%d",
        log.items_created, log.items_updated, log.items_failed,
    )


def _upsert_product(
    op: OdooProduct,
    log: SyncLog,
    Product,
    ProductSupplier,
) -> None:
    # Skip non-SKU products (service items, fee lines, etc.)
    if not _SKU_RE.match(op.sku_code):
        logger.debug("Skipping non-SKU product odoo_id=%s name=%r", op.odoo_id, op.sku_code)
        return

    try:
        now = timezone.now()
        defaults = {
            "sku_code": op.sku_code,
            "name": op.name,
            "universe": op.universe,
            "family": op.family,
            "range": op.range,
            "sub_range": op.sub_range,
            "description_marketing": {"fr": op.description_marketing_fr},
            "description_technical": {"fr": op.description_technical_fr},
            "gtin": op.gtin,
            "unit_weight_kg": op.weight_kg,
            "is_active": op.is_active,
            "odoo_last_sync_at": now,
        }
        if op.standard_price_eur is not None:
            defaults["pamp_eur"] = op.standard_price_eur
            defaults["pamp_synced_at"] = now

        product, created = Product.objects.update_or_create(
            odoo_id=op.odoo_id,
            defaults=defaults,
        )

        if created:
            log.items_created += 1
        else:
            log.items_updated += 1

        # Sync first supplier (primary; multi-supplier arbitration pending).
        if op.suppliers:
            first = op.suppliers[0]
            _upsert_supplier(product, first, ProductSupplier)

    except Exception as exc:
        log.errors.append({"item_id": str(op.odoo_id), "error_message": str(exc)})
        log.items_failed += 1
        logger.warning("Failed to upsert product odoo_id=%s: %s", op.odoo_id, exc)

    log.save(update_fields=["items_created", "items_updated", "items_failed", "errors"])


def _upsert_supplier(product, supplier_link, ProductSupplier) -> None:
    """Upsert the active supplier on a product.

    We keep exactly one active supplier per product (partial unique index).
    Deactivate previous supplier if the name changes.
    """
    if not supplier_link.name:
        return

    # Clamp currency to known choices (EUR / USD / RMB).
    currency = supplier_link.currency if supplier_link.currency in ("EUR", "USD", "RMB") else "EUR"

    # Deactivate previous active supplier if it's a different company.
    existing = ProductSupplier.objects.filter(product=product, is_active=True).first()
    if existing and existing.supplier_name != supplier_link.name:
        existing.is_active = False
        existing.save(update_fields=["is_active"])

    ProductSupplier.objects.update_or_create(
        product=product,
        supplier_name=supplier_link.name,
        defaults={
            "factory_code": supplier_link.factory_code or "",
            "po_base_price": supplier_link.price,
            "po_currency": currency,
            "is_active": True,
        },
    )


# ── Stock ─────────────────────────────────────────────────────────────────────

def _sync_stock(adapter: OdooAdapter, log: SyncLog) -> None:
    """Refresh stock_quantity and pamp_eur for all Odoo-linked products."""
    from apps.products.models import Product

    # Collect all synced products in batches of _PAGE_SIZE
    synced_qs = Product.objects.filter(odoo_id__isnull=False, is_active=True)
    total = synced_qs.count()
    if total == 0:
        logger.info("Stock sync: no Odoo-linked products found")
        return

    now = timezone.now()
    processed = 0
    for batch_start in range(0, total, _PAGE_SIZE):
        batch = list(synced_qs[batch_start: batch_start + _PAGE_SIZE])
        odoo_ids = [p.odoo_id for p in batch if p.odoo_id]

        try:
            stock_map = adapter.get_stock_quantities(odoo_ids)
        except Exception as exc:
            log.errors.append({
                "item_id": f"stock_batch_{batch_start}",
                "error_message": str(exc),
            })
            log.items_failed += len(batch)
            log.save(update_fields=["items_failed", "errors"])
            continue

        for product in batch:
            if product.odoo_id not in stock_map:
                continue
            stock = stock_map[product.odoo_id]
            update_fields: dict = {
                "stock_quantity": stock.quantity,
                "odoo_last_sync_at": now,
            }
            if stock.standard_price_eur is not None:
                update_fields["pamp_eur"] = stock.standard_price_eur
                update_fields["pamp_synced_at"] = now

            try:
                Product.objects.filter(pk=product.pk).update(**update_fields)
                log.items_updated += 1
            except Exception as exc:
                log.errors.append({"item_id": str(product.odoo_id), "error_message": str(exc)})
                log.items_failed += 1

        processed += len(batch)
        log.save(update_fields=["items_updated", "items_failed", "errors"])

    logger.info("Stock sync done: updated=%d failed=%d", log.items_updated, log.items_failed)


# ── Clients ───────────────────────────────────────────────────────────────────

def _sync_clients(
    adapter: OdooAdapter,
    log: SyncLog,
    modified_since: datetime | None = None,
) -> None:
    """Pull res.partner (customer_rank > 0) and upsert into clients table."""
    from apps.clients.models import Client

    offset = 0
    while True:
        try:
            records = adapter.list_clients(
                modified_since=modified_since,
                limit=_PAGE_SIZE,
                offset=offset,
            )
        except Exception as exc:
            log.errors.append({"item_id": f"client_page_offset={offset}", "error_message": str(exc)})
            log.items_failed += 1
            log.save(update_fields=["items_failed", "errors"])
            break

        if not records:
            break

        for oc in records:
            _upsert_client(oc, log, Client)

        if len(records) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE

    logger.info(
        "Client sync done: created=%d updated=%d failed=%d",
        log.items_created, log.items_updated, log.items_failed,
    )


def _upsert_client(oc: OdooClient, log: SyncLog, Client) -> None:
    try:
        lang = oc.preferred_language or "fr"
        # Odoo languages are like "fr_FR" — take the 2-char prefix.
        if "_" in lang:
            lang = lang.split("_")[0]
        # Clamp to known choices.
        if lang not in ("fr", "en", "es"):
            lang = "fr"

        _, created = Client.objects.update_or_create(
            odoo_id=oc.odoo_id,
            defaults={
                "name": oc.name,
                "email": oc.email or "",
                "phone": oc.phone or "",
                "address_street": oc.address_street or "",
                "address_city": oc.address_city or "",
                "address_zip": oc.address_zip or "",
                "address_country": oc.address_country or "",
                "preferred_language": lang,
                "is_prospect": False,  # came from Odoo → confirmed customer
                "odoo_last_sync_at": timezone.now(),
            },
        )
        if created:
            log.items_created += 1
        else:
            log.items_updated += 1

    except Exception as exc:
        log.errors.append({"item_id": str(oc.odoo_id), "error_message": str(exc)})
        log.items_failed += 1
        logger.warning("Failed to upsert client odoo_id=%s: %s", oc.odoo_id, exc)

    log.save(update_fields=["items_created", "items_updated", "items_failed", "errors"])
