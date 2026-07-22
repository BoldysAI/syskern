"""Project-offer generation: OpenAI arguments + Gamma quote (CDC §7.3).

Two entry points used by the Celery task:
  * :func:`create_project_offer` — persists the Offer + OfferLines (with the
    per-SKU quantities). Pure DB, always succeeds for a valid simulation.
  * :func:`run_generation` — calls OpenAI (arguments) then Gamma (the 5-section
    quote) and stores the result on the offer. OpenAI failure is non-fatal
    (offer keeps generating, no copy + warning); Gamma failure marks the offer
    ``generation_status=error`` so the UI can retry (CDC §7.6.3).

``run_generation`` reads everything it needs from the offer + its lines, so the
retry path (regenerate an existing offer) reuses it with no extra arguments.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from pathlib import Path

from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.utils import timezone

from apps.clients.models import Client
from apps.simulations.models import Simulation

from ..models import (
    ExportFormat,
    GenerationStatus,
    Offer,
    OfferLine,
    OfferType,
)
from .ai_arguments import generate_arguments, instructions_hash
from .gamma import GammaClient
from .offer_i18n import resolve_product_designation

logger = logging.getLogger("apps.offers.project_generator")

# Cached Gamma HTML snapshots live alongside the Excel exports volume.
SNAPSHOT_DIR = Path("/tmp/syskern_exports/offers/gamma-cached")

# The 5 fixed devis sections (CDC §7.3.4 / ticket). Keys map to sections_config.
SECTION_TITLES = {
    "cover": {"fr": "Couverture", "en": "Cover", "es": "Portada"},
    "presentation": {
        "fr": "Présentation Syskern",
        "en": "About Syskern",
        "es": "Presentación Syskern",
    },
    "pricing": {"fr": "Tableau de prix", "en": "Pricing", "es": "Precios"},
    "arguments": {"fr": "Argumentaires", "en": "Value proposition", "es": "Argumentario"},
    "conditions": {"fr": "Conditions", "en": "Terms", "es": "Condiciones"},
}
DEFAULT_SECTIONS = dict.fromkeys(SECTION_TITLES, True)


def snapshot_path(offer_id) -> Path:
    return SNAPSHOT_DIR / f"{offer_id}.html"


# ── Offer + lines (DB) ───────────────────────────────────────────────────────


def create_project_offer(
    *,
    simulation: Simulation,
    client: Client,
    project_name: str,
    quantities: dict[str, float] | None = None,
    language: str,
    expiration_date: date | None,
    ai_instructions: str,
    sections_config: dict | None = None,
    attached_document_ids: list | None = None,
    gamma_template: str = "",
) -> Offer:
    """Create the project Offer + OfferLines for a single client.

    Quantities are inherited from the simulation lines (CDC Feedback 1 — the
    quantity now lives on the project simulation, not on the offer). A legacy
    ``quantities`` dict (sku -> qty) is still honoured when provided for
    backward compatibility; otherwise each offer line reuses its simulation
    line quantity (defaulting to 1 when the line has none)."""
    offer = Offer.objects.create(
        simulation=simulation,
        offer_type=OfferType.PROJECT,
        label=project_name,
        client_ids=[str(client.id)],
        project_name=project_name,
        project_info={"sections_config": sections_config or DEFAULT_SECTIONS},
        currency="EUR",  # project offers priced in the EUR pivot (CDC §6.8.2)
        incoterm="EXW",
        language=language,
        valid_from=timezone.now().date(),
        valid_to=expiration_date,
        export_format=ExportFormat.DEVIS_GAMMA,
        gamma_template=gamma_template or "",
        ai_instructions=ai_instructions,
        attached_document_ids=attached_document_ids or [],
        generation_status=GenerationStatus.PENDING,
        version_number=1,
    )

    lines_by_sku = {
        ln.product.sku_code: ln for ln in simulation.lines.select_related("product").all()
    }
    if quantities:
        # Legacy path — explicit per-SKU quantities.
        items: list[tuple[str, Decimal]] = [
            (sku, Decimal(str(qty))) for sku, qty in quantities.items()
        ]
    else:
        # Inherit quantities from the simulation lines (CDC Feedback 1).
        items = [
            (ln.product.sku_code, ln.quantity if ln.quantity is not None else Decimal(1))
            for ln in lines_by_sku.values()
        ]

    order = 0
    offer_lines = []
    for sku, qty in items:
        sim_line = lines_by_sku.get(sku)
        if sim_line is None:
            continue  # SKU not in the simulation — skip (validated upstream)
        offer_lines.append(
            OfferLine(
                offer=offer,
                product=sim_line.product,
                simulation_line=sim_line,
                final_price=sim_line.pv_eur or Decimal(0),
                quantity=Decimal(str(qty)),
                display_order=order,
            )
        )
        order += 1
    OfferLine.objects.bulk_create(offer_lines)
    return offer


# ── Gamma payload ──────────────────────────────────────────────────────────


def _price_table_markdown(offer: Offer, lang: str) -> str:
    headers = {
        "fr": ("Réf.", "Désignation", "Qté", "Prix unit.", "Total"),
        "en": ("SKU", "Name", "Qty", "Unit price", "Total"),
        "es": ("Ref.", "Designación", "Cant.", "Precio unit.", "Total"),
    }.get(lang, ("Réf.", "Désignation", "Qté", "Prix unit.", "Total"))
    rows = [f"| {' | '.join(headers)} |", "| --- | --- | --- | --- | --- |"]
    cur = offer.currency
    grand_total = Decimal(0)
    for ln in offer.lines.select_related("product").all():
        qty = ln.quantity or Decimal(0)
        total = (ln.final_price or Decimal(0)) * qty
        grand_total += total
        designation, _ = resolve_product_designation(ln.product, lang)
        rows.append(
            f"| {ln.product.sku_code} | {designation} | {qty:g} | "
            f"{ln.final_price:.2f} {cur} | {total:.2f} {cur} |"
        )
    # Total général de l'offre (FEEDBACK 2) : le client voyait les totaux par
    # ligne mais devait les additionner lui-même.
    total_label = {"fr": "Total général", "en": "Grand total", "es": "Total general"}.get(
        lang, "Total général"
    )
    rows.append(f"| **{total_label}** |  |  |  | **{grand_total:.2f} {cur}** |")
    return "\n".join(rows)


def build_gamma_payload(
    offer: Offer, *, arguments: dict | None, image_source: str = "aiGenerated"
) -> dict:
    """Assemble the Gamma `POST /v1.0/generations` body for the 5-section quote."""
    lang = offer.language
    sections = (offer.project_info or {}).get("sections_config") or DEFAULT_SECTIONS
    title = SECTION_TITLES

    parts: list[str] = [f"# {offer.project_name}"]
    if sections.get("cover", True):
        parts.append(f"## {title['cover'][lang]}\n{offer.project_name}")
    if sections.get("presentation", True):
        parts.append(
            f"## {title['presentation'][lang]}\n"
            "Syskern (groupe Symea) — solutions de câblage réseau, fibre optique et racks."
        )
    if sections.get("pricing", True):
        parts.append(f"## {title['pricing'][lang]}\n{_price_table_markdown(offer, lang)}")
    if sections.get("arguments", True) and arguments:
        body = "\n\n".join(f"### {k.capitalize()}\n{v}" for k, v in arguments.items() if v)
        parts.append(f"## {title['arguments'][lang]}\n{body}")
    if sections.get("conditions", True):
        validity = f" Validité : {offer.valid_to}." if offer.valid_to else ""
        parts.append(
            f"## {title['conditions'][lang]}\nConditions générales de vente Syskern.{validity}"
        )

    # Separate sections with a `---` rule: Gamma's `inputTextBreaks` splits a
    # new card on each break, so the deck maps 1:1 to our sections (a long price
    # table stays inside its own card) — deterministic count, exportable to PDF.
    input_text = "\n\n---\n\n".join(parts)
    num_cards = max(1, sum(1 for v in sections.values() if v))

    payload: dict = {
        "inputText": input_text,
        "textMode": "preserve",  # keep our structured devis content verbatim
        "format": "presentation",
        # Split cards on our own markdown section breaks (each `##` = one card)
        # instead of letting Gamma auto-split. Keeps the deck to our N sections
        # so a long price table stays on a single card and the PDF auto-export
        # doesn't fail with `deck_too_large` (Gamma best practice for preserve).
        "cardSplit": "inputTextBreaks",
        "numCards": num_cards,
        "title": offer.project_name,
        "exportAs": "pdf",
        # `amount` is ignored in preserve mode (Gamma keeps our text as-is), so
        # we send only the target language.
        "textOptions": {"language": lang},
        "imageOptions": {"source": image_source},
    }
    if offer.ai_instructions:
        payload["additionalInstructions"] = offer.ai_instructions[:5000]
    template_id = _resolve_gamma_template(offer)
    if template_id:
        payload["themeId"] = template_id
    return payload


def _resolve_gamma_template(offer: Offer) -> str:
    """Gamma template id for this offer (FEEDBACK 1, CDC §7.7.2).

    Maps the offer's chosen layout (``distributeur``/``factoring``/``export``)
    to its configured id, falling back to the default project template when the
    choice is empty or that specific id is not configured yet (client hasn't
    provided it). So the selector works today with a single configured id.
    """
    gamma = settings.GAMMA
    choice = (offer.gamma_template or "").lower()
    specific = gamma.get("TEMPLATES", {}).get(choice) if choice else ""
    return specific or gamma.get("TEMPLATE_ID_DEVIS_PROJET") or ""


# ── Generation (external calls) ──────────────────────────────────────────────


def _resolve_arguments(offer: Offer) -> tuple[dict | None, bool]:
    """Return (arguments, used_cache). Reuses cached args when instructions match."""
    sim_id = str(offer.simulation_id)
    h = instructions_hash(sim_id, offer.ai_instructions, offer.language)
    cached = offer.ai_arguments or {}
    if cached.get("hash") == h and any(
        cached.get(k) for k in ("technical", "commercial", "logistic")
    ):
        return {k: cached.get(k, "") for k in ("technical", "commercial", "logistic")}, True

    products = [
        {
            "sku_code": ln.product.sku_code,
            "name": resolve_product_designation(ln.product, offer.language)[0],
            "range": ln.product.range,
        }
        for ln in offer.lines.select_related("product").all()
    ]
    client = Client.objects.filter(id__in=offer.client_ids).first()
    client_info = {"name": client.name if client else "", "segment": getattr(client, "segment", "")}
    args = generate_arguments(
        products=products,
        client_info=client_info,
        project_name=offer.project_name,
        user_instructions=offer.ai_instructions,
        language=offer.language,
    )
    if args is not None:
        offer.ai_arguments = {"hash": h, **args}
        offer.save(update_fields=["ai_arguments", "updated_at"])
    return args, False


def _mark_generation_error(offer: Offer, message: str) -> Offer:
    """Persist a terminal ERROR state so the UI stops polling (CDC §7.6.3)."""
    offer.generation_status = GenerationStatus.ERROR
    offer.generation_error = (message or "Erreur de génération.")[:2000]
    offer.save(update_fields=["generation_status", "generation_error", "updated_at"])
    return offer


def run_generation(offer: Offer, *, gamma_client: GammaClient | None = None) -> Offer:
    """Generate the Gamma quote for *offer*. Idempotent / retry-safe.

    Guarantees a **terminal** status: on ANY failure (Gamma, OpenAI, soft time
    limit, or any unexpected exception) the offer is saved as ``error`` — it is
    never left stuck in ``generating``, so the front stops polling (CDC §7.6.3).
    A worker hard-kill is caught out-of-band by ``offers.reap_stuck_generations``.
    """
    offer.generation_status = GenerationStatus.GENERATING
    offer.generation_error = ""
    offer.save(update_fields=["generation_status", "generation_error", "updated_at"])

    gamma = gamma_client or GammaClient()
    try:
        arguments, _ = _resolve_arguments(offer)
        payload = build_gamma_payload(offer, arguments=arguments)
        result = gamma.generate_and_wait(payload)
    except SoftTimeLimitExceeded:
        _mark_generation_error(offer, "La génération a dépassé le temps imparti.")
        raise  # surface the timeout to Celery
    except Exception as exc:  # noqa: BLE001 — any failure must yield a terminal state
        logger.warning("Gamma generation failed for offer %s: %s", offer.id, exc)
        return _mark_generation_error(offer, str(exc))

    # Success — store the Gamma identifiers.
    offer.gamma_document_id = result.generation_id
    offer.generated_file_url = result.gamma_url
    info = dict(offer.project_info or {})
    info["gamma_export_url"] = result.export_url
    offer.project_info = info
    offer.generation_status = GenerationStatus.READY
    offer.generation_error = ""
    offer.save(
        update_fields=[
            "gamma_document_id",
            "generated_file_url",
            "project_info",
            "generation_status",
            "generation_error",
            "updated_at",
        ]
    )

    # Best-effort HTML snapshot — must never flip a READY offer back to error.
    try:
        html = gamma.fetch_public_html(result.gamma_url)
        if html:
            SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
            snapshot_path(offer.id).write_text(html, encoding="utf-8")
    except Exception:  # noqa: BLE001
        logger.info("Gamma HTML snapshot failed for offer %s (non-fatal)", offer.id)
    return offer
