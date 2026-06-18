"""Odoo synchronisation logs (CDC §5.4)."""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class SyncType(models.TextChoices):
    AUTO_DAILY = "auto_daily", "Daily cron"
    MANUAL = "manual", "Manual trigger"
    ON_DEMAND = "on_demand", "On-demand (product create/update)"


class SyncScope(models.TextChoices):
    ALL = "all", "All"
    PRODUCTS = "products", "Products"
    STOCK = "stock", "Stock"
    CLIENTS = "clients", "Clients"
    SUPPLIERS = "suppliers", "Suppliers"
    PURCHASES_SALES = "purchases_sales", "Pending purchases & sales"


class SyncStatus(models.TextChoices):
    RUNNING = "running", "Running"
    SUCCESS = "success", "Success"
    PARTIAL_FAILURE = "partial_failure", "Partial failure"
    FAILED = "failed", "Failed"


class SyncLog(BaseModel):
    sync_type = models.CharField(max_length=16, choices=SyncType.choices)
    scope = models.CharField(max_length=32, choices=SyncScope.choices)
    odoo_api_version = models.CharField(
        max_length=4,
        help_text="'v16' or 'v19' — captured for audit when adapters swap.",
    )

    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=SyncStatus.choices)

    items_created = models.IntegerField(default=0)
    items_updated = models.IntegerField(default=0)
    items_failed = models.IntegerField(default=0)

    errors = models.JSONField(
        default=list,
        blank=True,
        help_text='[{"item_id": "...", "error_message": "..."}, ...]',
    )
    triggered_by = models.CharField(
        max_length=32,
        blank=True,
        default="",
        help_text="'system' or 'manual'",
    )

    class Meta:
        db_table = "sync_logs"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["sync_type", "-started_at"], name="idx_sync_type_date"),
            models.Index(fields=["status"], name="idx_sync_status"),
        ]

    def __str__(self) -> str:
        return f"{self.sync_type} {self.scope} @ {self.started_at:%Y-%m-%d %H:%M} [{self.status}]"
