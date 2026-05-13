from django.contrib import admin

from .models import Offer, OfferLine


class OfferLineInline(admin.TabularInline):
    model = OfferLine
    extra = 0
    fields = ("product", "final_price", "discount_pct", "quantity", "display_order")
    show_change_link = True


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = (
        "label",
        "offer_type",
        "status",
        "currency",
        "incoterm",
        "valid_to",
        "version_number",
        "created_at",
    )
    list_filter = ("offer_type", "status", "currency", "language", "export_format")
    search_fields = ("label", "project_name")
    readonly_fields = ("sent_at", "won_at", "lost_at", "created_at", "updated_at")
    inlines = [OfferLineInline]


@admin.register(OfferLine)
class OfferLineAdmin(admin.ModelAdmin):
    list_display = ("offer", "product", "final_price", "discount_pct", "quantity")
    search_fields = ("offer__label", "product__sku_code")
    list_select_related = ("offer", "product")
