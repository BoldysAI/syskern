"""Filters for the document library API (CDC §7.4).

Mirrors the other list modules: CSV multi-select on ``category`` / ``language``
(checkbox groups in the sidebar) while keeping the exact ``product`` / ``is_active``
filters the previous ``filterset_fields`` exposed.
"""

from __future__ import annotations

import django_filters as filters

from apps.core.models import Language

from .models import DocumentCategory, DocumentLibrary


class DocumentLibraryFilter(filters.FilterSet):
    category = filters.CharFilter(method="filter_category")
    language = filters.CharFilter(method="filter_language")

    class Meta:
        model = DocumentLibrary
        fields = ["category", "language", "product", "is_active"]

    @staticmethod
    def _csv_in(queryset, field: str, value: str, allowed: set[str]):
        values = [v.strip() for v in (value or "").split(",") if v.strip() in allowed]
        if not values:
            return queryset
        return queryset.filter(**{f"{field}__in": values})

    def filter_category(self, queryset, name, value: str):
        return self._csv_in(queryset, "category", value, set(DocumentCategory.values))

    def filter_language(self, queryset, name, value: str):
        return self._csv_in(queryset, "language", value, set(Language.values))
