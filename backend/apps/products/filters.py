"""Catalog filters (CDC §4.1.1)."""
from __future__ import annotations

import django_filters as filters
from django.db.models import Q

from .models import Product


class ProductFilter(filters.FilterSet):
    """Catalog filters: hierarchy cascade, brand, stock, supplier, etc."""

    sku_code = filters.CharFilter(field_name="sku_code", lookup_expr="icontains")
    # Accepts one or several comma-separated universes, matched case-insensitively.
    # e.g. ?universe=COPPER  or  ?universe=COPPER,OPTICAL FIBER
    universe = filters.CharFilter(method="filter_universe")
    family = filters.CharFilter(field_name="family", lookup_expr="iexact")
    range = filters.CharFilter(field_name="range", lookup_expr="iexact")
    sub_range = filters.CharFilter(field_name="sub_range", lookup_expr="iexact")
    brand = filters.CharFilter(field_name="brand", lookup_expr="iexact")
    factory_code = filters.CharFilter(field_name="factory_code", lookup_expr="iexact")
    is_active = filters.BooleanFilter(field_name="is_active")
    is_copper_indexed = filters.BooleanFilter(field_name="is_copper_indexed")

    # PV / PAMP price-range filters.
    pamp_min = filters.NumberFilter(field_name="pamp_eur", lookup_expr="gte")
    pamp_max = filters.NumberFilter(field_name="pamp_eur", lookup_expr="lte")

    # Stock availability — `gt=0` is the canonical "in stock" check.
    in_stock = filters.BooleanFilter(method="filter_in_stock")

    class Meta:
        model = Product
        fields = [
            "sku_code",
            "universe",
            "family",
            "range",
            "sub_range",
            "brand",
            "factory_code",
            "is_active",
            "is_copper_indexed",
        ]

    def filter_universe(self, queryset, name, value: str):
        """Match one or several comma-separated universes (case-insensitive)."""
        values = [v.strip() for v in value.split(",") if v.strip()]
        if not values:
            return queryset
        q = Q()
        for v in values:
            q |= Q(universe__iexact=v)
        return queryset.filter(q)

    def filter_in_stock(self, queryset, name, value: bool):
        if value is None:
            return queryset
        if value:
            return queryset.filter(stock_quantity__gt=0)
        return queryset.filter(stock_quantity__lte=0) | queryset.filter(stock_quantity__isnull=True)
