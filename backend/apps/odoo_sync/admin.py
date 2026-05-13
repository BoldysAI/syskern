from django.contrib import admin

from .models import SyncLog


@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = (
        "started_at",
        "sync_type",
        "scope",
        "status",
        "items_created",
        "items_updated",
        "items_failed",
        "odoo_api_version",
    )
    list_filter = ("sync_type", "scope", "status", "odoo_api_version")
    date_hierarchy = "started_at"
    readonly_fields = (
        "started_at",
        "completed_at",
        "items_created",
        "items_updated",
        "items_failed",
        "errors",
    )
