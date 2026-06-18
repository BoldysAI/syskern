"""Celery tasks for the simulations app."""

from __future__ import annotations

from celery import shared_task

from .models import RecalculationTrigger, Simulation
from .serializers import SimulationDetailSerializer
from .services.runner import run_simulation


class _TaskError(RuntimeError):
    """Raised inside tasks to surface a clean message via Celery FAILURE."""


@shared_task(name="simulations.recalculate_task")
def recalculate_task(
    simulation_pk: str,
    market_params: dict | None = None,
    refresh_odoo: bool = False,
    note: str = "",
) -> dict:
    """Recalculate every line of a simulation in a worker.

    Mirrors the previous synchronous view: optionally updates market_params
    first, then runs the pricing engine, then returns the fresh
    `SimulationDetailSerializer` payload.
    """
    try:
        sim = Simulation.objects.get(pk=simulation_pk)
    except Simulation.DoesNotExist as e:
        raise _TaskError("Simulation introuvable.") from e

    if sim.status == "finalized":
        raise _TaskError("Une simulation finalisée ne peut pas être recalculée.")

    if market_params:
        sim.market_params = market_params
        sim.save(update_fields=["market_params", "updated_at"])

    trigger = (
        RecalculationTrigger.MANUAL_FULL_REFRESH
        if market_params
        else RecalculationTrigger.MANUAL_REFRESH_ODOO
        if refresh_odoo
        else RecalculationTrigger.MANUAL_CURRENT_PARAMS
    )
    run_simulation(sim, trigger=trigger, note=note)

    fresh = Simulation.objects.prefetch_related("lines").get(pk=sim.pk)
    return SimulationDetailSerializer(fresh).data
