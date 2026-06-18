"""Shared model primitives used by every app."""

from __future__ import annotations

import uuid

from django.db import models


class UUIDPrimaryKeyModel(models.Model):
    """Replaces the default BigAutoField with a uuid4 primary key.

    Mirrors the SQL schemas in the CDC where every table declares
    `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimestampedModel(models.Model):
    """Adds `created_at` / `updated_at` columns auto-managed by Django."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BaseModel(UUIDPrimaryKeyModel, TimestampedModel):
    """Convenience base: UUID PK + timestamps."""

    class Meta:
        abstract = True


# ─── Choices used across multiple apps ───────────────────────────────────────


class Currency(models.TextChoices):
    EUR = "EUR", "Euro"
    USD = "USD", "US Dollar"
    RMB = "RMB", "Renminbi"


class Language(models.TextChoices):
    FR = "fr", "Français"
    EN = "en", "English"
    ES = "es", "Español"
