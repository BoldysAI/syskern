"""Filters for the Fournisseurs module (Épic FEEDBACK 1)."""

from __future__ import annotations

import django_filters as filters

from .models import Supplier


class SupplierFilter(filters.FilterSet):
    name = filters.CharFilter(field_name="name", lookup_expr="icontains")
    has_skus = filters.BooleanFilter(method="filter_has_skus")

    class Meta:
        model = Supplier
        fields = ["name", "is_active", "currency_default", "incoterm_default"]

    def filter_has_skus(self, queryset, name, value: bool):
        if value is True:
            return queryset.filter(product_links__isnull=False).distinct()
        if value is False:
            return queryset.filter(product_links__isnull=True)
        return queryset
