from __future__ import annotations

from django.apps import AppConfig


class SuppliersConfig(AppConfig):
    name = "apps.suppliers"
    verbose_name = "Suppliers (Fournisseurs)"
    default_auto_field = "django.db.models.BigAutoField"
