"""Product master data (CDC §3.2 → `products`, `product_suppliers`)."""

from __future__ import annotations

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models

from apps.core.models import BaseModel, Currency

SKU_VALIDATOR = RegexValidator(
    regex=r"^[A-Z0-9-]+$",
    message="SKU must contain only uppercase letters, digits and dashes.",
)


class BaseUnit(models.TextChoices):
    UNIT = "unit", "Unit"
    KM = "km", "Kilometre"
    M = "m", "Metre"


class SupplyPolicy(models.TextChoices):
    BUY = "buy", "Buy & stock"
    DROPSHIP = "dropship", "Dropship"
    MIXED = "mixed", "Mixed"


class MigrationSource(models.TextChoices):
    """Origin of a row, recorded by the initial migration (CDC §8.4)."""

    ODOO = "odoo", "Odoo sync"
    EXCEL_PRICING = "excel_pricing", "Excel — pricing"
    EXCEL_TECHNICAL = "excel_technical", "Excel — technical"
    DATABASE_INTERNAL = "database_internal", "Internal database"
    MANUAL = "manual", "Created manually"


class Product(BaseModel):
    """An SKU.  Linked 1:1 to an Odoo product via `odoo_id` when synced."""

    # ─── Odoo / external linkage ──────────────────────────────────────────
    odoo_id = models.IntegerField(unique=True, null=True, blank=True)
    odoo_v16_id = models.IntegerField(unique=True, null=True, blank=True)
    odoo_v19_id = models.IntegerField(unique=True, null=True, blank=True)
    sku_code = models.CharField(max_length=64, unique=True, validators=[SKU_VALIDATOR])
    item_code = models.CharField(max_length=128, blank=True, default="")
    parent_reference = models.CharField(max_length=64, blank=True, default="")
    factory_code = models.CharField(max_length=16, blank=True, default="")
    name = models.CharField(max_length=255)

    # ─── Hierarchy (CDC §4.2) ─────────────────────────────────────────────
    universe = models.CharField(max_length=128, blank=True, default="")
    family = models.CharField(max_length=128, blank=True, default="")
    range = models.CharField(max_length=128, blank=True, default="")
    sub_range = models.CharField(max_length=128, blank=True, default="")

    brand = models.CharField(max_length=128, blank=True, default="")

    # ─── Multilingual descriptions ────────────────────────────────────────
    description_marketing = models.JSONField(
        default=dict,
        blank=True,
        help_text='{"fr": "...", "en": "...", "es": "..."}',
    )
    description_technical = models.JSONField(default=dict, blank=True)

    # ─── External identifiers ─────────────────────────────────────────────
    hs_code = models.CharField(max_length=32, blank=True, default="")
    gtin = models.CharField(max_length=32, blank=True, default="")
    dop_number = models.CharField(max_length=64, blank=True, default="")

    # ─── Copper indexing ──────────────────────────────────────────────────
    is_copper_indexed = models.BooleanField(default=False)
    copper_weight_kg_per_unit = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    base_unit = models.CharField(max_length=8, choices=BaseUnit.choices, default=BaseUnit.UNIT)

    # ─── Packaging ────────────────────────────────────────────────────────
    primary_packaging_qty = models.IntegerField(null=True, blank=True)
    secondary_packaging_qty = models.IntegerField(null=True, blank=True)
    tertiary_packaging_qty = models.IntegerField(null=True, blank=True)
    pallet_qty = models.IntegerField(null=True, blank=True)
    unit_weight_kg = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)

    # ─── Supply ───────────────────────────────────────────────────────────
    supply_policy = models.CharField(
        max_length=16, choices=SupplyPolicy.choices, default=SupplyPolicy.BUY
    )
    is_stockable = models.BooleanField(default=True)

    # ─── Stock & PAMP (snapshots from Odoo) ───────────────────────────────
    stock_quantity = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    pamp_eur = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    pamp_synced_at = models.DateTimeField(null=True, blank=True)

    # ─── Metadata ─────────────────────────────────────────────────────────
    is_active = models.BooleanField(default=True)
    odoo_last_sync_at = models.DateTimeField(null=True, blank=True)

    # ─── Push-to-Odoo status (CDC §5.4.3) ─────────────────────────────────
    # Tracks the state of the *outgoing* push (platform → Odoo). The
    # `retry_failed_product_pushes` Celery task picks up rows in
    # `pending_odoo_sync` or `sync_failed` every hour and re-dispatches.
    ODOO_SYNC_STATUSES = [
        ("not_synced", "Not synced"),
        ("pending_odoo_sync", "Pending push to Odoo"),
        ("synced", "In sync with Odoo"),
        ("sync_failed", "Push failed"),
    ]
    odoo_sync_status = models.CharField(
        max_length=20,
        choices=ODOO_SYNC_STATUSES,
        default="not_synced",
        db_index=True,
    )
    odoo_sync_error = models.TextField(blank=True, default="")
    migration_source = models.CharField(
        max_length=32,
        choices=MigrationSource.choices,
        blank=True,
        default="",
    )

    # ─── Full-text search (CDC §4.1.1) ────────────────────────────────────
    # Postgres STORED generated column maintained at the DB level (see
    # migration 0004). Combines `french` (FR text) + `simple` (codes, EN/ES)
    # dictionaries with weighted setweight for multilingual search.
    search_vector = SearchVectorField(null=True, editable=False)

    class Meta:
        db_table = "products"
        ordering = ["sku_code"]
        indexes = [
            models.Index(fields=["sku_code"], name="idx_products_sku"),
            models.Index(fields=["odoo_id"], name="idx_products_odoo"),
            models.Index(fields=["odoo_v16_id"], name="idx_products_odoo_v16"),
            models.Index(fields=["odoo_v19_id"], name="idx_products_odoo_v19"),
            models.Index(
                fields=["universe", "family", "range", "sub_range"],
                name="idx_products_hierarchy",
            ),
            models.Index(fields=["factory_code"], name="idx_products_factory"),
            models.Index(fields=["is_active"], name="idx_products_active"),
            GinIndex(fields=["search_vector"], name="idx_products_search_vector"),
        ]

    @property
    def designation(self) -> str:
        """Human-readable label — prefers FR marketing copy over the short name."""
        marketing = self.description_marketing or {}
        fr = (marketing.get("fr") or "").strip()
        if fr:
            return fr
        return self.name or self.sku_code

    def __str__(self) -> str:
        return f"{self.sku_code} — {self.name}"


