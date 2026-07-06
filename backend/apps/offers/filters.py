"""Offer list filters — left-sidebar module parity (CDC §7.5).

Mirrors ``apps.simulations.filters.SimulationFilter``: CSV multi-select on
``offer_type`` / ``status`` / ``generation_status`` (checkbox groups in the
sidebar) plus a ``q`` full-text search. Single-value exact filters on
``currency`` / ``language`` / ``export_format`` are kept for existing API
consumers that relied on the previous ``filterset_fields``.
"""

from __future__ import annotations

import django_filters as filters
from django.db.models import Q

from .models import GenerationStatus, Offer, OfferStatus, OfferType


class OfferFilter(filters.FilterSet):
    """List filters: full-text search + type/status/generation multi-select."""

    q = filters.CharFilter(method="filter_search")
    offer_type = filters.CharFilter(method="filter_offer_type")
    status = filters.CharFilter(method="filter_status")
    generation_status = filters.CharFilter(method="filter_generation_status")
    currency = filters.CharFilter(field_name="currency", lookup_expr="iexact")
    language = filters.CharFilter(field_name="language", lookup_expr="iexact")
    export_format = filters.CharFilter(field_name="export_format", lookup_expr="iexact")

    class Meta:
        model = Offer
        fields = [
            "q",
            "offer_type",
            "status",
            "generation_status",
            "currency",
            "language",
            "export_format",
        ]

    def filter_search(self, queryset, name, value: str):
        value = (value or "").strip()
        if not value:
            return queryset
        return queryset.filter(Q(label__icontains=value) | Q(project_name__icontains=value))

    @staticmethod
    def _csv_in(queryset, field: str, value: str, allowed: set[str]):
        values = [v.strip() for v in (value or "").split(",") if v.strip()]
        selected = [v for v in values if v in allowed]
        if not selected:
            return queryset
        return queryset.filter(**{f"{field}__in": selected})

    def filter_offer_type(self, queryset, name, value: str):
        return self._csv_in(queryset, "offer_type", value, set(OfferType.values))

    def filter_status(self, queryset, name, value: str):
        return self._csv_in(queryset, "status", value, set(OfferStatus.values))

    def filter_generation_status(self, queryset, name, value: str):
        return self._csv_in(queryset, "generation_status", value, set(GenerationStatus.values))
