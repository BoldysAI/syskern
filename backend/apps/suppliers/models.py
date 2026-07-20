"""Supplier master data (module Fournisseurs — écart CDC §11.3 assumé, cf. decisions.md).

The supplier is a first-class entity that carries **default** values used to
pre-fill a new SKU link. The per-link ``products.ProductSupplier`` keeps its own
pricing fields, which remain the source of truth for the pricing engine.
"""

from __future__ import annotations

from django.core.validators import RegexValidator
from django.db import models

from apps.core.models import BaseModel, Currency
from apps.products.models import Incoterm

SUPPLIER_CODE_VALIDATOR = RegexValidator(
    regex=r"^[A-Za-z0-9_-]+$",
    message="Le code fournisseur ne peut contenir que lettres, chiffres, tirets et underscores.",
)


class Supplier(BaseModel):
    """A purchase source, managed as a standalone entity (Épic FEEDBACK 1)."""

    name = models.CharField(max_length=255)
    code = models.CharField(max_length=64, unique=True, validators=[SUPPLIER_CODE_VALIDATOR])

    # ─── Defaults pre-filled when a SKU is linked to this supplier ────────────
    factory_code_default = models.CharField(max_length=16, blank=True, default="")
    currency_default = models.CharField(
        max_length=3, choices=Currency.choices, default=Currency.RMB
    )
    incoterm_default = models.CharField(
        max_length=4, choices=Incoterm.choices, blank=True, default=""
    )
    location = models.CharField(max_length=255, blank=True, default="")

    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "suppliers"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["name"], name="idx_suppliers_name"),
            models.Index(fields=["code"], name="idx_suppliers_code"),
            models.Index(fields=["is_active"], name="idx_suppliers_active"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class SupplierImportMapping(BaseModel):
    """A reusable Excel-to-platform column mapping for the PO import wizard.

    Named template so users can re-import files with a non-standard structure
    without re-mapping every time. ``supplier`` is an optional scoping hint (a
    file may be multi-supplier, so the mapping is not strictly tied to one).
    ``column_map`` maps a logical field to a **0-based column index** (so unnamed
    columns stay mappable): ``{"sku": 0, "po": 3, "supplier": 1, ...}``.
    ``header_row`` (1-based) records which row holds the header labels.
    """

    name = models.CharField(max_length=255)
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.CASCADE,
        related_name="import_mappings",
        null=True,
        blank=True,
    )
    # ``column_map`` maps a logical field to a 0-based column index (see
    # ``services_import``). ``header_row`` is 1-based (the file's header line).
    column_map = models.JSONField(default=dict)
    header_row = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "supplier_import_mappings"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["supplier"], name="idx_import_map_supplier"),
        ]

    def __str__(self) -> str:
        return self.name
