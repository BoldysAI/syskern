"""Home dashboard aggregates (cross-app read model)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.db.models import Q
from django.utils import timezone

from apps.core.models import Currency
from apps.documents.models import DocumentLibrary
from apps.market.models import CopperMarket, MarketParameter, MarketParameterType
from apps.offers.dashboard_metrics import build_offer_dashboard_metrics
from apps.offers.models import GenerationStatus, Offer, OfferStatus
from apps.products.models import Product
from apps.simulations.models import SavedComparison, Simulation, SimulationStatus


def _serialize_market_param(param: MarketParameter | None) -> dict[str, Any] | None:
    if param is None:
        return None
    base = {
        "valid_from": param.valid_from.isoformat(),
        "updated_at": param.updated_at.isoformat(),
    }
    if param.parameter_type == MarketParameterType.COPPER_PRICE:
        return {
            **base,
            "value": str(param.copper_price) if param.copper_price is not None else None,
            "currency": param.copper_currency,
            "unit": param.copper_unit,
            "market": param.copper_market,
        }
    return {
        **base,
        "value": str(param.fx_rate) if param.fx_rate is not None else None,
        "from_currency": param.fx_from_currency,
        "to_currency": param.fx_to_currency,
    }


def _current_market_param(
    parameter_type: str,
    **filters: str,
) -> MarketParameter | None:
    qs = MarketParameter.objects.filter(is_active=True, parameter_type=parameter_type)
    for key, value in filters.items():
        qs = qs.filter(**{key: value})
    return qs.order_by("-valid_from").first()


def _simulation_counts() -> dict[str, int]:
    base = Simulation.objects.exclude(status=SimulationStatus.ARCHIVED)
    draft = base.filter(status=SimulationStatus.DRAFT).count()
    finalized = base.filter(status=SimulationStatus.FINALIZED).count()
    dirty = base.filter(is_dirty=True).count()
    never_calculated = base.filter(last_calculated_at__isnull=True).count()
    with_line_errors = (
        base.filter(lines__status="error")
        .distinct()
        .count()
    )
    return {
        "total": draft + finalized,
        "draft": draft,
        "finalized": finalized,
        "dirty": dirty,
        "never_calculated": never_calculated,
        "with_line_errors": with_line_errors,
    }


def _todo_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    active = Simulation.objects.exclude(status=SimulationStatus.ARCHIVED)

    for sim in active.filter(is_dirty=True).order_by("-updated_at")[:5]:
        items.append(
            {
                "kind": "simulation_dirty",
                "id": str(sim.pk),
                "label": sim.label,
                "occurred_at": sim.updated_at.isoformat(),
                "href_path": f"/simulator/{sim.pk}",
            }
        )

    for sim in active.filter(last_calculated_at__isnull=True).order_by("-updated_at")[:5]:
        if any(i["id"] == str(sim.pk) and i["kind"] == "simulation_dirty" for i in items):
            continue
        items.append(
            {
                "kind": "simulation_never_calculated",
                "id": str(sim.pk),
                "label": sim.label,
                "occurred_at": sim.updated_at.isoformat(),
                "href_path": f"/simulator/{sim.pk}",
            }
        )

    error_sims = (
        active.filter(lines__status="error")
        .distinct()
        .order_by("-updated_at")[:5]
    )
    for sim in error_sims:
        if any(i["id"] == str(sim.pk) and i["kind"] == "simulation_line_errors" for i in items):
            continue
        items.append(
            {
                "kind": "simulation_line_errors",
                "id": str(sim.pk),
                "label": sim.label,
                "occurred_at": sim.updated_at.isoformat(),
                "href_path": f"/simulator/{sim.pk}",
            }
        )

    now = timezone.now()
    deadline = now.date() + timedelta(days=7)
    expiring = Offer.objects.filter(
        Q(valid_to__isnull=False, valid_to__lte=deadline, valid_to__gte=now.date()),
        status=OfferStatus.SENT,
    ).order_by("valid_to")[:5]
    for offer in expiring:
        items.append(
            {
                "kind": "offer_expiring",
                "id": str(offer.pk),
                "label": offer.label,
                "occurred_at": offer.updated_at.isoformat(),
                "href_path": f"/offers/{offer.pk}",
            }
        )

    for offer in Offer.objects.filter(generation_status=GenerationStatus.ERROR).order_by(
        "-updated_at"
    )[:5]:
        items.append(
            {
                "kind": "offer_generation_error",
                "id": str(offer.pk),
                "label": offer.label,
                "occurred_at": offer.updated_at.isoformat(),
                "href_path": f"/offers/{offer.pk}",
            }
        )

    return items[:20]


def _recent_items() -> list[dict[str, Any]]:
    recent: list[dict[str, Any]] = []

    for sim in (
        Simulation.objects.exclude(status=SimulationStatus.ARCHIVED)
        .order_by("-updated_at")[:5]
    ):
        recent.append(
            {
                "kind": "simulation",
                "id": str(sim.pk),
                "label": sim.label,
                "occurred_at": sim.updated_at.isoformat(),
                "status": sim.status,
                "is_dirty": sim.is_dirty,
                "href_path": f"/simulator/{sim.pk}",
            }
        )

    for offer in Offer.objects.order_by("-created_at")[:5]:
        recent.append(
            {
                "kind": "offer",
                "id": str(offer.pk),
                "label": offer.label,
                "occurred_at": offer.created_at.isoformat(),
                "status": offer.status,
                "is_dirty": False,
                "href_path": f"/offers/{offer.pk}",
            }
        )

    for comp in SavedComparison.objects.order_by("-updated_at")[:5]:
        recent.append(
            {
                "kind": "comparison",
                "id": str(comp.pk),
                "label": comp.label,
                "occurred_at": comp.updated_at.isoformat(),
                "status": "",
                "is_dirty": False,
                "href_path": f"/comparator/{comp.pk}",
            }
        )

    recent.sort(key=lambda row: row["occurred_at"], reverse=True)
    return recent[:8]


def build_dashboard_summary() -> dict[str, Any]:
    """Build the home dashboard payload (read-only aggregates)."""
    universe_count = (
        Product.objects.filter(is_active=True)
        .exclude(universe="")
        .values_list("universe", flat=True)
        .distinct()
        .count()
    )

    copper = _current_market_param(
        MarketParameterType.COPPER_PRICE,
        copper_market=CopperMarket.LME,
    )
    fx = _current_market_param(
        MarketParameterType.FX_RATE,
        fx_from_currency=Currency.EUR,
        fx_to_currency=Currency.USD,
    )

    return {
        "catalog": {
            "product_count": Product.objects.filter(is_active=True).count(),
            "universe_count": universe_count,
        },
        "simulations": _simulation_counts(),
        "offers": build_offer_dashboard_metrics(),
        "comparisons": {"total": SavedComparison.objects.count()},
        "library": {"document_count": DocumentLibrary.objects.count()},
        "market": {
            "copper_lme": _serialize_market_param(copper),
            "fx_usd_eur": _serialize_market_param(fx),
        },
        "todo": _todo_items(),
        "recent": _recent_items(),
    }
