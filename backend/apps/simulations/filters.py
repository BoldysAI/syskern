"""Simulation list filters (CDC §6.9.9)."""

from __future__ import annotations

import django_filters as filters
from django.db.models import Q

from .models import Simulation, SimulationStatus, SimulationType


class SimulationFilter(filters.FilterSet):
    """List filters: full-text search, type/status multi-select, dirty flag."""

    q = filters.CharFilter(method="filter_search")
    simulation_type = filters.CharFilter(method="filter_simulation_type")
    status = filters.CharFilter(method="filter_status")
    is_dirty = filters.BooleanFilter(field_name="is_dirty")

    class Meta:
        model = Simulation
        fields = ["q", "simulation_type", "status", "is_dirty"]

    def filter_search(self, queryset, name, value: str):
        value = (value or "").strip()
        if not value:
            return queryset
        return queryset.filter(
            Q(label__icontains=value) | Q(project_name__icontains=value)
        )

    def filter_simulation_type(self, queryset, name, value: str):
        values = [v.strip() for v in value.split(",") if v.strip()]
        allowed = {SimulationType.TARIFF, SimulationType.PROJECT}
        selected = [v for v in values if v in allowed]
        if not selected:
            return queryset
        return queryset.filter(simulation_type__in=selected)

    def filter_status(self, queryset, name, value: str):
        values = [v.strip() for v in value.split(",") if v.strip()]
        allowed = {
            SimulationStatus.DRAFT,
            SimulationStatus.FINALIZED,
            SimulationStatus.ARCHIVED,
        }
        selected = [v for v in values if v in allowed]
        if not selected:
            return queryset
        return queryset.filter(status__in=selected)
