"""Aggregated offer metrics for dashboard endpoints (CDC §7.5.3)."""

from __future__ import annotations

from django.db.models import Count, F, Sum
from django.utils import timezone

from .models import GenerationStatus, Offer, OfferLine, OfferStatus, OfferType


def build_offer_dashboard_metrics() -> dict:
    """Return offer KPI aggregates shared by dashboard and offers API."""
    now = timezone.now()
    counts = Offer.objects.values("status").annotate(n=Count("id")).order_by()
    status_counts = {row["status"]: row["n"] for row in counts}

    project_qs = Offer.objects.filter(offer_type=OfferType.PROJECT)
    won = project_qs.filter(status=OfferStatus.WON).count()
    lost = project_qs.filter(status=OfferStatus.LOST).count()
    conversion = (won / (won + lost) * 100) if (won + lost) else None

    won_total = (
        OfferLine.objects.filter(offer__status=OfferStatus.WON)
        .aggregate(total=Sum(F("final_price") * F("quantity")))
        .get("total")
    )

    tariff_active = Offer.objects.filter(
        offer_type=OfferType.TARIFF,
        status__in=[OfferStatus.SENT, OfferStatus.DRAFT],
        valid_to__gte=now.date(),
    ).count()

    generation_error_count = Offer.objects.filter(
        generation_status=GenerationStatus.ERROR,
    ).count()

    return {
        "status_counts": status_counts,
        "project_conversion_pct": conversion,
        "won_total": str(won_total) if won_total is not None else None,
        "tariff_active": tariff_active,
        "generation_error_count": generation_error_count,
    }
