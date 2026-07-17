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
    apply_line_pa_coefficient_override,
    build_purchase_chain_config_for_line,
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
    build_pr_breakdown,
    compute_pr,
    compute_predictive_pamp,
    compute_quantity_driven_mix_pct,
    explain_predictive_pamp,
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
    "apply_line_pa_coefficient_override",
    "build_pr_breakdown",
    "build_purchase_chain_config_for_line",
    "build_purchase_modules",
    "build_sale_modules",
    "compute_pr",
    "compute_predictive_pamp",
    "compute_quantity_driven_mix_pct",
    "explain_predictive_pamp",
    "quantize",
    "resolve_margin_rate",
    "resolve_mix_pct",
    "run_chain",
    "to_decimal",
]
