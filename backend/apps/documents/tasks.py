"""Celery tasks for the document library (CDC §7.4).

Daily purge of soft-deleted documents: 30 days after a soft-delete, the file is
removed from storage and the row hard-deleted. Scheduled via Celery Beat (a data
migration registers it at 04:00 UTC — after the 03:00 Odoo sync).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.core.files.storage import default_storage
from django.utils import timezone

from .models import DocumentLibrary

logger = logging.getLogger("apps.documents.tasks")

RETENTION_DAYS = 30


@shared_task(name="documents.purge_deleted_documents")
def purge_deleted_documents() -> dict:
    """Hard-delete documents soft-deleted more than RETENTION_DAYS ago."""
    cutoff = timezone.now() - timedelta(days=RETENTION_DAYS)
    stale = DocumentLibrary.objects.filter(is_active=False, deleted_at__lt=cutoff)

    purged = 0
    files_removed = 0
    for doc in stale.iterator():
        if doc.file_url and default_storage.exists(doc.file_url):
            try:
                default_storage.delete(doc.file_url)
                files_removed += 1
            except OSError as exc:  # storage hiccup — keep going, retry next day
                logger.warning("Failed to delete file %s for doc %s: %s", doc.file_url, doc.id, exc)
                continue
        doc.delete()
        purged += 1

    logger.info("Document purge: %d row(s) deleted, %d file(s) removed", purged, files_removed)
    return {"purged": purged, "files_removed": files_removed}
