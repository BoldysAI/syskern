"""Domain primitives used throughout the pricing engine.

These types are intentionally framework-free (no Django ORM dependency)
so the engine can be unit-tested with plain dataclass inputs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from apps.core.models import Currency

DEC_ZERO = Decimal(0)
DEC_ONE = Decimal(1)
QUANTUM_4DP = Decimal("0.0001")


def to_decimal(value: Any) -> Decimal:
    """Convert ints, floats, strings, Decimals to Decimal without losing
    precision.  Floats are funneled through `str()` to dodge binary FP."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int | str):
        return Decimal(value)
    return Decimal(str(value))


def fx_rate(from_currency: str, to_currency: str, market_params: dict) -> Decimal:
    """EUR-pivot FX coefficient — ``amount_in_to = amount_in_from * rate`` (CDC §6.3.2).

    Rates in ``market_params`` are entered as ``fx_eur_<curr>`` ("how many
    <curr> for 1 EUR"); non-EUR pairs are derived via EUR. Raises ``ValueError``
    if a required ``fx_eur_<curr>`` rate is missing.

    Shared by the pricing engine (:meth:`SimulationContext.get_fx_rate`) and the
    offer generator, which converts the EUR pivot PV to the sale currency at
    generation time (CDC §6.8.2 / §7.2.5).
    """
    fr = from_currency.upper()
    to = to_currency.upper()
    if fr == to:
        return DEC_ONE
    eur = Currency.EUR.value

    def _eur_to(currency: str) -> Decimal:
        key = f"fx_eur_{currency.lower()}"
        if key not in market_params:
            raise ValueError(f"Missing FX rate `{key}` in market parameters.")
        return to_decimal(market_params[key])

    if fr == eur:
        return _eur_to(to)
    if to == eur:
        return DEC_ONE / _eur_to(fr)
    return _eur_to(to) / _eur_to(fr)


@dataclass(frozen=True)
class PriceWithCurrency:
    """A price + its currency.  Immutable so module boundaries stay clean."""

    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        # Normalise the currency to upper-case for safe comparisons.
        object.__setattr__(self, "currency", self.currency.upper())

    def with_amount(self, amount: Decimal) -> PriceWithCurrency:
        return PriceWithCurrency(amount=amount, currency=self.currency)

    def with_currency(self, amount: Decimal, currency: str) -> PriceWithCurrency:
        return PriceWithCurrency(amount=amount, currency=currency)


@dataclass(frozen=True)
class ProductView:
    """A subset of `apps.products.models.Product` that the engine cares
    about.  We use a plain dataclass instead of the Django model so the
    engine remains testable without database fixtures and so simulation
    snapshots can be replayed verbatim."""

    sku_code: str
    is_copper_indexed: bool
    copper_weight_kg_per_unit: Decimal | None
    pallet_qty: int | None
    base_unit: str = "unit"

    @classmethod
    def from_model(cls, product) -> ProductView:
        return cls(
            sku_code=product.sku_code,
            is_copper_indexed=bool(product.is_copper_indexed),
            copper_weight_kg_per_unit=(
                to_decimal(product.copper_weight_kg_per_unit)
                if product.copper_weight_kg_per_unit is not None
                else None
            ),
            pallet_qty=product.pallet_qty,
            base_unit=product.base_unit,
        )

    @classmethod
    def from_snapshot(cls, snap: dict) -> ProductView:
        cw = snap.get("copper_weight_kg_per_unit")
        return cls(
            sku_code=snap.get("sku_code", ""),
            is_copper_indexed=bool(snap.get("is_copper_indexed", False)),
            copper_weight_kg_per_unit=to_decimal(cw) if cw is not None else None,
            pallet_qty=snap.get("pallet_qty"),
            base_unit=snap.get("base_unit", "unit"),
        )


@dataclass
class SimulationContext:
    """Per-simulation context: market parameters + the SKU currently being
    priced.  Module instances read FX rates and copper prices from here."""

    product: ProductView
    market_params: dict

    def get_fx_rate(self, from_currency: str, to_currency: str) -> Decimal:
        """Multiplicative coefficient — `amount_in_to = amount_in_from * rate`.

        Delegates to the module-level :func:`fx_rate` so the engine and the
        offer generator share one EUR-pivot implementation (CDC §6.3.2).
        """
        return fx_rate(from_currency, to_currency, self.market_params)

    def copper_base_price(self, currency: str = "RMB") -> Decimal:
        return to_decimal(self.market_params.get(f"copper_base_price_{currency.lower()}", DEC_ZERO))

    def copper_current_price(self, currency: str = "RMB") -> Decimal:
        return to_decimal(
            self.market_params.get(f"copper_current_price_{currency.lower()}", DEC_ZERO)
        )


@dataclass(frozen=True)
class CalculationStep:
    """One module's contribution to a chain — fully self-describing for
    audit / replay (`simulation_lines.calculation_breakdown.steps[i]`)."""

    module_type: str
    input_price: PriceWithCurrency
    output_price: PriceWithCurrency
    metadata: dict = field(default_factory=dict)
    order: int | None = None
    applied: bool = True

    @classmethod
    def passthrough(
        cls,
        module_type: str,
        price: PriceWithCurrency,
        *,
        reason: str = "not_applicable",
        order: int | None = None,
    ) -> CalculationStep:
        return cls(
            module_type=module_type,
            input_price=price,
            output_price=price,
            metadata={"applied": False, "reason": reason},
            order=order,
            applied=False,
        )

    def to_dict(self) -> dict:
        return {
            "module": self.module_type,
            "order": self.order,
            "applied": self.applied,
            "input_price": {
                "amount": str(self.input_price.amount),
                "currency": self.input_price.currency,
            },
            "output_price": {
                "amount": str(self.output_price.amount),
                "currency": self.output_price.currency,
            },
            "metadata": self.metadata,
        }
