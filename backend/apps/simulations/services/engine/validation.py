"""Pre-flight checks before running the pricing engine (CDC §6.6)."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal

from apps.core.models import Currency
from apps.products.models import Product

from .errors import missing_fx_rate_message
from .context import to_decimal


def negative_price_errors(
    *,
    sku_code: str,
    pa_net_eur: Decimal,
    pr_eur: Decimal,
    pv_eur: Decimal,
) -> list[str]:
    """Block lines whose PA/PR/PV would be negative (CDC §6.6)."""
    errors: list[str] = []
    if pa_net_eur < 0:
        errors.append(
            f"Produit {sku_code} : PA net négatif ({pa_net_eur} EUR) — "
            f"vérifiez le prix d'achat (PO) et la variation cuivre "
            f"(cuivre actuel inférieur à la base)."
        )
    if pr_eur < 0:
        errors.append(
            f"Produit {sku_code} : prix de revient (PR) négatif ({pr_eur} EUR) — "
            f"calcul incohérent."
        )
    if pv_eur < 0:
        errors.append(
            f"Produit {sku_code} : prix de vente (PV) négatif ({pv_eur} EUR) — "
            f"calcul incohérent."
        )
    return errors


def _add_fx_currencies(needed: set[str], from_ccy: str, to_ccy: str) -> None:
    """Record non-EUR currencies required for an EUR-pivot FX conversion."""
    fr = from_ccy.upper()
    to = to_ccy.upper()
    if fr == to:
        return
    eur = Currency.EUR.value
    if fr != eur:
        needed.add(fr)
    if to != eur:
        needed.add(to)


def _transport_fx_currencies(transport: dict, running_currency: str, needed: set[str]) -> None:
    if transport.get("override_coefficient") is not None:
        return
    t_ccy = (transport.get("currency") or Currency.EUR.value).upper()
    _add_fx_currencies(needed, t_ccy, running_currency)


def _customs_fx_currencies(customs: dict, running_currency: str, needed: set[str]) -> None:
    if customs.get("override_coefficient") is not None:
        return
    if customs.get("rate_pct") is not None:
        return
    global_cost = to_decimal(customs.get("global_cost", 0))
    if global_cost == Decimal(0):
        return
    c_ccy = (customs.get("currency") or Currency.EUR.value).upper()
    _add_fx_currencies(needed, c_ccy, running_currency)


def collect_purchase_fx_currencies(
    *,
    po_currency: str,
    purchase_config: dict,
    copper_indexed: bool,
    copper_weight_declared: bool,
) -> set[str]:
    """Currencies whose ``fx_eur_*`` param must exist for the PA chain."""
    needed: set[str] = set()
    current = po_currency.upper()

    if (
        copper_indexed
        and copper_weight_declared
        and purchase_config.get("copper_variation") is not None
    ):
        _add_fx_currencies(needed, "RMB", current)

    conv = purchase_config.get("currency_conversion") or {}
    target = (conv.get("to_currency") or Currency.EUR.value).upper()
    _add_fx_currencies(needed, current, target)
    current = target

    transports = sorted(
        purchase_config.get("transports", []),
        key=lambda t: t.get("order", 0),
    )
    for transport in transports:
        _transport_fx_currencies(transport, current, needed)

    customs = purchase_config.get("customs")
    if customs is not None:
        _customs_fx_currencies(customs, current, needed)

    return needed


def collect_sale_fx_currencies(*, sale_config: dict) -> set[str]:
    """Currencies whose ``fx_eur_*`` param must exist for the PV chain."""
    needed: set[str] = set()
    current = Currency.EUR.value

    transports = sorted(sale_config.get("transports", []), key=lambda t: t.get("order", 0))
    for transport in transports:
        _transport_fx_currencies(transport, current, needed)

    customs = sale_config.get("customs")
    if customs is not None:
        _customs_fx_currencies(customs, current, needed)

    return needed


def collect_line_fx_currencies(
    *,
    product: Product,
    po_currency: str,
    purchase_config: dict,
    sale_config: dict,
) -> set[str]:
    """All non-EUR currencies that may trigger FX lookups for one line."""
    copper_weight = product.copper_weight_kg_per_unit
    needed = collect_purchase_fx_currencies(
        po_currency=po_currency,
        purchase_config=purchase_config,
        copper_indexed=bool(product.is_copper_indexed),
        copper_weight_declared=copper_weight is not None and copper_weight > 0,
    )
    needed |= collect_sale_fx_currencies(sale_config=sale_config)
    return needed


STANDARD_MARKET_FX_KEYS: tuple[str, ...] = ("fx_eur_usd", "fx_eur_rmb")


def _market_param_filled(market_params: dict, key: str) -> bool:
    val = market_params.get(key)
    return val is not None and val != ""


def collect_preflight_fx_errors(
    market_params: dict,
    *,
    product: Product,
    po_currency: str,
    purchase_config: dict,
    sale_config: dict,
) -> list[str]:
    """All missing FX rates for a line — standard simulation keys + chain-specific."""
    keys: set[str] = set(STANDARD_MARKET_FX_KEYS)
    for ccy in collect_line_fx_currencies(
        product=product,
        po_currency=po_currency,
        purchase_config=purchase_config,
        sale_config=sale_config,
    ):
        if ccy.upper() != Currency.EUR.value:
            keys.add(f"fx_eur_{ccy.lower()}")

    errors: list[str] = []
    for key in sorted(keys):
        if not _market_param_filled(market_params, key):
            errors.append(missing_fx_rate_message(key))
    return errors


def missing_fx_errors(market_params: dict, currencies: Iterable[str]) -> list[str]:
    """User-facing errors for each missing ``fx_eur_<ccy>`` market parameter."""
    errors: list[str] = []
    eur = Currency.EUR.value
    seen: set[str] = set()
    for ccy in sorted({c.upper() for c in currencies}):
        if ccy == eur or ccy in seen:
            continue
        seen.add(ccy)
        key = f"fx_eur_{ccy.lower()}"
        if not _market_param_filled(market_params, key):
            errors.append(missing_fx_rate_message(key))
    return errors
