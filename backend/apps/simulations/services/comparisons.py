"""Lifecycle helpers for ``SavedComparison`` when simulations disappear.

A comparison stores UUID arrays (not FKs), so deleting a simulation would leave
orphan column IDs and break ``POST /api/simulations/compare`` (400). On delete we
detach the simulation (and its recalculation snapshots) from every comparison;
if fewer than 2 columns remain, the comparison itself is removed.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from django.db.models import Q

from apps.simulations.models import SavedComparison, Simulation, SimulationRecalculation


@dataclass(frozen=True)
class ComparisonDetachImpact:
    """One comparison affected by removing a simulation (or healing orphans)."""

    id: UUID
    label: str
    will_delete: bool


@dataclass(frozen=True)
class DetachResult:
    deleted: list[ComparisonDetachImpact]
    updated: list[ComparisonDetachImpact]


def comparisons_referencing_simulation(simulation: Simulation):
    """QuerySet of comparisons that include this sim or any of its recalcs."""
    sim_id = simulation.pk
    recalc_ids = list(simulation.recalculations.values_list("id", flat=True))
    q = Q(simulation_ids__overlap=[sim_id])
    if recalc_ids:
        q |= Q(recalculation_ids__overlap=recalc_ids)
    return SavedComparison.objects.filter(q)


def preview_detach_impact(simulation: Simulation) -> list[ComparisonDetachImpact]:
    """Describe what would happen if ``simulation`` were removed from comparisons."""
    sim_id = simulation.pk
    recalc_ids = set(simulation.recalculations.values_list("id", flat=True))
    out: list[ComparisonDetachImpact] = []
    for comp in comparisons_referencing_simulation(simulation):
        remaining = _columns_after_detach(comp, sim_id, recalc_ids)
        out.append(
            ComparisonDetachImpact(
                id=comp.pk,
                label=comp.label,
                will_delete=len(remaining) < 2,
            )
        )
    return out


def detach_simulation_from_comparisons(simulation: Simulation) -> DetachResult:
    """Remove ``simulation`` (and its recalcs) from all saved comparisons.

    Must be called **before** the simulation row is deleted (recalc IDs are
    read from the related manager, which cascades on delete).
    """
    sim_id = simulation.pk
    recalc_ids = set(simulation.recalculations.values_list("id", flat=True))
    deleted: list[ComparisonDetachImpact] = []
    updated: list[ComparisonDetachImpact] = []

    for comp in list(comparisons_referencing_simulation(simulation)):
        remaining_sims, remaining_recalcs = _split_columns_after_detach(comp, sim_id, recalc_ids)
        total = len(remaining_sims) + len(remaining_recalcs)
        impact = ComparisonDetachImpact(id=comp.pk, label=comp.label, will_delete=total < 2)
        if total < 2:
            comp.delete()
            deleted.append(impact)
        else:
            comp.simulation_ids = remaining_sims
            comp.recalculation_ids = remaining_recalcs
            comp.save(update_fields=["simulation_ids", "recalculation_ids", "updated_at"])
            updated.append(impact)

    return DetachResult(deleted=deleted, updated=updated)


def heal_saved_comparison(comparison: SavedComparison) -> SavedComparison | None:
    """Drop orphan column IDs; delete the comparison if fewer than 2 remain.

    Returns the (possibly updated) comparison, or ``None`` if it was deleted.
    Used when opening a stale comparison after a past delete that left orphans.
    """
    existing_sims = set(
        Simulation.objects.filter(id__in=comparison.simulation_ids).values_list("id", flat=True)
    )
    existing_recalcs = set(
        SimulationRecalculation.objects.filter(id__in=comparison.recalculation_ids).values_list(
            "id", flat=True
        )
    )
    new_sims = [sid for sid in comparison.simulation_ids if sid in existing_sims]
    new_recalcs = [rid for rid in comparison.recalculation_ids if rid in existing_recalcs]
    if new_sims == list(comparison.simulation_ids) and new_recalcs == list(
        comparison.recalculation_ids
    ):
        return comparison
    if len(new_sims) + len(new_recalcs) < 2:
        comparison.delete()
        return None
    comparison.simulation_ids = new_sims
    comparison.recalculation_ids = new_recalcs
    comparison.save(update_fields=["simulation_ids", "recalculation_ids", "updated_at"])
    return comparison


def _columns_after_detach(comp: SavedComparison, sim_id: UUID, recalc_ids: set[UUID]) -> list[UUID]:
    sims, recalcs = _split_columns_after_detach(comp, sim_id, recalc_ids)
    return [*sims, *recalcs]


def _split_columns_after_detach(
    comp: SavedComparison, sim_id: UUID, recalc_ids: set[UUID]
) -> tuple[list[UUID], list[UUID]]:
    remaining_sims = [sid for sid in comp.simulation_ids if sid != sim_id]
    remaining_recalcs = [rid for rid in comp.recalculation_ids if rid not in recalc_ids]
    return remaining_sims, remaining_recalcs
