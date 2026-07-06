"""Simulation list filters (CDC §6.9.9)."""

from __future__ import annotations

import django_filters as filters
from django.db.models import Q

from .models import SavedComparison, Simulation, SimulationStatus, SimulationType


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
        return queryset.filter(Q(label__icontains=value) | Q(project_name__icontains=value))

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


class SavedComparisonFilter(filters.FilterSet):
    """List filters for persisted comparisons: search, structure, sim type.

    ``has_recalculations`` splits comparisons that include recalculation columns
    from simulation-only ones. ``sim_type`` (CSV multi-select) keeps comparisons
    referencing at least one simulation of the given type(s).
    """

    q = filters.CharFilter(method="filter_search")
    has_recalculations = filters.BooleanFilter(method="filter_has_recalculations")
    sim_type = filters.CharFilter(method="filter_sim_type")

    class Meta:
        model = SavedComparison
        fields = ["q", "has_recalculations", "sim_type"]

    def filter_search(self, queryset, name, value: str):
        value = (value or "").strip()
        if not value:
            return queryset
        return queryset.filter(Q(label__icontains=value) | Q(note__icontains=value))

    def filter_has_recalculations(self, queryset, name, value):
        if value is True:
            return queryset.exclude(recalculation_ids=[])
        if value is False:
            return queryset.filter(recalculation_ids=[])
        return queryset

    def filter_sim_type(self, queryset, name, value: str):
        allowed = {SimulationType.TARIFF, SimulationType.PROJECT}
        selected = [v.strip() for v in (value or "").split(",") if v.strip() in allowed]
        if not selected:
            return queryset
        sim_ids = list(
            Simulation.objects.filter(simulation_type__in=selected).values_list("id", flat=True)
        )
        if not sim_ids:
            return queryset.none()
        return queryset.filter(simulation_ids__overlap=sim_ids)
