from __future__ import annotations

from django.contrib import admin

from .models import Supplier


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "code",
        "currency_default",
        "incoterm_default",
        "factory_code_default",
        "location",
        "is_active",
    )
    list_filter = ("is_active", "currency_default", "incoterm_default")
    search_fields = ("name", "code", "location")
    readonly_fields = ("created_at", "updated_at")
