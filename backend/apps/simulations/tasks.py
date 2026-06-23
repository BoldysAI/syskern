"""Celery tasks for the simulations app."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

from celery import shared_task
from django.utils import timezone

from .exports import build_simulation_xlsx
from .models import RecalculationTrigger, Simulation
from .serializers import SimulationDetailSerializer
from .services.odoo_refresh import refresh_odoo_for_simulation
from .services.runner import run_simulation

logger = logging.getLogger(__name__)

EXPORT_DIR = Path("/tmp/syskern_exports")

# Recalc scope (CDC §6.9.4) → audit trail trigger.
_SCOPE_TRIGGER = {
    "params_only": RecalculationTrigger.MANUAL_CURRENT_PARAMS,
    "with_odoo_refresh": RecalculationTrigger.MANUAL_REFRESH_ODOO,
    "full_refresh": RecalculationTrigger.MANUAL_FULL_REFRESH,
}


class _TaskError(RuntimeError):
    """Raised inside tasks to surface a clean message via Celery FAILURE."""


@shared_task(name="simulations.recalculate_task")
def recalculate_task(
    simulation_pk: str,
    scope: str = "params_only",
    market_params: dict | None = None,
    note: str = "",
) -> dict:
    """Recalculate every line of a simulation in a worker (CDC §6.9.4).

    Scopes:
      - `params_only`      : recalc with the current params.
      - `with_odoo_refresh`: pull fresh Odoo stock/PAMP/pending purchases first.
      - `full_refresh`     : also refresh market params (caller-supplied), then
                             pull Odoo and recalc.

    Odoo is **decoupled** from the calculation: if a refresh scope fails to
    reach Odoo, the recalc still runs on the current params (degraded mode) and
    the failure is reported as `odoo_refresh_error` instead of aborting — a
    pricing run must never be blocked by an unavailable external system.

    Returns the fresh `SimulationDetailSerializer` payload (plus an optional
    `odoo_refresh_error` key when the refresh degraded).
    """
    try:
        sim = Simulation.objects.get(pk=simulation_pk)
    except Simulation.DoesNotExist as e:
        raise _TaskError("Simulation introuvable.") from e

    if sim.status == "finalized":
        raise _TaskError("Une simulation finalisée ne peut pas être recalculée.")

    if scope not in _SCOPE_TRIGGER:
        raise _TaskError("Périmètre de recalcul invalide.")

    # Market params from the client (sidebar) are persisted before recalc (any scope).
    if market_params:
        sim.market_params = market_params
        sim.save(update_fields=["market_params", "updated_at"])

    odoo_snapshot_at = None
    pending_by_product = None
    odoo_error: str | None = None
    if scope in {"with_odoo_refresh", "full_refresh"}:
        try:
            odoo_snapshot_at, pending_by_product = refresh_odoo_for_simulation(sim)
            sim.refresh_from_db()
        except Exception as exc:  # noqa: BLE001 — Odoo must never block a recalc
            logger.warning("Odoo refresh failed for simulation %s: %s", sim.pk, exc)
            odoo_error = str(exc)

    effective_note = note
    if odoo_error:
        prefix = f"{note} " if note else ""
        effective_note = f"{prefix}[Rafraîchissement Odoo indisponible : {odoo_error}]"

    run_simulation(
        sim,
        trigger=_SCOPE_TRIGGER[scope],
        odoo_snapshot_at=odoo_snapshot_at,
        note=effective_note,
        pending_by_product=pending_by_product,
    )

    fresh = Simulation.objects.prefetch_related("lines").get(pk=sim.pk)
    data = SimulationDetailSerializer(fresh).data
    if odoo_error:
        data["odoo_refresh_error"] = odoo_error
    return data


def _slugify_label(label: str) -> str:
    """Filesystem-safe slug for the export filename."""
    slug = re.sub(r"[^\w\-]+", "_", (label or "simulation").strip().lower())
    return slug.strip("_") or "simulation"


@shared_task(name="simulations.export_simulation_task", bind=True)
def export_simulation_task(self, simulation_pk: str) -> dict:
    """Build the simulation Excel workbook and store it on disk (CDC §6.9).

    Returns `{"file_url", "filename", "size_bytes"}` — the client polls the
    polling endpoint, then downloads the file via the URL.
    """
    try:
        sim = Simulation.objects.prefetch_related("lines__product").get(pk=simulation_pk)
    except Simulation.DoesNotExist as e:
        raise _TaskError("Simulation introuvable.") from e

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    file_path = EXPORT_DIR / f"{self.request.id}.xlsx"
    file_path.write_bytes(build_simulation_xlsx(sim))

    timestamp = timezone.now().strftime("%Y%m%d")
    return {
        "file_url": f"/api/simulations/exports/{self.request.id}/",
        "filename": f"simulation_{_slugify_label(sim.label)}_{timestamp}.xlsx",
        "size_bytes": os.path.getsize(file_path),
    }
