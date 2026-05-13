"""Clients — mix of Odoo-synced customers and locally-created prospects.

Cf. CDC §3.2 → `clients`.
"""
from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel, Currency, Language
from apps.products.models import Incoterm


class Client(BaseModel):
    odoo_id = models.IntegerField(unique=True, null=True, blank=True)
    is_prospect = models.BooleanField(default=False)

    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=64, blank=True, default="")

    address_street = models.CharField(max_length=255, blank=True, default="")
    address_city = models.CharField(max_length=128, blank=True, default="")
    address_zip = models.CharField(max_length=32, blank=True, default="")
    address_country = models.CharField(max_length=64, blank=True, default="")

    # Commercial preferences
    preferred_currency = models.CharField(
        max_length=3, choices=Currency.choices, blank=True, default=""
    )
    preferred_incoterm = models.CharField(
        max_length=4, choices=Incoterm.choices, blank=True, default=""
    )
    preferred_language = models.CharField(
        max_length=2, choices=Language.choices, default=Language.FR
    )
    segment = models.CharField(max_length=64, blank=True, default="")

    notes = models.TextField(blank=True, default="")
    odoo_last_sync_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "clients"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["odoo_id"], name="idx_clients_odoo"),
            models.Index(fields=["name"], name="idx_clients_name"),
            models.Index(fields=["is_prospect"], name="idx_clients_prospect"),
        ]

    def __str__(self) -> str:
        return self.name
