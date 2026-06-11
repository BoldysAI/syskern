from django.contrib import admin

from .models import Incoterm, MarketParameter, TransportMode


@admin.register(TransportMode)
class TransportModeAdmin(admin.ModelAdmin):
    list_display = ("code", "category", "default_pallet_capacity", "is_active")
    list_filter = ("category", "is_active")
    search_fields = ("code",)


@admin.register(Incoterm)
class IncotermAdmin(admin.ModelAdmin):
    list_display = ("code", "display_order", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code",)
    ordering = ("display_order", "code")


@admin.register(MarketParameter)
class MarketParameterAdmin(admin.ModelAdmin):
    list_display = (
        "parameter_type",
        "valid_from",
        "valid_to",
        "copper_market",
        "copper_price",
        "copper_currency",
        "fx_from_currency",
        "fx_to_currency",
        "fx_rate",
        "is_active",
    )
    list_filter = ("parameter_type", "copper_market", "is_active")
    date_hierarchy = "valid_from"
