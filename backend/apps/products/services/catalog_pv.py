"""Catalog PV enrichment — EUR pivot + USD/RMB via simulation FX (CDC §6.3.2)."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from apps.simulations.models import SimulationLine, SimulationStatus
from apps.simulations.services.engine.context import fx_rate

_QUANT = Decimal("0.0001")


def pv_in_currencies(pv_eur: Decimal, market_params: dict) -> dict[str, str | None]:
    """Convert a EUR PV to EUR / USD / RMB using frozen simulation market params."""
    base = pv_eur.quantize(_QUANT, rounding=ROUND_HALF_UP)
    out: dict[str, str | None] = {"pv_eur": str(base), "pv_usd": None, "pv_rmb": None}
    for ccy in ("USD", "RMB"):
        try:
            rate = fx_rate("EUR", ccy, market_params)
            converted = (base * rate).quantize(_QUANT, rounding=ROUND_HALF_UP)
            out[f"pv_{ccy.lower()}"] = str(converted)
        except ValueError:
            continue
    return out


def catalog_pv_payload(
    pv_eur: Decimal,
    *,
    simulation_id,
    market_params: dict,
) -> dict[str, Any]:
    currencies = pv_in_currencies(pv_eur, market_params)
    return {
        **currencies,
        "simulation_id": str(simulation_id),
    }


def build_catalog_pv_map(
    product_ids: list[str],
    simulation_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Map product UUID → PV triple + source simulation id."""
    if not product_ids:
        return {}

    if simulation_id:
        lines = (
            SimulationLine.objects.filter(
                simulation_id=simulation_id,
                product_id__in=product_ids,
                pv_eur__isnull=False,
            )
            .select_related("simulation")
        )
    else:
        lines = (
            SimulationLine.objects.filter(
                product_id__in=product_ids,
                simulation__status=SimulationStatus.FINALIZED,
                simulation__last_calculated_at__isnull=False,
                pv_eur__isnull=False,
            )
            .select_related("simulation")
            .order_by("product_id", "-simulation__last_calculated_at")
            .distinct("product_id")
        )

    result: dict[str, dict[str, Any]] = {}
    for line in lines:
        pid = str(line.product_id)
        if pid in result:
            continue
        result[pid] = catalog_pv_payload(
            line.pv_eur,
            simulation_id=line.simulation_id,
            market_params=line.simulation.market_params or {},
        )
    return result
