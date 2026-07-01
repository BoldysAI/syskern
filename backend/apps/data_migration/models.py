"""Quarantine table for rows the one-shot migration could not match.

Cf. CDC §8.7.  The frontend exposes the quarantine but cannot auto-reinject
rows — Olivier resolves each row manually (mark resolved / create the
product / ignore).
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class UnmatchedReason(models.TextChoices):
    NO_SKU = "no_sku", "No SKU column / value"
    NO_MATCH = "no_match", "Could not match an existing product"
    DUPLICATE_MATCH = "duplicate_match", "Multiple candidate matches"
    INVALID_FORMAT = "invalid_format", "Invalid format"
    MISSING_REQUIRED_FIELD = "missing_required_field", "Missing required field"


class ResolutionAction(models.TextChoices):
    """What the user did to resolve a quarantine row (CDC §8.7 arbitrage)."""

    IGNORE = "ignore", "Ne rien faire (ignorer)"
    CREATE = "create", "Produit créé"
    DELETE = "delete", "Supprimer (doublon / rebut)"


class MigrationUnmatched(BaseModel):
    source_file = models.CharField(max_length=255)
    source_row_number = models.IntegerField(null=True, blank=True)
    raw_data = models.JSONField()
    reason = models.CharField(max_length=32, choices=UnmatchedReason.choices)

    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.EmailField(blank=True, default="")
    resolution_notes = models.TextField(blank=True, default="")
    # Which arbitrage the user chose (ignore / create the product / discard).
    resolution_action = models.CharField(
        max_length=16, choices=ResolutionAction.choices, blank=True, default=""
    )

    class Meta:
        db_table = "migration_unmatched"
        ordering = ["source_file", "source_row_number"]
        indexes = [
            models.Index(
                fields=["source_file", "resolved_at"],
                name="idx_migration_unmatched_src",
            ),
            models.Index(fields=["reason"], name="idx_migration_unmatched_rsn"),
        ]

    def __str__(self) -> str:
        return f"{self.source_file}:{self.source_row_number} ({self.reason})"
