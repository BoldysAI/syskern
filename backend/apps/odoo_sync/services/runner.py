"""Sync orchestration — pulls Odoo data into the platform DB.

Each pull is wrapped in a `SyncLog` row (CDC §5.4.3 → table sync_logs).
The runner is intentionally tolerant: a single failed item does not abort
the whole sync; failures are accumulated and surfaced through the log.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from django.conf import settings
from django.utils import timezone

from apps.odoo_sync.adapters.base import OdooAdapter
from apps.odoo_sync.adapters.factory import get_odoo_adapter
from apps.odoo_sync.models import SyncLog, SyncScope, SyncStatus, SyncType


def sync(
    *,
    scope: SyncScope,
    sync_type: SyncType,
    triggered_by: str = "system",
    adapter: OdooAdapter | None = None,
) -> SyncLog:
    """Entry-point for any sync (manual, cron, on-demand).

    Returns the persisted `SyncLog` row.
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
        # purchases / sales sync is fetched lazily by the simulation runner.

        log.status = (
            SyncStatus.SUCCESS if log.items_failed == 0 else SyncStatus.PARTIAL_FAILURE
        )
    except Exception as exc:
        log.status = SyncStatus.FAILED
        log.errors.append({"item_id": None, "error_message": str(exc)})
    finally:
        log.completed_at = timezone.now()
        log.save()

    return log


def _last_successful_sync_at(scope: SyncScope) -> datetime | None:
    last = (
        SyncLog.objects.filter(
            scope__in=[scope, SyncScope.ALL], status=SyncStatus.SUCCESS
        )
        .order_by("-completed_at")
        .first()
    )
    return last.completed_at if last else None


# ─── Stubs ──────────────────────────────────────────────────────────────
# Each `_sync_*` helper will be filled in once the adapter implementations
# can return real data.  They stay simple here so the orchestration logic
# above is exercisable end-to-end (including the failure path).


def _sync_products(adapter: OdooAdapter, log: SyncLog, modified_since=None) -> None:
    """Pull products + suppliers from Odoo and upsert into the platform."""
    # Implementation placeholder — see CDC §5.4.1 for the expected pipeline.
    return


def _sync_stock(adapter: OdooAdapter, log: SyncLog) -> None:
    """Pull stock quantities + standard_price (PAMP) for synced SKUs."""
    return


def _sync_clients(adapter: OdooAdapter, log: SyncLog, modified_since=None) -> None:
    """Pull customers / prospects from Odoo (`res.partner` where customer_rank > 0)."""
    return
