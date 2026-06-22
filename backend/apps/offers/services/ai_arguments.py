"""OpenAI argument generation for project offers (CDC §7.3.4 / §7.6.1).

Produces three structured sales arguments — technical, commercial, logistic —
from the project context and the user's free-form instructions (CDC: free IA
instructions, no automatic segmentation). Output is requested directly in the
offer language; Gamma handles any further translation (CDC §10.4).

Failure is non-fatal: :func:`generate_arguments` returns ``None`` so the offer
is still generated, without AI copy + a warning (CDC §7.6.3).
"""

from __future__ import annotations

import hashlib
import json
import logging

from .openai_client import OpenAIClient, OpenAIError

logger = logging.getLogger("apps.offers.ai_arguments")

_LANG_NAME = {"fr": "français", "en": "English", "es": "español"}
_KEYS = ("technical", "commercial", "logistic")


def instructions_hash(simulation_id: str, user_instructions: str, language: str) -> str:
    """Stable key for caching arguments across retries (CDC AC)."""
    raw = f"{simulation_id}|{language}|{user_instructions}".encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def _build_user_prompt(
    products: list[dict],
    client_info: dict,
    project_name: str,
    user_instructions: str,
    language: str,
) -> str:
    lang_name = _LANG_NAME.get(language, "français")
    product_lines = "\n".join(
        f"- {p.get('sku_code', '')} · {p.get('name', '')}"
        + (f" (gamme {p['range']})" if p.get("range") else "")
        for p in products[:80]  # cap context size
    )
    return (
        f"Projet : {project_name}\n"
        f"Client : {client_info.get('name', '—')}"
        + (f" (segment {client_info['segment']})" if client_info.get("segment") else "")
        + "\n\n"
        f"Produits proposés :\n{product_lines}\n\n"
        f"Instructions de l'utilisateur :\n{user_instructions or '(aucune)'}\n\n"
        f"Rédige en {lang_name} trois argumentaires distincts pour ce devis, chacun de "
        f"200 à 400 mots : un argumentaire TECHNIQUE, un COMMERCIAL et un LOGISTIQUE.\n"
        f'Réponds STRICTEMENT en JSON : {{"technical": "...", "commercial": "...", '
        f'"logistic": "..."}}.'
    )


def generate_arguments(
    *,
    products: list[dict],
    client_info: dict,
    project_name: str,
    user_instructions: str,
    language: str,
    client: OpenAIClient | None = None,
) -> dict | None:
    """Return ``{technical, commercial, logistic}`` strings, or None on failure."""
    oai = client or OpenAIClient()
    system = (
        "Tu es un ingénieur avant-vente Syskern (câblage réseau, fibre, racks). "
        "Tu rédiges des argumentaires de devis B2B, factuels et convaincants. "
        "Tu ne mentionnes jamais de prix."
    )
    user = _build_user_prompt(products, client_info, project_name, user_instructions, language)
    try:
        data = oai.generate_json(system=system, user=user, temperature=0.7, max_tokens=800)
    except OpenAIError as exc:
        logger.warning("OpenAI argument generation failed, offer continues without copy: %s", exc)
        return None

    # Keep only the expected keys; coerce to str. Reject if all empty.
    result = {k: str(data.get(k, "")).strip() for k in _KEYS}
    if not any(result.values()):
        logger.warning("OpenAI returned empty arguments: %s", json.dumps(data)[:200])
        return None
    return result
