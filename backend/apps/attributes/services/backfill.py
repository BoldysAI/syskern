"""Backfill default attribute values onto existing products (CDC §4.5)."""

from __future__ import annotations

import uuid
from typing import TypedDict

from apps.products.models import Product

from ..models import AttributeRegistry, ProductAttributeValue

_BATCH_SIZE = 500


class BackfillReport(TypedDict):
    attribute_id: str
    created: int
    skipped: int


def apply_registry_defaults_to_product(product: Product) -> int:
    """Create PAV rows for every registry default missing on *product*.

    Used when a product is created outside the attribute backfill path (quarantine
    resolution, API create) so unset dynamic attributes inherit ``default_value``.
    Never overwrites an existing PAV row.
    """
    from ..serializers import is_attribute_value_empty

    existing_attr_ids = set(
        ProductAttributeValue.objects.filter(product=product).values_list(
            "attribute_id", flat=True
        )
    )
    batch: list[ProductAttributeValue] = []
    for attr in AttributeRegistry.objects.exclude(default_value__isnull=True):
        if is_attribute_value_empty(attr.default_value):
            continue
        if attr.pk in existing_attr_ids:
            continue
        batch.append(
            ProductAttributeValue(
                product=product,
                attribute=attr,
                value=attr.default_value,
            )
        )
    if batch:
        ProductAttributeValue.objects.bulk_create(batch, ignore_conflicts=True)
    return len(batch)


def backfill_attribute_defaults(attribute_id: uuid.UUID) -> BackfillReport:
    """Create PAV rows for products missing a value when a default is defined.

  Only runs on attribute creation — never overwrites existing values.
  """
    attribute = AttributeRegistry.objects.get(pk=attribute_id)
    if attribute.default_value is None:
        return BackfillReport(attribute_id=str(attribute_id), created=0, skipped=0)

    existing_product_ids = set(
        ProductAttributeValue.objects.filter(attribute=attribute).values_list(
            "product_id", flat=True
        )
    )

    batch: list[ProductAttributeValue] = []
    created = 0
    skipped = len(existing_product_ids)

    for product_id in Product.objects.values_list("pk", flat=True).iterator():
        if product_id in existing_product_ids:
            continue
        batch.append(
            ProductAttributeValue(
                product_id=product_id,
                attribute=attribute,
                value=attribute.default_value,
            )
        )
        if len(batch) >= _BATCH_SIZE:
            ProductAttributeValue.objects.bulk_create(batch, ignore_conflicts=True)
            created += len(batch)
            batch = []

    if batch:
        ProductAttributeValue.objects.bulk_create(batch, ignore_conflicts=True)
        created += len(batch)

    return BackfillReport(
        attribute_id=str(attribute_id),
        created=created,
        skipped=skipped,
    )
