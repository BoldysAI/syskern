"""Dynamic attribute registry + per-product values.

Cf. CDC §3.2 — pattern EAV with JSONB values.  Clients can add new attributes
through the UI without a schema migration.
"""
from __future__ import annotations

from django.contrib.postgres.indexes import GinIndex
from django.core.validators import RegexValidator
from django.db import models

from apps.core.models import BaseModel


class AttributeCategory(models.TextChoices):
    STRUCTURAL = "structural", "Structural"
    TECHNICAL = "technical", "Technical"
    MARKETING = "marketing", "Marketing"
    COMMERCIAL = "commercial", "Commercial"
    LOGISTIC = "logistic", "Logistic"


class AttributeDataType(models.TextChoices):
    TEXT = "text", "Text"
    NUMBER = "number", "Number"
    BOOLEAN = "boolean", "Boolean"
    DATE = "date", "Date"
    SELECT = "select", "Single choice"
    MULTISELECT = "multiselect", "Multiple choice"


CODE_VALIDATOR = RegexValidator(
    regex=r"^[a-z][a-z0-9_]*$",
    message="Attribute code must be snake_case (lowercase, digits, underscores).",
)


class AttributeRegistry(BaseModel):
    """Definition of a dynamic attribute.

    The `code` field is immutable after creation (CDC §4.5).  The `data_type`
    drives how `ProductAttributeValue.value` is interpreted.
    """

    code = models.TextField(unique=True, validators=[CODE_VALIDATOR])
    label = models.JSONField(help_text='Multilingual {"fr": "...", "en": "...", "es": "..."}')
    category = models.CharField(max_length=20, choices=AttributeCategory.choices)
    data_type = models.CharField(max_length=20, choices=AttributeDataType.choices)
    options = models.JSONField(
        blank=True,
        null=True,
        help_text='For select / multiselect: [{"value": "...", "label": {...}}]',
    )
    unit = models.CharField(max_length=32, blank=True, default="")
    is_required = models.BooleanField(default=False)
    is_searchable = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)

    class Meta:
        db_table = "attribute_registry"
        ordering = ["display_order", "code"]
        indexes = [
            models.Index(fields=["category"], name="idx_attr_registry_category"),
        ]

    def __str__(self) -> str:
        return self.code


class ProductAttributeValue(BaseModel):
    """Value of an attribute for a product (one row per product × attribute)."""

    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="attribute_values",
    )
    attribute = models.ForeignKey(
        AttributeRegistry,
        on_delete=models.CASCADE,
        related_name="values",
    )
    # JSONField holds typed values per `attribute.data_type`.  Examples:
    #   text/number/boolean/date  → scalar
    #   select                     → string
    #   multiselect                → array of strings
    value = models.JSONField(blank=True, null=True)

    class Meta:
        db_table = "product_attribute_values"
        constraints = [
            models.UniqueConstraint(
                fields=["product", "attribute"],
                name="unique_product_attribute",
            ),
        ]
        indexes = [
            models.Index(fields=["product"], name="idx_pav_product"),
            models.Index(fields=["attribute"], name="idx_pav_attribute"),
            GinIndex(fields=["value"], name="idx_pav_value_gin"),
        ]

    def __str__(self) -> str:
        return f"{self.product_id} · {self.attribute_id}"
