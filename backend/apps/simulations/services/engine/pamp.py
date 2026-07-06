"""Predictive PAMP + PR (stock/purchase mix) — CDC §6.7."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from apps.core.models import Currency

from .context import DEC_ZERO, CalculationStep, PriceWithCurrency, to_decimal
from .modules import quantize


@dataclass(frozen=True)
class PendingPurchase:
    quantity: Decimal
    price_unit_eur: Decimal


def compute_predictive_pamp(
    *,
    odoo_synced: bool = True,
    stock_quantity: Decimal | None,
    pamp_eur: Decimal | None,
    pending_purchases: Iterable[PendingPurchase] = (),
) -> Decimal | None:
    """Project PAMP forward by averaging the current stock value with the
    value of pending purchases (CDC §6.7.1).

    Sales pending consume stock at the current PAMP and therefore do not
    affect the future PAMP (which is a weighted average of *entries*).

    Returns `None` when:
    - the product was never synced with Odoo (`odoo_synced=False`, i.e.
      `product.odoo_id is None`) — no Odoo stock/PAMP/purchases to project; or
    - no quantity is available to average (stock 0 and no pending purchases).

    In both cases the simulation line must ignore the stock/purchase mix
    entirely (the runner forces `mix_pct = 0`). The result is quantized to
    4 decimal places (CDC §6.5).
    """
    if not odoo_synced:
        return None

    stock_q = to_decimal(stock_quantity) if stock_quantity is not None else DEC_ZERO
    pamp = to_decimal(pamp_eur) if pamp_eur is not None else DEC_ZERO

    stock_value = stock_q * pamp
    purchase_value = DEC_ZERO
    purchase_q = DEC_ZERO
    for p in pending_purchases:
        purchase_value += to_decimal(p.quantity) * to_decimal(p.price_unit_eur)
        purchase_q += to_decimal(p.quantity)

    total_q = stock_q + purchase_q
    if total_q <= DEC_ZERO:
        return None
    return quantize((stock_value + purchase_value) / total_q)


def explain_predictive_pamp(
    *,
    odoo_synced: bool = True,
    stock_quantity: Decimal | None,
    pamp_eur: Decimal | None,
    pending_purchases: Iterable[PendingPurchase] = (),
) -> dict:
    """Audit metadata for the predictive PAMP projection (CDC §6.7.1)."""
    stock_q = to_decimal(stock_quantity) if stock_quantity is not None else DEC_ZERO
    pamp = to_decimal(pamp_eur) if pamp_eur is not None else DEC_ZERO
    purchase_value = DEC_ZERO
    purchase_q = DEC_ZERO
    pending_rows = []
    for p in pending_purchases:
        qty = to_decimal(p.quantity)
        price = to_decimal(p.price_unit_eur)
        purchase_value += qty * price
        purchase_q += qty
        pending_rows.append({"quantity": str(qty), "price_unit_eur": str(price)})
    stock_value = stock_q * pamp
    total_q = stock_q + purchase_q
    base = {
        "odoo_synced": odoo_synced,
        "stock_quantity": str(stock_q),
        "pamp_eur": str(pamp),
        "stock_value_eur": str(stock_value),
        "purchase_quantity": str(purchase_q),
        "purchase_value_eur": str(purchase_value),
        "total_quantity": str(total_q),
        "pending_purchases": pending_rows,
    }
    if not odoo_synced:
        return {**base, "available": False, "reason": "not_synced_odoo"}
    if total_q <= DEC_ZERO:
        return {**base, "available": False, "reason": "no_stock_or_purchases"}
    pamp_predictive = quantize((stock_value + purchase_value) / total_q)
    return {
        **base,
        "available": True,
        "pamp_predictive_eur": str(pamp_predictive),
    }


def build_pr_breakdown(
    *,
    pa_net_eur: Decimal,
    pamp_predictive_eur: Decimal | None,
    pr_eur: Decimal,
    simulation_mix_pct: int,
    line_override: int | None,
    requested_mix_pct: int,
    effective_mix_pct: int,
    odoo_synced: bool,
    stock_quantity: Decimal | None,
    pamp_eur: Decimal | None,
    pending_purchases: Iterable[PendingPurchase] = (),
    mix_warnings: list[str] | None = None,
) -> dict:
    """Build the PR chain breakdown persisted on ``calculation_breakdown.pr``."""
    eur = Currency.EUR.value
    pa_price = PriceWithCurrency(amount=to_decimal(pa_net_eur), currency=eur)
    pr_price = PriceWithCurrency(amount=to_decimal(pr_eur), currency=eur)
    pamp_explain = explain_predictive_pamp(
        odoo_synced=odoo_synced,
        stock_quantity=stock_quantity,
        pamp_eur=pamp_eur,
        pending_purchases=pending_purchases,
    )
    steps: list[CalculationStep] = []

    if pamp_explain.get("available") and pamp_predictive_eur is not None:
        steps.append(
            CalculationStep(
                module_type="predictive_pamp",
                input_price=PriceWithCurrency(amount=to_decimal(pamp_explain["pamp_eur"]), currency=eur),
                output_price=PriceWithCurrency(
                    amount=to_decimal(pamp_predictive_eur), currency=eur
                ),
                metadata={k: v for k, v in pamp_explain.items() if k not in {"available", "reason"}},
                order=1,
                applied=True,
            )
        )
    else:
        steps.append(
            CalculationStep.passthrough(
                "predictive_pamp",
                pa_price,
                reason=str(pamp_explain.get("reason") or "unavailable"),
                order=1,
                metadata=pamp_explain,
            )
        )

    purchase_weight = 100 - effective_mix_pct
    mix_meta: dict = {
        "simulation_mix_pct": simulation_mix_pct,
        "line_override": line_override,
        "requested_mix_pct": requested_mix_pct,
        "effective_mix_pct": effective_mix_pct,
        "purchase_weight_pct": purchase_weight,
        "stock_weight_pct": effective_mix_pct,
        "pa_net_eur": str(pa_net_eur),
        "pamp_predictive_eur": (
            str(pamp_predictive_eur) if pamp_predictive_eur is not None else None
        ),
    }
    if pamp_predictive_eur is not None:
        pamp_d = to_decimal(pamp_predictive_eur)
        pa_d = to_decimal(pa_net_eur)
        ratio = Decimal(effective_mix_pct) / Decimal(100)
        mix_meta["weighted_pamp_component"] = str(quantize(ratio * pamp_d))
        mix_meta["weighted_pa_component"] = str(quantize((Decimal(1) - ratio) * pa_d))

    steps.append(
        CalculationStep(
            module_type="pr_mix",
            input_price=pa_price,
            output_price=pr_price,
            metadata=mix_meta,
            order=2,
            applied=True,
            warnings=mix_warnings or [],
        )
    )

    warnings = mix_warnings or []
    return {
        "steps": [s.to_dict() for s in steps],
        "warnings": warnings,
        "final_amount": str(pr_eur),
        "final_currency": eur,
        "mix_pct": effective_mix_pct,
        "requested_mix_pct": requested_mix_pct,
    }


def compute_pr(
    *,
    pa_net_eur: Decimal,
    pamp_predictive_eur: Decimal | None,
    mix_pct: int,
) -> Decimal:
    """Mix the PA net and the predictive PAMP according to `mix_pct`
    (CDC §6.7.2).

    - `mix_pct = 0`   → PR = PA net (calculation on fresh purchases only)
    - `mix_pct = 100` → PR = PAMP predictive (calculation on existing stock)
    - intermediate    → weighted average

    The result is quantized to 4 decimal places (CDC §6.5).
    """
    if mix_pct < 0 or mix_pct > 100:
        raise ValueError(
            f"Mix stock/achat invalide ({mix_pct}) : la valeur doit être comprise entre 0 et 100 %."
        )

    pa = to_decimal(pa_net_eur)
    if pamp_predictive_eur is None:
        return quantize(pa)

    pamp = to_decimal(pamp_predictive_eur)
    ratio = Decimal(mix_pct) / Decimal(100)
    return quantize((ratio * pamp) + ((Decimal(1) - ratio) * pa))


def resolve_mix_pct(
    *,
    simulation_mix_pct: int,
    line_override: int | None,
    pamp_available: bool = True,
) -> int:
    """CDC §6.7.3 — per-line override beats simulation-wide value.

    When the predictive PAMP is unavailable (`pamp_available=False`), the mix
    is forced to ``0`` regardless of any override (CDC §6.7.1) — the PR then
    rests entirely on the PA net.
    """
    if not pamp_available:
        return 0
    return line_override if line_override is not None else simulation_mix_pct


def resolve_margin_rate(
    *,
    simulation_margin_rate: Decimal,
    line_override: Decimal | None,
) -> Decimal:
    """CDC §6.8.1 — same resolution pattern for the Syskern margin."""
    return to_decimal(line_override if line_override is not None else simulation_margin_rate)
