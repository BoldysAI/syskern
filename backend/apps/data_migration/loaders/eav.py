"""Shared EAV write helpers for Excel loaders (CDC §3.2 — attribute_registry).

Full-fidelity mapping: any product attribute that isn't a fixed ``products``
column lands in the EAV registry, so nothing the client stores in Odoo/Excel
is lost. Loaders declare ``EAVDef``s, ``ensure_attributes`` registers them once
(``pre_run``), and ``set_value`` writes one value per product × attribute.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.attributes.models import AttributeRegistry, ProductAttributeValue
from apps.products.models import Product


@dataclass(frozen=True)
class EAVDef:
    code: str
    label_fr: str
    label_en: str
    data_type: str
    category: str
    unit: str = ""


def ensure_attributes(defs: list[EAVDef]) -> dict[str, AttributeRegistry]:
    """``get_or_create`` each registry entry (idempotent). Returns {code: obj}."""
    registry: dict[str, AttributeRegistry] = {}
    for d in defs:
        obj, _ = AttributeRegistry.objects.get_or_create(
            code=d.code,
            defaults={
                "label": {"fr": d.label_fr, "en": d.label_en},
                "data_type": d.data_type,
                "category": d.category,
                "unit": d.unit,
                "is_required": False,
                "is_searchable": True,
            },
        )
        registry[d.code] = obj
    return registry


def set_value(product: Product, attr: AttributeRegistry | None, value: object) -> bool:
    """Persist ``value`` for ``product × attr`` (JSONB). Skips null/empty and
    unsaved products. Returns ``True`` when a value was written."""
    if attr is None or product.pk is None:
        return False
    if value is None or (isinstance(value, str) and not value.strip()):
        return False
    ProductAttributeValue.objects.update_or_create(
        product=product, attribute=attr, defaults={"value": value}
    )
    return True
