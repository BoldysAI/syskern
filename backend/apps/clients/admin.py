from django.contrib import admin

from .models import Client


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("name", "is_prospect", "email", "preferred_currency", "preferred_language", "segment")
    list_filter = ("is_prospect", "preferred_currency", "preferred_language", "segment")
    search_fields = ("name", "email", "address_city", "address_country")
