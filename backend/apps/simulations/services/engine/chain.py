"""Build and run PA / PV chains from the JSON `calculation_chain`
configuration stored on a `Simulation` (CDC §6.2 reference structure).

The runner returns:
- the final `PriceWithCurrency`
- the ordered list of `CalculationStep`s
- a flat `breakdown` dict ready to be persisted to
  `simulation_lines.calculation_breakdown`
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from apps.core.models import Currency

from .context import (
    CalculationStep,
    PriceWithCurrency,
    SimulationContext,
    to_decimal,
)
from .modules import (
    CalculationModule,
    CopperVariationModule,
    CurrencyConversionModule,
    CustomsModule,
    MarginModule,
    TransportModule,
)


def _transport_pallet_count(transport: dict) -> int:
    """Coalesce missing/null pallet_count to 0 (wizard may persist JSON null)."""
    raw = transport.get("pallet_count")
    return int(raw) if raw is not None else 0


@dataclass
class ChainResult:
    final_price: PriceWithCurrency
    steps: list[CalculationStep] = field(default_factory=list)

    @property
    def warnings(self) -> list[str]:
        """All non-fatal diagnostics raised by the chain's steps, in order."""
        return [w for step in self.steps for w in step.warnings]

    def to_breakdown(self) -> dict:
        return {
            "steps": [s.to_dict() for s in self.steps],
            "warnings": self.warnings,
            "final_amount": str(self.final_price.amount),
            "final_currency": self.final_price.currency,
        }


# ─── PURCHASE CHAIN — produces PA net in EUR ─────────────────────────────


def apply_line_pa_coefficient_override(
    chain_config: dict[str, Any],
    *,
    coefficient: Decimal | None,
) -> dict[str, Any]:
    """Pin a per-line PA transport coefficient when set (CDC Feedback 1).

    When ``coefficient`` is ``None``, the simulation chain config is returned
    unchanged — lines without override keep the current behaviour (simulation-
    wide detailed transports or chain coefficient).

    When set, transport legs are replaced by a single COEF leg for this line
    only, as an alternative to detailed transport or the global coefficient.
    """
    if coefficient is None:
        return chain_config

    coef = to_decimal(coefficient)
    if coef <= Decimal("0"):
        return chain_config

    coef_s = str(coef)
    return {
        **chain_config,
        "transport_pricing": "coefficient",
        "transport_coefficient": coef_s,
        "transports": [
            {
                "order": 1,
                "transport_mode_code": "COEF",
                "global_cost": "0",
                "currency": Currency.EUR.value,
                "pallet_count": 0,
                "from_location": "",
                "to_location": "",
                "override_coefficient": coef_s,
            }
        ],
    }


def build_purchase_chain_config_for_line(
    purchase_config: dict[str, Any],
    *,
    symea_margin_rate: Decimal,
    pa_coefficient_override: Decimal | None = None,
) -> dict[str, Any]:
    """Merge simulation-wide PA config with optional per-line coefficient override."""
    base = {
        **purchase_config,
        "symea_margin": purchase_config.get("symea_margin")
        or {"rate": str(symea_margin_rate), "position": "after_transports"},
    }
    return apply_line_pa_coefficient_override(base, coefficient=pa_coefficient_override)


