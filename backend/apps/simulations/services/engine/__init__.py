"""Pricing engine — deterministic, framework-free.

Public surface:

    from apps.simulations.services.engine import (
        PriceWithCurrency, SimulationContext, ProductView,
        build_purchase_modules, build_sale_modules, run_chain,
        compute_predictive_pamp, compute_pr,
        resolve_mix_pct, resolve_margin_rate, PendingPurchase,
        quantize,
    )
"""

from .chain import (
    ChainResult,
    build_purchase_modules,
    build_sale_modules,
    run_chain,
)
from .context import (
    CalculationStep,
    PriceWithCurrency,
    ProductView,
    SimulationContext,
    to_decimal,
)
from .modules import (
    CalculationModule,
    CopperVariationModule,
    CurrencyConversionModule,
    CustomsModule,
    MarginModule,
    ModuleType,
    TransportModule,
    quantize,
)
from .pamp import (
    PendingPurchase,
    compute_pr,
    compute_predictive_pamp,
    resolve_margin_rate,
    resolve_mix_pct,
)

__all__ = [
    "CalculationModule",
    "CalculationStep",
    "ChainResult",
    "CopperVariationModule",
    "CurrencyConversionModule",
    "CustomsModule",
    "MarginModule",
    "ModuleType",
    "PendingPurchase",
    "PriceWithCurrency",
    "ProductView",
    "SimulationContext",
    "TransportModule",
    "build_purchase_modules",
    "build_sale_modules",
    "compute_pr",
    "compute_predictive_pamp",
    "quantize",
    "resolve_margin_rate",
    "resolve_mix_pct",
    "run_chain",
    "to_decimal",
]
