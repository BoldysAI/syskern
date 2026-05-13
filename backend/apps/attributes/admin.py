from django.contrib import admin

from .models import AttributeRegistry, ProductAttributeValue


@admin.register(AttributeRegistry)
class AttributeRegistryAdmin(admin.ModelAdmin):
    list_display = ("code", "category", "data_type", "is_required", "display_order")
    list_filter = ("category", "data_type", "is_required")
    search_fields = ("code",)
    ordering = ("display_order", "code")


@admin.register(ProductAttributeValue)
class ProductAttributeValueAdmin(admin.ModelAdmin):
    list_display = ("product", "attribute", "value")
    list_select_related = ("product", "attribute")
    search_fields = ("product__sku_code", "attribute__code")
