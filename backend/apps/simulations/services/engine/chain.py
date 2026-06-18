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


@dataclass
class ChainResult:
    final_price: PriceWithCurrency
    steps: list[CalculationStep] = field(default_factory=list)

    def to_breakdown(self) -> dict:
        return {
            "steps": [s.to_dict() for s in self.steps],
            "final_amount": str(self.final_price.amount),
            "final_currency": self.final_price.currency,
        }


# ─── PURCHASE CHAIN — produces PA net in EUR ─────────────────────────────


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
                pallet_count=int(t.get("pallet_count", 0)),
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
    """Build the PV chain (CDC §6.8).

    Expected shape:
        {
          "transports": [...],
          "customs": {...},
          "syskern_margin": {"rate": "0.20"}  # optional override
        }

    `syskern_margin_rate` is the fallback when the chain config does not
    pin its own rate — usually `simulation.syskern_margin_rate`.
    """
    modules: list[CalculationModule] = []

    transports = sorted(chain_config.get("transports", []), key=lambda t: t.get("order", 0))
    for t in transports:
        modules.append(
            TransportModule(
                transport_mode_code=t.get("transport_mode_code", ""),
                global_cost=to_decimal(t.get("global_cost", 0)),
                currency=(t.get("currency") or "EUR").upper(),
                pallet_count=int(t.get("pallet_count", 0)),
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
                override_coefficient=(
                    to_decimal(customs["override_coefficient"])
                    if customs.get("override_coefficient") is not None
                    else None
                ),
            )
        )

    rate = chain_config.get("syskern_margin", {}).get("rate")
    final_rate = to_decimal(rate) if rate is not None else to_decimal(syskern_margin_rate)
    modules.append(MarginModule(rate=final_rate, label="syskern"))
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
