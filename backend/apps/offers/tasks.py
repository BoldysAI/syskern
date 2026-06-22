"""Celery tasks for offer generation.

Tariff-offer generation is multi-client and writes one Excel file per client,
so per AGENTS.md §4 it runs in a worker: the endpoint returns ``202 + task_id``
and the client polls ``/api/tasks/{task_id}/`` for the result.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.clients.models import Client
from apps.simulations.models import Simulation, SimulationStatus, SimulationType
from apps.simulations.services.engine.context import fx_rate

from .models import ExportFormat, Offer, OfferLine, OfferStatus, OfferType
from .services.excel import build_tariff_xlsx, fx_note_for

logger = logging.getLogger("apps.offers.tasks")

# Reuse the products export volume (mounted at /tmp/syskern_exports in Docker).
EXPORT_DIR = Path("/tmp/syskern_exports/offers")
_Q4 = Decimal("0.0001")


def offer_export_path(offer_id) -> Path:
    return EXPORT_DIR / f"{offer_id}.xlsx"


@shared_task(name="offers.generate_tariff_offers_task")
def generate_tariff_offers_task(simulation_id: str, params: dict) -> dict:
    """Generate one tariff offer (+ Excel) per client from a finalized simulation.

    ``params`` = {client_ids, columns, target_currency, language,
    expiration_date (ISO str | None), incoterm, label}.
    Returns {count, currency, offers: [{offer_id, client_id, file_url,
    line_count, total_amount_eur}]}.
    """
    simulation = Simulation.objects.prefetch_related("lines__product").get(pk=simulation_id)
    # Defensive re-check (the endpoint validates too).
    if simulation.status != SimulationStatus.FINALIZED:
        raise ValueError("La simulation doit être finalisée.")
    if simulation.simulation_type != SimulationType.TARIFF:
        raise ValueError("La simulation doit être de type tarif.")

    target = (params.get("target_currency") or "EUR").upper()
    rate = fx_rate("EUR", target, simulation.market_params)  # raises if FX missing

    expiration = params.get("expiration_date")
    valid_to = date.fromisoformat(expiration) if expiration else None
    columns = params.get("columns") or None
    lang = params.get("language") or "fr"
    incoterm = params.get("incoterm") or "EXW"
    base_label = params.get("label") or simulation.label

    # Only priced lines feed an offer (final_price is NOT NULL).
    priced_lines = [ln for ln in simulation.lines.all() if ln.pv_eur is not None]

    clients = {str(c.id): c for c in Client.objects.filter(id__in=params["client_ids"])}

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    results = []

    for client_id in params["client_ids"]:
        client = clients.get(str(client_id))
        client_label = client.name if client else str(client_id)

        with transaction.atomic():
            offer = Offer.objects.create(
                simulation=simulation,
                offer_type=OfferType.TARIFF,
                label=f"{base_label} — {client_label}",
                client_ids=[client_id],
                currency=target,
                incoterm=incoterm,
                language=lang,
                valid_from=timezone.now().date(),
                valid_to=valid_to,
                export_format=ExportFormat.EXCEL,
                status=OfferStatus.DRAFT,
                version_number=1,
            )

            offer_lines = []
            total_eur = Decimal(0)
            for order, ln in enumerate(priced_lines):
                pv = ln.pv_eur
                if pv is None:  # guarded by priced_lines; keeps the type checker happy
                    continue
                final_price = (pv * rate).quantize(_Q4, rounding=ROUND_HALF_UP)
                total_eur += pv
                offer_lines.append(
                    OfferLine(
                        offer=offer,
                        product=ln.product,
                        simulation_line=ln,
                        final_price=final_price,
                        display_order=order,
                    )
                )
            OfferLine.objects.bulk_create(offer_lines)
            # Each OfferLine was built with `product=ln.product`, so `.product`
            # is already cached in-memory (no extra query) for the workbook.

            xlsx = build_tariff_xlsx(
                offer=offer,
                client=client,
                lines=offer_lines,
                columns=columns,
                lang=lang,
                fx_note=fx_note_for(target, simulation.market_params, rate),
            )
            offer_export_path(offer.id).write_bytes(xlsx)
            offer.generated_file_url = f"/api/offers/{offer.id}/download/"
            offer.save(update_fields=["generated_file_url", "updated_at"])

        results.append(
            {
                "offer_id": str(offer.id),
                "client_id": str(client_id),
                "file_url": offer.generated_file_url,
                "line_count": len(offer_lines),
                "total_amount_eur": str(total_eur),
            }
        )
        logger.info("Tariff offer %s generated for client %s", offer.id, client_label)

    return {"count": len(results), "currency": target, "offers": results}
