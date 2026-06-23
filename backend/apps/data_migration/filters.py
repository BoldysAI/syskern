"""Filters for the migration quarantine API (CDC §8.7)."""

from __future__ import annotations

from django_filters import rest_framework as filters

from .models import MigrationUnmatched


class MigrationUnmatchedFilter(filters.FilterSet):
    """Filter quarantine rows by source file, reason, and resolved status.

    ``resolved`` is a boolean over the nullable ``resolved_at``:
    ``resolved=true`` → rows with a resolution; ``resolved=false`` → still open.
    """

    resolved = filters.BooleanFilter(method="filter_resolved")

    class Meta:
        model = MigrationUnmatched
        fields = ["source_file", "reason", "resolved"]

    def filter_resolved(self, queryset, name, value):  # noqa: ARG002
        return queryset.filter(resolved_at__isnull=not value)
