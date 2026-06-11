"""Idempotent seed of the minimal attribute registry (CDC §3.3).

The helper takes the model class so it runs from both a data migration
(``apps.get_model``) and tests.  ``get_or_create`` keyed on ``code`` makes
re-runs a no-op.

Note: ``hs_code`` / ``gtin`` / ``dop_number`` / ``unit_weight_kg`` /
``pallet_qty`` also exist as first-class columns on ``products.Product``.
They are registered here as dynamic attributes as required by the spec; the
overlap is documented in ``docs/agent/decisions.md``.
"""

from __future__ import annotations

from typing import Any

MINIMAL_ATTRIBUTES: list[dict[str, Any]] = [
    {
        "code": "hs_code",
        "label": {"fr": "Code SH", "en": "HS code", "es": "Código SA"},
        "category": "structural",
        "data_type": "text",
        "unit": "",
    },
    {
        "code": "gtin",
        "label": {"fr": "GTIN", "en": "GTIN", "es": "GTIN"},
        "category": "structural",
        "data_type": "text",
        "unit": "",
    },
    {
        "code": "dop_number",
        "label": {"fr": "Numéro DoP", "en": "DoP number", "es": "Número DdP"},
        "category": "structural",
        "data_type": "text",
        "unit": "",
    },
    {
        "code": "unit_weight_kg",
        "label": {"fr": "Poids unitaire", "en": "Unit weight", "es": "Peso unitario"},
        "category": "logistic",
        "data_type": "number",
        "unit": "kg",
    },
    {
        "code": "pallet_qty",
        "label": {
            "fr": "Quantité par palette",
            "en": "Quantity per pallet",
            "es": "Cantidad por palé",
        },
        "category": "logistic",
        "data_type": "number",
        "unit": "",
    },
]


def seed_minimal_attributes(attribute_model: Any) -> None:
    for order, entry in enumerate(MINIMAL_ATTRIBUTES):
        attribute_model.objects.get_or_create(
            code=entry["code"],
            defaults={
                "label": entry["label"],
                "category": entry["category"],
                "data_type": entry["data_type"],
                "unit": entry["unit"],
                "is_required": False,
                "is_searchable": True,
                "display_order": order,
            },
        )
