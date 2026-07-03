"""Celery tasks for the i18n app (CDC §10.4.3).

Only the cache-purge cron lives here; ad-hoc translation is synchronous
(``TranslateView``) and multi-product bulk translation lives in
``apps.products.tasks``.
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger("apps.i18n.tasks")


@shared_task(name="i18n.purge_translation_cache")
def purge_translation_cache() -> dict:
    """Delete expired translation-cache rows. Registered as a daily Beat task."""
    from .models import TranslationCache

    deleted, _ = TranslationCache.objects.filter(expires_at__lt=timezone.now()).delete()
    if deleted:
        logger.info("purge_translation_cache deleted %d expired row(s)", deleted)
    return {"deleted": deleted}
