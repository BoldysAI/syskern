"""Predictive PAMP + PR (stock/purchase mix) — CDC §6.7."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from .context import DEC_ZERO, to_decimal
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
        raise ValueError(f"mix_pct must be in [0, 100], got {mix_pct}")

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
