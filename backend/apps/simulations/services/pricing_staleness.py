"""Detect persisted pricing breakdowns that predate engine rule changes."""

from __future__ import annotations


def _is_syskern_margin_step(step: dict) -> bool:
    module = step.get("module") or ""
    if module == "syskern_margin":
        return True
    if module == "margin":
        return (step.get("metadata") or {}).get("label") == "syskern"
    return False


def sale_margin_before_transport_stale(breakdown: dict | None) -> bool:
    """Return True when the sale chain applied Syskern margin *after* PV transports.

    CDC Feedback 1 requires margin on the PR first. Lines calculated with the
    old engine order keep a frozen ``calculation_breakdown`` until recalculated.
    """
    if not breakdown:
        return False
    steps = (breakdown.get("sale") or {}).get("steps") or []
    if len(steps) < 2:
        return False

    margin_idx = next((i for i, s in enumerate(steps) if _is_syskern_margin_step(s)), -1)
    transport_idx = next((i for i, s in enumerate(steps) if s.get("module") == "transport"), -1)
    if margin_idx < 0 or transport_idx < 0:
        return False
    return margin_idx > transport_idx


def invalidate_stale_sale_margin_lines(*, dry_run: bool = False) -> dict[str, int]:
    """Mark draft simulation lines dirty when their sale breakdown uses the old margin order."""
    from ..models import Simulation, SimulationLine

    stale_simulation_ids: set = set()
    lines_touched = 0

    qs = SimulationLine.objects.filter(simulation__status="draft").exclude(
        calculation_breakdown={}
    )
    for line in qs.iterator(chunk_size=500):
        if not sale_margin_before_transport_stale(line.calculation_breakdown):
            continue
        lines_touched += 1
        stale_simulation_ids.add(line.simulation_id)
        if not dry_run:
            line.status = "dirty"
            line.save(update_fields=["status", "updated_at"])

    sims_touched = 0
    if stale_simulation_ids and not dry_run:
        sims_touched = Simulation.objects.filter(
            pk__in=stale_simulation_ids, status="draft"
        ).update(is_dirty=True)

    return {
        "lines_stale": lines_touched,
        "simulations_marked_dirty": sims_touched if not dry_run else len(stale_simulation_ids),
    }
