"""Sync orchestration — pulls Odoo data into the platform DB.

Each pull is wrapped in a ``SyncLog`` row (CDC §5.4.3).
The runner is tolerant: a single failed item does not abort the whole sync;
failures are accumulated and surfaced through the log.

Dual-instance support (v16 + v19):
  - ``api_version`` param selects which Odoo instance to pull from.
  - Products are matched by ``sku_code`` — no doublons.
  - ``odoo_v16_id`` / ``odoo_v19_id`` are set independently; syncing v19
    never overwrites ``odoo_v16_id`` and vice-versa.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.odoo_sync.adapters.base import OdooAdapter
from apps.odoo_sync.adapters.factory import get_odoo_adapter_for
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
    api_version: str | None = None,
    adapter: OdooAdapter | None = None,
) -> SyncLog:
    """Entry-point for any sync (manual, cron, on-demand).

    ``api_version`` selects the Odoo instance ("v16" or "v19").
    If ``None``, falls back to the default from settings.
    """
    version = (api_version or settings.ODOO.get("API_VERSION", "v19")).lower()
    adapter = adapter or get_odoo_adapter_for(version)
    log = SyncLog.objects.create(
        sync_type=sync_type,
        scope=scope,
        odoo_api_version=version,
        started_at=timezone.now(),
        status=SyncStatus.RUNNING,
        triggered_by=triggered_by,
    )

    try:
        adapter.authenticate()
        last_run_at = _last_successful_sync_at(scope, version)

        if scope in {SyncScope.ALL, SyncScope.PRODUCTS}:
            _sync_products(adapter, log, version, modified_since=last_run_at)
        if scope in {SyncScope.ALL, SyncScope.STOCK}:
            _sync_stock(adapter, log, version)
        if scope in {SyncScope.ALL, SyncScope.CLIENTS}:
            _sync_clients(adapter, log, modified_since=last_run_at)

        log.status = SyncStatus.SUCCESS if log.items_failed == 0 else SyncStatus.PARTIAL_FAILURE
    except Exception as exc:
        log.status = SyncStatus.FAILED
        log.errors.append({"item_id": None, "error_message": str(exc)})
        logger.exception("Odoo sync failed: %s", exc)
    finally:
        log.completed_at = timezone.now()
        log.save()

    return log


def _last_successful_sync_at(scope: SyncScope, version: str) -> datetime | None:
    last = (
        SyncLog.objects.filter(
            scope__in=[scope, SyncScope.ALL],
            status=SyncStatus.SUCCESS,
            odoo_api_version=version,
        )
        .order_by("-completed_at")
        .first()
    )
    return last.completed_at if last else None


# ── Products ──────────────────────────────────────────────────────────────────


def _sync_products(
    adapter: OdooAdapter,
    log: SyncLog,
    version: str,
    modified_since: datetime | None = None,
) -> None:
    """Pull products + suppliers from Odoo and upsert into the platform.

    Strategy:
    - Paginate through all active product.templates from Odoo.
    - Upsert by sku_code (update if exists, create otherwise).
    - SKU validation: only products whose Odoo name matches [A-Z0-9-] are
      synced; others are skipped with a warning.
    - odoo_v16_id / odoo_v19_id: set based on which instance we're pulling from.
      The other version's ID is never overwritten.
    - Suppliers: upsert the first active supplier per product.
    """
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
            _upsert_product(op, log, version, Product, ProductSupplier)

        if len(records) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE

    logger.info(
        "Product sync done (%s): created=%d updated=%d failed=%d",
        version,
        log.items_created,
        log.items_updated,
        log.items_failed,
    )


def _upsert_product(
    op: OdooProduct,
    log: SyncLog,
    version: str,
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
            "name": op.name,
            "universe": op.universe,
            "family": op.family,
            "range": op.range,
            "sub_range": op.sub_range,
            "description_marketing": {"fr": op.description_marketing_fr},
            "description_technical": {"fr": op.description_technical_fr},
            "gtin": op.gtin,
            "hs_code": op.hs_code,
            "unit_weight_kg": op.weight_kg,
            "is_active": op.is_active,
            "odoo_last_sync_at": now,
            # A pull from Odoo wins per CDC §5.6 (last-write-wins, Odoo
            # preferred) — mark our local copy as in-sync so the periodic
            # push-retry task doesn't try to re-push the same row.
            "odoo_sync_status": "synced",
            "odoo_sync_error": "",
        }

        # Set the version-specific odoo_id field.
        # The other version's ID field is NOT in defaults → never overwritten.
        if version == "v16":
            defaults["odoo_v16_id"] = op.odoo_id
            defaults["odoo_id"] = op.odoo_id  # legacy compat
        else:
            defaults["odoo_v19_id"] = op.odoo_id
            defaults["odoo_id"] = op.odoo_id  # legacy compat

        if op.standard_price_eur is not None:
            defaults["pamp_eur"] = op.standard_price_eur
            defaults["pamp_synced_at"] = now

        product, created = Product.objects.update_or_create(
            sku_code=op.sku_code,
            defaults=defaults,
        )

        if created:
            log.items_created += 1
        else:
            log.items_updated += 1

        # Mirror ALL Odoo suppliers so the catalog supplier picker lists every
        # source (CDC §2.1 multi-source). The first stays the active source
        # (pricing reads the active one); the rest are recorded inactive.
        _sync_suppliers(product, op.suppliers, ProductSupplier)

    except Exception as exc:
        log.errors.append({"item_id": str(op.odoo_id), "error_message": str(exc)})
        log.items_failed += 1
        logger.warning("Failed to upsert product odoo_id=%s: %s", op.odoo_id, exc)

    log.save(update_fields=["items_created", "items_updated", "items_failed", "errors"])


def _sync_suppliers(product, supplier_links, ProductSupplier) -> None:
    """Mirror every Odoo supplier of a product onto ``product_suppliers``.

    Odoo can list several ``product.supplierinfo`` rows per product; we keep
    them all so the catalog supplier picker reflects every real source
    (previously only ``suppliers[0]`` was imported, which is why the picker
    only ever showed one company). Exactly **one** stays active — the first,
    which the pricing engine reads — respecting the partial unique index
    ``one_active_supplier_per_product``; the others are stored inactive.
    """
    primary_name: str | None = None
    seen: set[str] = set()
    for link in supplier_links or []:
        if not link.name or link.name in seen:
            continue
        seen.add(link.name)
        if primary_name is None:
            primary_name = link.name
        currency = link.currency if link.currency in ("EUR", "USD", "RMB") else "EUR"
        ProductSupplier.objects.update_or_create(
            product=product,
            supplier_name=link.name,
            defaults={
                "factory_code": link.factory_code or "",
                "po_base_price": link.price,
                "po_currency": currency,
                # Activated below, atomically, so the unique index never trips.
                "is_active": False,
            },
        )
    if primary_name is None:
        return
    with transaction.atomic():
        product.suppliers.exclude(supplier_name=primary_name).update(is_active=False)
        product.suppliers.filter(supplier_name=primary_name).update(is_active=True)


# ── Stock ─────────────────────────────────────────────────────────────────────


def _sync_stock(adapter: OdooAdapter, log: SyncLog, version: str) -> None:
    """Refresh stock_quantity and pamp_eur for all Odoo-linked products."""
    from apps.products.models import Product

    # Select products linked to this Odoo version.
    version_field = "odoo_v16_id" if version == "v16" else "odoo_v19_id"
    synced_qs = Product.objects.filter(
        **{f"{version_field}__isnull": False},
        is_active=True,
    )
    total = synced_qs.count()
    if total == 0:
        logger.info("Stock sync (%s): no Odoo-linked products found", version)
        return

    now = timezone.now()
    for batch_start in range(0, total, _PAGE_SIZE):
        batch = list(synced_qs[batch_start : batch_start + _PAGE_SIZE])
        odoo_ids = [getattr(p, version_field) for p in batch if getattr(p, version_field)]

        try:
            stock_map = adapter.get_stock_quantities(odoo_ids)
        except Exception as exc:
            log.errors.append(
                {
                    "item_id": f"stock_batch_{batch_start}",
                    "error_message": str(exc),
                }
            )
            log.items_failed += len(batch)
            log.save(update_fields=["items_failed", "errors"])
            continue

        for product in batch:
            oid = getattr(product, version_field)
            if oid not in stock_map:
                continue
            stock = stock_map[oid]
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
                log.errors.append({"item_id": str(oid), "error_message": str(exc)})
                log.items_failed += 1

        log.save(update_fields=["items_updated", "items_failed", "errors"])

    logger.info(
        "Stock sync done (%s): updated=%d failed=%d", version, log.items_updated, log.items_failed
    )


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
            log.errors.append(
                {"item_id": f"client_page_offset={offset}", "error_message": str(exc)}
            )
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
        log.items_created,
        log.items_updated,
        log.items_failed,
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
