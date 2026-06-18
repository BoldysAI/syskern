"""Catalog list ordering — NULLS LAST for nullable numerics (CDC §4.1.1)."""

from __future__ import annotations

from django.db.models import F
from rest_framework.filters import OrderingFilter


class ProductOrderingFilter(OrderingFilter):
    """Apply `NULLS LAST` on nullable numeric columns (PAMP, stock).

    Wizard-created products have no Odoo PAMP yet (`pamp_eur IS NULL`). Postgres
    sorts NULLs first on `DESC` by default, which incorrectly surfaces them at the
    top of a « highest PAMP first » sort.
    """

    _NULLS_LAST_FIELDS = frozenset({"pamp_eur", "stock_quantity"})

    def filter_queryset(self, request, queryset, view):
        ordering = self.get_ordering(request, queryset, view)
        if not ordering:
            return queryset

        parts: list[F | str] = []
        for raw in ordering:
            desc = raw.startswith("-")
            name = raw.lstrip("-")
            if name in self._NULLS_LAST_FIELDS:
                col = F(name)
                parts.append(col.desc(nulls_last=True) if desc else col.asc(nulls_last=True))
            else:
                parts.append(raw)
        return queryset.order_by(*parts)