def build_purchase_modules(chain_config: dict) -> list[CalculationModule]:
    """Build the ordered PA chain from a JSON config.

    Expected shape (CDC §6.2):
        {
          "copper_variation": {...},
          "currency_conversion": {"to_currency": "EUR"},
          "transports": [{"order": 1, ...}, {"order": 2, ...}],
          "customs": {...},
          "symea_margin": {"rate": "0.06", "position": "after_transports"}
        }
    """
    modules: list[CalculationModule] = []

    # 1. Copper variation (the module itself reads context.market_params,
    #    so the JSON block is only a marker that it's enabled).
    if chain_config.get("copper_variation") is not None:
        modules.append(CopperVariationModule())

    # 2. Currency conversion to the pivot currency.
    conv = chain_config.get("currency_conversion") or {}
    target = (conv.get("to_currency") or Currency.EUR.value).upper()
    modules.append(CurrencyConversionModule(target_currency=target))

    # 3. Transports — ordered by `order` field, ascending.
    transports = sorted(
        chain_config.get("transports", []),
        key=lambda t: t.get("order", 0),
    )

    # 4. Customs (single).
    customs = chain_config.get("customs")

    # 5. Margin Symea (configurable position).
    margin = chain_config.get("symea_margin") or {}
    margin_position = margin.get("position", "after_transports")
    margin_mod = MarginModule(rate=to_decimal(margin.get("rate", "0.06")), label="symea")

    if margin_position == "before_transports":
        modules.append(margin_mod)

    for t in transports:
        modules.append(
            TransportModule(
                transport_mode_code=t.get("transport_mode_code", ""),
                global_cost=to_decimal(t.get("global_cost", 0)),
                currency=(t.get("currency") or "EUR").upper(),
                pallet_count=_transport_pallet_count(t),
                from_location=t.get("from_location", ""),
                to_location=t.get("to_location", ""),
                override_coefficient=(
                    to_decimal(t["override_coefficient"])
                    if t.get("override_coefficient") is not None
                    else None
                ),
            )
        )

    if customs is not None:
        modules.append(
            CustomsModule(
                global_cost=to_decimal(customs.get("global_cost", 0)),
                currency=(customs.get("currency") or "EUR").upper(),
                total_quantity=(
                    to_decimal(customs["total_quantity"])
                    if customs.get("total_quantity") is not None
                    else None
                ),
                rate_pct=(
                    to_decimal(customs["rate_pct"]) if customs.get("rate_pct") is not None else None
                ),
                override_coefficient=(
                    to_decimal(customs["override_coefficient"])
                    if customs.get("override_coefficient") is not None
                    else None
                ),
            )
        )

    if margin_position != "before_transports":
        modules.append(margin_mod)

    return modules


# ─── SALE CHAIN — produces PV from PR ─────────────────────────────────────


def build_sale_modules(
    chain_config: dict, *, syskern_margin_rate: Decimal
) -> list[CalculationModule]:
    """Build the PV chain (CDC §6.8, revised per CDC Feedback 1).

    Expected shape:
        {
          "transports": [...],
          "customs": {...},
          "syskern_margin": {"rate": "0.20"}  # optional override
        }

    `syskern_margin_rate` is the fallback when the chain config does not
    pin its own rate — usually `simulation.syskern_margin_rate`.

    **Margin position (CDC Feedback 1):** the Syskern margin is applied on the
    PR **before** the sale-side transports and customs. This is a fixed,
    hard-coded position (not a drag-and-drop module, not user-configurable) —
    deviation from the Annexe Technique which documented the margin last. See
    `docs/agent/decisions.md`.
    """
    modules: list[CalculationModule] = []

    # 1. Syskern margin — fixed position, applied on the PR first.
    rate = chain_config.get("syskern_margin", {}).get("rate")
    final_rate = to_decimal(rate) if rate is not None else to_decimal(syskern_margin_rate)
    modules.append(MarginModule(rate=final_rate, label="syskern"))

    # 2. Sale-side transports, then customs, on top of the margined price.
    transports = sorted(chain_config.get("transports", []), key=lambda t: t.get("order", 0))
    for t in transports:
        modules.append(
            TransportModule(
                transport_mode_code=t.get("transport_mode_code", ""),
                global_cost=to_decimal(t.get("global_cost", 0)),
                currency=(t.get("currency") or "EUR").upper(),
                pallet_count=_transport_pallet_count(t),
                from_location=t.get("from_location", ""),
                to_location=t.get("to_location", ""),
                override_coefficient=(
                    to_decimal(t["override_coefficient"])
                    if t.get("override_coefficient") is not None
                    else None
                ),
            )
        )

    customs = chain_config.get("customs")
    if customs is not None:
        modules.append(
            CustomsModule(
                global_cost=to_decimal(customs.get("global_cost", 0)),
                currency=(customs.get("currency") or "EUR").upper(),
                total_quantity=(
                    to_decimal(customs["total_quantity"])
                    if customs.get("total_quantity") is not None
                    else None
                ),
                rate_pct=(
                    to_decimal(customs["rate_pct"]) if customs.get("rate_pct") is not None else None
                ),
                override_coefficient=(
                    to_decimal(customs["override_coefficient"])
                    if customs.get("override_coefficient") is not None
                    else None
                ),
            )
        )

    return modules


# ─── Runner ───────────────────────────────────────────────────────────────


def run_chain(
    modules: Iterable[CalculationModule],
    *,
    starting_price: PriceWithCurrency,
    context: SimulationContext,
) -> ChainResult:
    """Apply each module in order and accumulate steps."""
    steps: list[CalculationStep] = []
    current = starting_price
    for idx, module in enumerate(modules, start=1):
        step = module.apply(current, context, order=idx)
        steps.append(step)
        current = step.output_price
    return ChainResult(final_price=current, steps=steps)
