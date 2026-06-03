"""Celery tasks for Odoo synchronisation."""
from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from .adapters.factory import get_odoo_adapter, get_odoo_adapter_for
from .models import SyncScope, SyncType
from .schemas import OdooProduct
from .serializers import SyncLogSerializer
from .services.runner import sync

logger = logging.getLogger(__name__)


@shared_task(name="odoo_sync.sync_task", bind=True)
def sync_task(
    self,
    scope: str,
    sync_type: str = SyncType.MANUAL,
    triggered_by: str = "celery",
    api_version: str | None = None,
) -> dict:
    """Run an Odoo sync in a worker.

    `scope` is one of `SyncScope` values, `sync_type` one of `SyncType`.
    Returns a JSON-serializable dict (the persisted SyncLog row).
    """
    log = sync(
        scope=SyncScope(scope),
        sync_type=SyncType(sync_type),
        triggered_by=triggered_by,
        api_version=api_version,
    )
    return SyncLogSerializer(log).data


def _product_to_odoo_dto(product) -> OdooProduct:
    """Translate a platform `Product` row into the version-agnostic DTO
    the adapters consume."""
    return OdooProduct(
        odoo_id=0,
        sku_code=product.sku_code,
        name=product.name or product.sku_code,
        description_marketing_fr=(product.description_marketing or {}).get("fr", ""),
        description_technical_fr=(product.description_technical or {}).get("fr", ""),
        gtin=product.gtin or "",
        weight_kg=product.unit_weight_kg,
        standard_price_eur=product.pamp_eur,
        is_active=product.is_active,
    )


@shared_task(name="odoo_sync.push_product_task", bind=True, autoretry_for=(Exception,),
             retry_backoff=True, retry_backoff_max=60, max_retries=3)
def push_product_task(self, product_pk: str, api_version: str = "v19") -> dict:
    """Push a platform Product to Odoo (CDC §5.3, §5.4.3 — on-demand).

    Creates the Odoo product.template if no ``odoo_v{api_version}_id`` is
    set, otherwise updates the existing one. Stores the returning id on
    the corresponding version-specific field — never overwrites the *other*
    instance's id (cross-instance isolation, CDC §5.6).

    Tracks `odoo_sync_status` on the platform row so the periodic
    `retry_failed_product_pushes` task can pick it up if anything fails.
    """
    from apps.products.models import Product  # late import: avoid app-loading cycles

    try:
        product = Product.objects.get(pk=product_pk)
    except Product.DoesNotExist:
        raise ValueError(f"Product pk={product_pk} not found")

    if api_version not in ("v16", "v19"):
        raise ValueError(f"Invalid api_version={api_version!r} (expected v16 or v19)")

    id_field = f"odoo_{api_version}_id"
    existing_id = getattr(product, id_field, None)

    try:
        adapter = get_odoo_adapter_for(api_version)
        adapter.authenticate()
        dto = _product_to_odoo_dto(product)
        if existing_id:
            payload = adapter.payload_from_product(dto)
            adapter.update_product(existing_id, payload)
            action = "updated"
            odoo_id = existing_id
        else:
            odoo_id = adapter.create_product(dto)
            setattr(product, id_field, odoo_id)
            action = "created"
    except Exception as exc:  # noqa: BLE001 — surface to status + retry
        product.odoo_sync_status = "sync_failed"
        product.odoo_sync_error = f"{type(exc).__name__}: {exc}"[:2000]
        product.save(update_fields=["odoo_sync_status", "odoo_sync_error", "updated_at"])
        logger.warning(
            "push_product_task failed sku=%s api=%s err=%s",
            product.sku_code, api_version, exc,
        )
        raise  # bubbles up → Celery autoretry kicks in

    product.odoo_sync_status = "synced"
    product.odoo_sync_error = ""
    product.odoo_last_sync_at = timezone.now()
    product.save(update_fields=[
        id_field, "odoo_sync_status", "odoo_sync_error",
        "odoo_last_sync_at", "updated_at",
    ])
    logger.info(
        "push_product_task %s sku=%s api=%s odoo_id=%s",
        action, product.sku_code, api_version, odoo_id,
    )
    return {"action": action, "api_version": api_version, "odoo_id": odoo_id}


@shared_task(name="odoo_sync.retry_failed_product_pushes")
def retry_failed_product_pushes_task() -> dict:
    """Re-dispatch push for every product stuck in pending/failed sync.

    CDC §5.4.3 + §5.5 — periodic recovery so platform-side edits eventually
    reach Odoo even if the worker was down or Odoo was unreachable.
    Scheduled hourly by Celery Beat (see migration 0003).
    """
    from django.conf import settings

    from apps.products.models import Product

    api_version = (settings.ODOO.get("API_VERSION") or "v19").lower()
    qs = Product.objects.filter(
        odoo_sync_status__in=("pending_odoo_sync", "sync_failed"),
        is_active=True,
    ).only("pk", "sku_code")[:500]

    dispatched = 0
    for product in qs:
        push_product_task.delay(str(product.pk), api_version=api_version)
        dispatched += 1
    logger.info("retry_failed_product_pushes: dispatched %d products", dispatched)
    return {"dispatched": dispatched, "api_version": api_version}