class Incoterm(models.TextChoices):
    """Incoterms 2020 supported by the platform (mirrors `incoterms` table)."""

    EXW = "EXW", "Ex Works"
    FCA = "FCA", "Free Carrier"
    FAS = "FAS", "Free Alongside Ship"
    FOB = "FOB", "Free On Board"
    CFR = "CFR", "Cost and Freight"
    CIF = "CIF", "Cost, Insurance and Freight"
    CPT = "CPT", "Carriage Paid To"
    CIP = "CIP", "Carriage and Insurance Paid To"
    DAP = "DAP", "Delivered At Place"
    DPU = "DPU", "Delivered at Place Unloaded"
    DDP = "DDP", "Delivered Duty Paid"


class ProductSupplier(BaseModel):
    """A purchase source for a product (CDC §3.2 → `product_suppliers`)."""

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="suppliers",
    )
    supplier_name = models.CharField(max_length=255)
    factory_code = models.CharField(max_length=16, blank=True, default="")
    is_active = models.BooleanField(default=False)

    # Pricing parameters pre-filled into a simulation when this source is used.
    po_base_price = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    po_currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.RMB)
    is_copper_indexed = models.BooleanField(default=False)
    copper_base_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    incoterm = models.CharField(max_length=4, choices=Incoterm.choices, blank=True, default="")
    incoterm_location = models.CharField(max_length=128, blank=True, default="")

    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "product_suppliers"
        ordering = ["product_id", "-is_active", "supplier_name"]
        indexes = [
            models.Index(fields=["product"], name="idx_prod_suppliers_product"),
        ]
        constraints = [
            # CDC §3.2: at most one active source per product.  Implemented as
            # a partial unique index on (product) WHERE is_active = TRUE.
            models.UniqueConstraint(
                fields=["product"],
                condition=models.Q(is_active=True),
                name="one_active_supplier_per_product",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.supplier_name} ({self.product_id})"
