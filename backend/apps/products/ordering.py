"""Catalog list ordering — NULLS LAST + dynamic attribute columns (CDC §4.1.1)."""

from __future__ import annotations

from django.db.models import BooleanField, CharField, F, FloatField, OuterRef, Subquery
from django.db.models.expressions import RawSQL
from rest_framework.filters import OrderingFilter

from apps.attributes.models import AttributeDataType, AttributeRegistry

from .models import Product, ProductSupplier

_ATTR_ORDER_PREFIX = "attr_"


def attribute_ordering_field(code: str) -> str:
    """Query param fragment for sorting by a dynamic attribute (``ordering=attr_<code>``)."""
    return f"{_ATTR_ORDER_PREFIX}{code}"


class ProductOrderingFilter(OrderingFilter):
    """Catalog ordering with NULLS LAST on nullable numerics and dynamic attributes.

    Wizard-created products have no Odoo PAMP yet (`pamp_eur IS NULL`). Postgres
    sorts NULLs first on `DESC` by default, which incorrectly surfaces them at the
    top of a « highest PAMP first » sort.

    Dynamic attributes use ``ordering=attr_<code>`` (validated against the registry).
    """

    _NULLS_LAST_FIELDS = frozenset({"pamp_eur", "stock_quantity"})

    def remove_invalid_fields(self, queryset, fields, view, request):
        allowed = {item[0] for item in self.get_valid_fields(queryset, view, request)}
        cleaned: list[str] = []
        for term in fields:
            name = term.lstrip("-")
            if name in allowed:
                cleaned.append(term)
                continue
            if name.startswith(_ATTR_ORDER_PREFIX):
                code = name[len(_ATTR_ORDER_PREFIX) :]
                if AttributeRegistry.objects.filter(code=code).exists():
                    cleaned.append(term)
        return cleaned

    def filter_queryset(self, request, queryset, view):
        ordering = self.get_ordering(request, queryset, view)
        if not ordering:
            return queryset

        qs = queryset
        parts: list[F | str] = []
        attr_idx = 0

        for raw in ordering:
            desc = raw.startswith("-")
            name = raw.lstrip("-")

            if name.startswith(_ATTR_ORDER_PREFIX):
                code = name[len(_ATTR_ORDER_PREFIX) :]
                alias = f"_attr_sort_{attr_idx}"
                attr_idx += 1
                qs = _annotate_attribute_sort(qs, code, alias)
                col = F(alias)
                parts.append(col.desc(nulls_last=True) if desc else col.asc(nulls_last=True))
                continue

            if name == "active_supplier":
                qs = qs.annotate(
                    _active_supplier_sort=Subquery(
                        ProductSupplier.objects.filter(
                            product=OuterRef("pk"),
                            is_active=True,
                        ).values("supplier_name")[:1],
                        output_field=CharField(),
                    )
                )
                col = F("_active_supplier_sort")
                parts.append(col.desc(nulls_last=True) if desc else col.asc(nulls_last=True))
                continue

            if name == "completeness_pct":
                from .services.completeness import completeness_sort_expression

                qs = qs.annotate(_completeness_sort=completeness_sort_expression())
                col = F("_completeness_sort")
                parts.append(col.desc(nulls_last=True) if desc else col.asc(nulls_last=True))
                continue

            if name in self._NULLS_LAST_FIELDS:
                col = F(name)
                parts.append(col.desc(nulls_last=True) if desc else col.asc(nulls_last=True))
            else:
                parts.append(raw)

        return qs.order_by(*parts)


def _annotate_attribute_sort(queryset, code: str, alias: str):
    """Annotate queryset with a sortable scalar for one dynamic attribute."""
    try:
        attr = AttributeRegistry.objects.get(code=code)
    except AttributeRegistry.DoesNotExist:
        return queryset

    product_table = Product._meta.db_table
    base_from = f"""
        FROM product_attribute_values pav
        INNER JOIN attribute_registry ar ON ar.id = pav.attribute_id
        WHERE pav.product_id = "{product_table}".id AND ar.code = %s
        LIMIT 1
    """

    if attr.data_type == AttributeDataType.NUMBER:
        sql = f"""
            (SELECT CASE
                WHEN jsonb_typeof(pav.value) IN ('number', 'string')
                    AND (pav.value #>> '{{}}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                THEN (pav.value #>> '{{}}')::double precision
                ELSE NULL
            END
            {base_from})
        """
        output = FloatField()
    elif attr.data_type == AttributeDataType.BOOLEAN:
        sql = f"""
            (SELECT CASE
                WHEN jsonb_typeof(pav.value) = 'boolean'
                THEN (pav.value #>> '{{}}')::boolean
                ELSE NULL
            END
            {base_from})
        """
        output = BooleanField()
    elif attr.data_type == AttributeDataType.MULTISELECT:
        sql = f"(SELECT pav.value::text {base_from})"
        output = CharField()
    else:
        sql = f"(SELECT pav.value #>> '{{}}' {base_from})"
        output = CharField()

    return queryset.annotate(**{alias: RawSQL(sql, [code], output_field=output)})
