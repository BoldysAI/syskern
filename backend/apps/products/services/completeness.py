"""Attribute completeness across the catalog (PIM — FEEDBACK 1).

Per-field fill rate over the **active** catalog, for both core columns and
dynamic registry attributes, plus the global average. Powers the detail table
on ``/settings/attributes`` and the dashboard completeness widget.
"""

from __future__ import annotations

from typing import Any

from django.db.models import Count, Q

from apps.attributes.models import AttributeRegistry, ProductAttributeValue
from apps.products.models import Product

# Core columns worth tracking for enrichment: (field, FR label, kind, group).
# Excludes always-required fields (``sku_code``/``name``), system/computed
# columns (Odoo ids, PAMP, stock, sync status, search vector) and booleans
# (which always carry a value, so completeness is meaningless).
_CORE_FIELDS: list[tuple[str, str, str, str]] = [
    ("item_code", "Code article", "char", "identification"),
    ("parent_reference", "Référence parent", "char", "identification"),
    ("factory_code", "Code usine", "char", "identification"),
    ("brand", "Marque", "char", "identification"),
    ("universe", "Univers", "char", "hierarchy"),
    ("family", "Famille", "char", "hierarchy"),
    ("range", "Gamme", "char", "hierarchy"),
    ("sub_range", "Sous-gamme", "char", "hierarchy"),
    ("description_marketing", "Description marketing (FR)", "json_fr", "marketing"),
    ("description_technical", "Description technique (FR)", "json_fr", "technical"),
    ("hs_code", "Code HS", "char", "identification"),
    ("gtin", "GTIN", "char", "identification"),
    ("dop_number", "Numéro DoP", "char", "identification"),
    ("uom", "Unité réelle (Odoo)", "char", "logistic"),
    ("unit_weight_kg", "Poids unitaire", "num", "technical"),
    ("copper_weight_kg_per_unit", "Poids cuivre / unité", "num", "technical"),
    ("primary_packaging_qty", "Colisage primaire", "num", "logistic"),
    ("secondary_packaging_qty", "Colisage secondaire", "num", "logistic"),
    ("tertiary_packaging_qty", "Colisage tertiaire", "num", "logistic"),
    ("pallet_qty", "Qté palette", "num", "logistic"),
]


def _localize(label: Any) -> str:
    """FR label from a multilingual JSON field, with graceful fallback."""
    if isinstance(label, dict):
        return label.get("fr") or label.get("en") or next(iter(label.values()), "")
    return str(label or "")


def _row(key: str, label: str, kind: str, group: str, filled: int, total: int) -> dict[str, Any]:
    filled = int(filled or 0)
    return {
        "key": key,
        "label": label,
        "kind": kind,
        "group": group,
        "filled": filled,
        "missing": total - filled,
        "percent": round(100 * filled / total, 1) if total else 0.0,
    }


def build_attribute_completeness() -> dict[str, Any]:
    """Return ``{total_products, average_percent, fields[]}`` sorted worst-first.

    Each ``fields`` entry: ``{key, label, kind, group, filled, missing, percent}``.
    ``kind`` is ``core`` or ``attribute``; the frontend links ``attr:<id>`` keys
    back to the registry.
    """
    products = Product.objects.filter(is_active=True)
    total = products.count()
    if total == 0:
        return {"total_products": 0, "average_percent": 0.0, "fields": []}

    # One pass over products: conditional Count per core field.
    aggregates: dict[str, Any] = {}
    for field, _label, kind, _group in _CORE_FIELDS:
        if kind == "char":
            aggregates[field] = Count("id", filter=~Q(**{field: ""}))
        elif kind == "num":
            aggregates[field] = Count("id", filter=Q(**{f"{field}__isnull": False}))
        elif kind == "json_fr":
            aggregates[field] = Count(
                "id",
                filter=Q(**{f"{field}__fr__isnull": False}) & ~Q(**{f"{field}__fr": ""}),
            )
    agg = products.aggregate(**aggregates)

    fields: list[dict[str, Any]] = [
        _row(field, label, "core", group, agg.get(field, 0), total)
        for field, label, _kind, group in _CORE_FIELDS
    ]

    # Dynamic attributes — one grouped query over non-empty values.
    pav_counts = (
        ProductAttributeValue.objects.filter(product__is_active=True)
        .exclude(value=None)
        .exclude(value="")
        .exclude(value=[])
        .values("attribute")
        .annotate(n=Count("product", distinct=True))
    )
    counts_by_attr = {row["attribute"]: row["n"] for row in pav_counts}
    for attr in AttributeRegistry.objects.all().order_by("display_order", "code"):
        fields.append(
            _row(
                f"attr:{attr.id}",
                _localize(attr.label),
                "attribute",
                attr.category,
                counts_by_attr.get(attr.id, 0),
                total,
            )
        )

    fields.sort(key=lambda f: (f["percent"], f["label"]))
    average = round(sum(f["percent"] for f in fields) / len(fields), 1) if fields else 0.0
    return {"total_products": total, "average_percent": average, "fields": fields}


def _core_field_filled(product: Product, field: str, kind: str) -> bool:
    val = getattr(product, field, None)
    if kind == "char":
        return bool(val)
    if kind == "num":
        return val is not None
    if kind == "json_fr":
        return bool((val or {}).get("fr"))
    return bool(val)


def build_product_completeness_map(products: list[Product]) -> dict[str, float]:
    """Per-product fill rate over the **same** field set as the catalog widget.

    Returns ``{product_id: percent}`` for the given products (a catalog page).
    Two queries total — registry count + one grouped PAV count — so it stays
    cheap for a paginated list. Powers the optional "Complétude" catalog column.
    """
    products = list(products)
    if not products:
        return {}
    registry_count = AttributeRegistry.objects.count()
    total = len(_CORE_FIELDS) + registry_count
    if total == 0:
        return {str(p.id): 0.0 for p in products}

    ids = [p.id for p in products]
    rows = (
        ProductAttributeValue.objects.filter(product_id__in=ids)
        .exclude(value=None)
        .exclude(value="")
        .exclude(value=[])
        .values("product_id")
        .annotate(n=Count("id"))
    )
    attr_filled = {row["product_id"]: row["n"] for row in rows}

    result: dict[str, float] = {}
    for product in products:
        core = sum(
            1
            for field, _label, kind, _group in _CORE_FIELDS
            if _core_field_filled(product, field, kind)
        )
        attrs = min(attr_filled.get(product.id, 0), registry_count)
        result[str(product.id)] = round(100 * (core + attrs) / total, 1)
    return result
