from django.contrib import admin

from .models import Product, ProductSupplier


class ProductSupplierInline(admin.TabularInline):
    model = ProductSupplier
    extra = 0
    fields = (
        "supplier_name",
        "factory_code",
        "is_active",
        "po_base_price",
        "po_currency",
        "incoterm",
    )


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "sku_code",
        "name",
        "brand",
        "universe",
        "family",
        "range",
        "is_copper_indexed",
        "is_active",
    )
    list_filter = (
        "is_active",
        "is_copper_indexed",
        "supply_policy",
        "brand",
        "universe",
        "family",
    )
    search_fields = ("sku_code", "name", "parent_reference", "factory_code", "gtin")
    readonly_fields = ("created_at", "updated_at", "odoo_last_sync_at", "pamp_synced_at")
    inlines = [ProductSupplierInline]


@admin.register(ProductSupplier)
class ProductSupplierAdmin(admin.ModelAdmin):
    list_display = (
        "supplier_name",
        "product",
        "factory_code",
        "is_active",
        "po_base_price",
        "po_currency",
        "incoterm",
    )
    list_filter = ("is_active", "po_currency", "incoterm", "is_copper_indexed")
    search_fields = ("supplier_name", "product__sku_code")
    list_select_related = ("product",)
