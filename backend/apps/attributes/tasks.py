"""Celery tasks for the attributes app."""

from __future__ import annotations

from celery import shared_task

from .services.backfill import BackfillReport, backfill_attribute_defaults


@shared_task(name="attributes.backfill_attribute_defaults_task")
def backfill_attribute_defaults_task(attribute_pk: str) -> BackfillReport:
    """Apply ``default_value`` to all products missing a PAV row."""
    from uuid import UUID

    return backfill_attribute_defaults(UUID(attribute_pk))
