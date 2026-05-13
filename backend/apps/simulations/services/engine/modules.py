"""Calculation modules — building blocks of the PA and PV chains.

Each module consumes a `PriceWithCurrency` plus the `SimulationContext`
and returns a `CalculationStep`.  Implementations are intentionally tiny
and side-effect free so they can be reordered / re-chained at will (CDC
§6.2 — drag-and-drop UI maps onto a list of `CalculationModule`).

Rounding policy (CDC §6.5, reconciled with the worked example §6.4):
- inside one module we keep full Decimal precision
- at module boundaries we quantize to 4 decimal places (ROUND_HALF_UP)
- the next module reads the quantized output, so chained results match
  the reference example PA = 390.1636 €/km
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from apps.core.models import Currency

from .context import (
    DEC_ONE,
    DEC_ZERO,
    QUANTUM_4DP,
    CalculationStep,
    PriceWithCurrency,
    SimulationContext,
    to_decimal,
)


def quantize(amount: Decimal) -> Decimal:
    """4-decimal commercial rounding (CDC §6.5)."""
    return amount.quantize(QUANTUM_4DP, rounding=ROUND_HALF_UP)


# ─── Module type identifiers (mirror `ModuleType` enum in CDC §6.2) ──────


class ModuleType:
    COPPER_VARIATION = "copper_variation"
    CURRENCY_CONVERSION = "currency_conversion"
    TRANSPORT = "transport"
    CUSTOMS = "customs"
    MARGIN = "margin"


class CalculationModule(ABC):
    type: str

    @abstractmethod
    def apply(
        self, input_price: PriceWithCurrency, ctx: SimulationContext, *, order: int | None = None
    ) -> CalculationStep:
        ...


# ─── COPPER_VARIATION ─────────────────────────────────────────────────────


@dataclass
class CopperVariationModule(CalculationModule):
    """Apply the copper variation if the SKU is copper-indexed.

    Formula:
        variation = (current - base) * copper_weight_kg / 1000
        new_amount = input_amount + variation

    Skipped silently when `product.is_copper_indexed` is false or no
    copper weight is declared.
    """

    type: str = ModuleType.COPPER_VARIATION

    # NB: copper prices live in the simulation context (`market_params`).

    def apply(
        self, input_price: PriceWithCurrency, ctx: SimulationContext, *, order: int | None = None
    ) -> CalculationStep:
        product = ctx.product
        if not product.is_copper_indexed or not product.copper_weight_kg_per_unit:
            return CalculationStep.passthrough(self.type, input_price, order=order)

        base = ctx.copper_base_price(input_price.currency)
        current = ctx.copper_current_price(input_price.currency)
        variation = (current - base) * product.copper_weight_kg_per_unit / Decimal(1000)
        new_amount = quantize(input_price.amount + variation)

        return CalculationStep(
            module_type=self.type,
            input_price=input_price,
            output_price=input_price.with_amount(new_amount),
            metadata={
                "applied": True,
                "copper_base": str(base),
                "copper_current": str(current),
                "copper_weight_kg": str(product.copper_weight_kg_per_unit),
                "variation": str(variation),
            },
            order=order,
        )


# ─── CURRENCY_CONVERSION ──────────────────────────────────────────────────


@dataclass
class CurrencyConversionModule(CalculationModule):
    target_currency: str
    type: str = ModuleType.CURRENCY_CONVERSION

    def apply(
        self, input_price: PriceWithCurrency, ctx: SimulationContext, *, order: int | None = None
    ) -> CalculationStep:
        target = self.target_currency.upper()
        if input_price.currency == target:
            return CalculationStep.passthrough(
                self.type, input_price, reason="same_currency", order=order
            )

        rate = ctx.get_fx_rate(input_price.currency, target)
        new_amount = quantize(input_price.amount * rate)

        return CalculationStep(
            module_type=self.type,
            input_price=input_price,
            output_price=PriceWithCurrency(amount=new_amount, currency=target),
            metadata={
                "from_currency": input_price.currency,
                "to_currency": target,
                "fx_rate": str(rate),
            },
            order=order,
        )


# ─── TRANSPORT ────────────────────────────────────────────────────────────


@dataclass
class TransportModule(CalculationModule):
    """Two modes (CDC §6.3.3):

    - **Detailed** (default): global cost / pallets / pallet_qty → per-unit
      cost, optionally converted to the input currency.
    - **Coefficient** (when `override_coefficient` is set): pure
      multiplicative factor on the input price.
    """

    transport_mode_code: str
    global_cost: Decimal
    currency: str
    pallet_count: int
    from_location: str = ""
    to_location: str = ""
    override_coefficient: Optional[Decimal] = None
    type: str = ModuleType.TRANSPORT

    def apply(
        self, input_price: PriceWithCurrency, ctx: SimulationContext, *, order: int | None = None
    ) -> CalculationStep:
        # Mode 2 — coefficient
        if self.override_coefficient is not None:
            coef = to_decimal(self.override_coefficient)
            new_amount = quantize(input_price.amount * coef)
            return CalculationStep(
                module_type=self.type,
                input_price=input_price,
                output_price=input_price.with_amount(new_amount),
                metadata={
                    "mode": "coefficient",
                    "coefficient": str(coef),
                    "transport_mode": self.transport_mode_code,
                },
                order=order,
            )

        # Mode 1 — detailed
        if self.pallet_count <= 0:
            raise ValueError("Transport.pallet_count must be > 0")
        product = ctx.product
        if not product.pallet_qty or product.pallet_qty <= 0:
            raise ValueError(
                f"Product {product.sku_code} has no `pallet_qty` — cannot allocate transport cost."
            )

        global_cost = to_decimal(self.global_cost)
        cost_per_pallet = global_cost / Decimal(self.pallet_count)
        cost_per_unit_in_transport_currency = cost_per_pallet / Decimal(product.pallet_qty)

        if self.currency.upper() != input_price.currency:
            fx = ctx.get_fx_rate(self.currency, input_price.currency)
            cost_per_unit = cost_per_unit_in_transport_currency * fx
        else:
            cost_per_unit = cost_per_unit_in_transport_currency

        new_amount = quantize(input_price.amount + cost_per_unit)

        return CalculationStep(
            module_type=self.type,
            input_price=input_price,
            output_price=input_price.with_amount(new_amount),
            metadata={
                "mode": "detailed",
                "transport_mode": self.transport_mode_code,
                "global_cost": str(global_cost),
                "global_cost_currency": self.currency.upper(),
                "pallet_count": self.pallet_count,
                "pallet_qty": product.pallet_qty,
                "cost_per_pallet": str(cost_per_pallet),
                "cost_per_unit": str(cost_per_unit),
                "from_location": self.from_location,
                "to_location": self.to_location,
            },
            order=order,
        )


# ─── CUSTOMS ──────────────────────────────────────────────────────────────


@dataclass
class CustomsModule(CalculationModule):
    """Customs duty (CDC §6.3.4).  Detailed mode requires a total quantity
    to spread the global duty across; coefficient mode is a multiplier."""

    global_cost: Decimal = DEC_ZERO
    currency: str = Currency.EUR.value
    total_quantity: Optional[Decimal] = None
    override_coefficient: Optional[Decimal] = None
    type: str = ModuleType.CUSTOMS

    def apply(
        self, input_price: PriceWithCurrency, ctx: SimulationContext, *, order: int | None = None
    ) -> CalculationStep:
        if self.override_coefficient is not None:
            coef = to_decimal(self.override_coefficient)
            new_amount = quantize(input_price.amount * coef)
            return CalculationStep(
                module_type=self.type,
                input_price=input_price,
                output_price=input_price.with_amount(new_amount),
                metadata={"mode": "coefficient", "coefficient": str(coef)},
                order=order,
            )

        global_cost = to_decimal(self.global_cost)
        if global_cost == DEC_ZERO or not self.total_quantity:
            return CalculationStep.passthrough(
                self.type, input_price, reason="no_customs_charge", order=order
            )

        cost_per_unit_in_customs_currency = global_cost / to_decimal(self.total_quantity)
        if self.currency.upper() != input_price.currency:
            fx = ctx.get_fx_rate(self.currency, input_price.currency)
            cost_per_unit = cost_per_unit_in_customs_currency * fx
        else:
            cost_per_unit = cost_per_unit_in_customs_currency

        new_amount = quantize(input_price.amount + cost_per_unit)
        return CalculationStep(
            module_type=self.type,
            input_price=input_price,
            output_price=input_price.with_amount(new_amount),
            metadata={
                "mode": "detailed",
                "global_cost": str(global_cost),
                "global_cost_currency": self.currency.upper(),
                "total_quantity": str(self.total_quantity),
                "cost_per_unit": str(cost_per_unit),
            },
            order=order,
        )


# ─── MARGIN ───────────────────────────────────────────────────────────────


@dataclass
class MarginModule(CalculationModule):
    """Apply a sell-price margin: `price_out = price_in / (1 - rate)`.

    `rate` is expressed as a fraction (0.06 = 6 %).  The CDC defines this
    as a margin on the sell price, not on the buy price, hence the
    division form (CDC §6.3.5).
    """

    rate: Decimal
    label: str = "syskern"
    type: str = ModuleType.MARGIN

    def apply(
        self, input_price: PriceWithCurrency, ctx: SimulationContext, *, order: int | None = None
    ) -> CalculationStep:
        rate = to_decimal(self.rate)
        if rate < DEC_ZERO or rate >= DEC_ONE:
            raise ValueError(
                f"Margin rate must satisfy 0 <= rate < 1 (got {rate}); a "
                f"rate ≥ 1 would make the division impossible."
            )

        denominator = DEC_ONE - rate
        new_amount = quantize(input_price.amount / denominator)
        return CalculationStep(
            module_type=self.type,
            input_price=input_price,
            output_price=input_price.with_amount(new_amount),
            metadata={
                "label": self.label,
                "rate": str(rate),
                "margin_amount": str(new_amount - input_price.amount),
            },
            order=order,
        )
