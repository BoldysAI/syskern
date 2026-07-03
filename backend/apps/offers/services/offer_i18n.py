"""Target-language resolution for offer content (CDC §10.5.1).

When an offer is generated in a target language, product descriptions are used
in that language when present, with an explicit fallback to French. The
`fallback_used` flag is surfaced so the generation can log which products were
emitted in FR while another language was requested.
"""

from __future__ import annotations

from apps.products.models import Product

# Fields resolved for offer content (marketing + technical descriptions).
DESCRIPTION_FIELDS = ("description_marketing", "description_technical")


def resolve_product_description(product: Product, target_lang: str, field: str) -> tuple[str, bool]:
    """Return ``(text, fallback_used)`` for one description field (CDC §10.5.1).

    Uses the target language when present and non-empty, otherwise falls back to
    French (``fallback_used=True``). Returns ``("", False)`` when neither exists.
    """
    descriptions = getattr(product, field, None) or {}
    target = (descriptions.get(target_lang) or "").strip()
    if target:
        return target, False
    fr = (descriptions.get("fr") or "").strip()
    if fr:
        return fr, True
    return "", False


def resolve_product_designation(product: Product, target_lang: str) -> tuple[str, bool]:
    """Human-readable product label for offer exports (CDC §10.5.1).

    Prefer ``description_marketing`` in the target language (FR fallback), then
    ``name`` / ``sku_code``. Used for Excel « Désignation » and project quotes.
    """
    text, fallback = resolve_product_description(product, target_lang, "description_marketing")
    if text:
        return text, fallback
    name = (product.name or "").strip()
    if name:
        return name, target_lang != "fr"
    return product.sku_code, False


def products_missing_language(
    products: list[Product], target_lang: str, fields: tuple[str, ...] = DESCRIPTION_FIELDS
) -> list[Product]:
    """Products with FR content but no target-language content (CDC §10.5.1).

    These are the products that would fall back to FR if the offer were generated
    in ``target_lang`` — the pre-generation warning lists them so the user can
    translate before generating.
    """
    if target_lang == "fr":
        return []
    missing: list[Product] = []
    for product in products:
        for field in fields:
            descriptions = getattr(product, field, None) or {}
            fr = (descriptions.get("fr") or "").strip()
            target = (descriptions.get(target_lang) or "").strip()
            if fr and not target:
                missing.append(product)
                break
    return missing
