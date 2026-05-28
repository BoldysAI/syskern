"""Celery tasks for Odoo synchronisation."""
from __future__ import annotations

from celery import shared_task

from .models import SyncScope, SyncType
from .serializers import SyncLogSerializer
from .services.runner import sync


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
