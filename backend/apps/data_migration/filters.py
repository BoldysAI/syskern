"""Filters for the migration quarantine API (CDC §8.7)."""

from __future__ import annotations

from django_filters import rest_framework as filters

from .models import MigrationUnmatched


class MigrationUnmatchedFilter(filters.FilterSet):
    """Filter quarantine rows by source file, reason, and resolved status.

    ``source_file`` and ``reason`` accept a comma-separated list (checkbox
    multi-select in the sidebar) and OR the values via ``__in``; a single value
    stays backwards-compatible. ``resolved`` is a boolean over the nullable
    ``resolved_at``: ``resolved=true`` → resolved rows; ``resolved=false`` → open.
    """

    source_file = filters.CharFilter(method="filter_source_file")
    reason = filters.CharFilter(method="filter_reason")
    resolved = filters.BooleanFilter(method="filter_resolved")

    class Meta:
        model = MigrationUnmatched
        fields = ["source_file", "reason", "resolved"]

    def filter_resolved(self, queryset, name, value):  # noqa: ARG002
        return queryset.filter(resolved_at__isnull=not value)

    @staticmethod
    def _csv_in(queryset, field: str, value: str):
        values = [v.strip() for v in (value or "").split(",") if v.strip()]
        if not values:
            return queryset
        return queryset.filter(**{f"{field}__in": values})

    def filter_source_file(self, queryset, name, value):  # noqa: ARG002
        return self._csv_in(queryset, "source_file", value)

    def filter_reason(self, queryset, name, value):  # noqa: ARG002
        return self._csv_in(queryset, "reason", value)
