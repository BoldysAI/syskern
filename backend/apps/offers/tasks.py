"""Celery tasks for offer generation.

Tariff-offer generation is multi-client and writes one Excel file per client,
so per AGENTS.md §4 it runs in a worker: the endpoint returns ``202 + task_id``
and the client polls ``/api/tasks/{task_id}/`` for the result.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.clients.models import Client
from apps.simulations.models import Simulation, SimulationStatus, SimulationType
from apps.simulations.services.engine.context import fx_rate

from .models import ExportFormat, GenerationStatus, Offer, OfferLine, OfferStatus, OfferType
from .services.excel import build_tariff_xlsx, fx_note_for
from .services.project_generator import create_project_offer, run_generation

logger = logging.getLogger("apps.offers.tasks")

# Reuse the products export volume (mounted at /tmp/syskern_exports in Docker).
EXPORT_DIR = Path("/tmp/syskern_exports/offers")
_Q4 = Decimal("0.0001")


def offer_export_path(offer_id) -> Path:
    return EXPORT_DIR / f"{offer_id}.xlsx"


@shared_task(name="offers.generate_tariff_offers_task", soft_time_limit=120, time_limit=180)
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
                attached_document_ids=params.get("attached_document_ids") or [],
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
            # Excel is produced synchronously here — mark the offer READY so the
            # front stops polling (tariff offers never touch the Gamma flow, and
            # the default PENDING would keep the list refreshing forever).
            offer.generation_status = GenerationStatus.READY
            offer.save(update_fields=["generated_file_url", "generation_status", "updated_at"])

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


def _offer_generation_result(offer: Offer) -> dict:
    return {
        "offer_id": str(offer.id),
        "generation_status": offer.generation_status,
        "gamma_document_id": offer.gamma_document_id,
        "gamma_url": offer.generated_file_url,
        "error": offer.generation_error,
    }


@shared_task(name="offers.generate_project_offer_task", soft_time_limit=330, time_limit=360)
def generate_project_offer_task(simulation_id: str, params: dict) -> dict:
    """Create a project offer then generate its Gamma quote (CDC §7.3).

    ``params`` = {client_id, project_name, quantities (sku->qty), language,
    expiration_date (ISO|None), ai_instructions, sections_config}.
    """
    simulation = Simulation.objects.prefetch_related("lines__product").get(pk=simulation_id)
    if simulation.status != SimulationStatus.FINALIZED:
        raise ValueError("La simulation doit être finalisée.")
    if simulation.simulation_type != SimulationType.PROJECT:
        raise ValueError("La simulation doit être de type projet.")

    client = Client.objects.get(pk=params["client_id"])
    expiration = params.get("expiration_date")
    offer = create_project_offer(
        simulation=simulation,
        client=client,
        project_name=params["project_name"],
        quantities=params.get("quantities") or {},
        language=params.get("language") or "fr",
        expiration_date=date.fromisoformat(expiration) if expiration else None,
        ai_instructions=params.get("ai_instructions") or "",
        sections_config=params.get("sections_config"),
        attached_document_ids=params.get("attached_document_ids") or [],
    )
    offer = run_generation(offer)
    return _offer_generation_result(offer)


@shared_task(name="offers.regenerate_project_offer_task", soft_time_limit=330, time_limit=360)
def regenerate_project_offer_task(offer_id: str) -> dict:
    """Re-run Gamma generation for an existing project offer (retry, CDC §7.6.3)."""
    offer = Offer.objects.get(pk=offer_id)
    offer = run_generation(offer)
    return _offer_generation_result(offer)


@shared_task(name="offers.reap_stuck_generations")
def reap_stuck_generations(max_age_minutes: int = 15) -> dict:
    """Fail offers stuck in `generating` beyond the hard time-limit window.

    ``run_generation`` always reaches a terminal state on a normal failure; this
    backstop catches the pathological case where the worker was hard-killed
    (SIGKILL / OOM) mid-generation, which would otherwise leave the offer polling
    forever in the UI (CDC §7.6.3). Registered as a Celery Beat task (15 min).
    """
    cutoff = timezone.now() - timedelta(minutes=max_age_minutes)
    stuck = Offer.objects.filter(
        generation_status=GenerationStatus.GENERATING, updated_at__lt=cutoff
    )
    count = stuck.update(
        generation_status=GenerationStatus.ERROR,
        generation_error=("Génération interrompue (worker indisponible). Relancez la génération."),
        updated_at=timezone.now(),
    )
    if count:
        logger.warning("Reaped %d stuck offer generation(s)", count)
    return {"reaped": count}


@shared_task(name="offers.daily_expiration_check")
def daily_expiration_check() -> dict:
    """Daily lifecycle cron (CDC §7.5.4 / §7.6).

    1. Auto-expire `sent` offers whose validity has passed (won/lost untouched).
    2. Email a J-7 alert listing `sent` offers expiring within 7 days.

    Killswitch: ``OFFERS["EXPIRATION_CRON_ENABLED"]`` (env ``EXPIRATION_CRON_ENABLED``).
    """
    from django.conf import settings
    from django.core.mail import send_mail

    if not settings.OFFERS.get("EXPIRATION_CRON_ENABLED", True):
        logger.info("Expiration cron disabled (EXPIRATION_CRON_ENABLED=false)")
        return {"enabled": False}

    today = timezone.now().date()

    # 1. Expire overdue `sent` offers (won/lost/expired are never auto-expired).
    expired_qs = Offer.objects.filter(
        status=OfferStatus.SENT, valid_to__isnull=False, valid_to__lt=today
    )
    expired_count = expired_qs.update(status=OfferStatus.EXPIRED, updated_at=timezone.now())

    # 2. Alert on `sent` offers expiring within the next 7 days.
    soon = Offer.objects.filter(
        status=OfferStatus.SENT,
        valid_to__isnull=False,
        valid_to__gte=today,
        valid_to__lte=today + timedelta(days=7),
    ).order_by("valid_to")

    # Recipients are configured from the UI (Paramètres → Alertes offres), not env.
    from .models import OfferAlertConfig

    recipients = list(OfferAlertConfig.load().recipients or [])
    emailed = 0
    if soon.exists() and recipients:
        base = settings.OFFERS.get("FRONTEND_BASE_URL", "")
        lines = [f"- {o.label} (expire le {o.valid_to}) : {base}/offers/{o.id}" for o in soon]
        body = "Offres arrivant à expiration sous 7 jours :\n\n" + "\n".join(lines)
        emailed = send_mail(
            subject=f"[Syskern] {soon.count()} offre(s) expirent bientôt",
            message=body,
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@syskern.local"),
            recipient_list=recipients,
            fail_silently=True,
        )

    logger.info(
        "Expiration check: %d expired, %d expiring soon, email sent=%s",
        expired_count,
        soon.count(),
        bool(emailed),
    )
    return {"expired": expired_count, "expiring_soon": soon.count(), "emailed": bool(emailed)}
