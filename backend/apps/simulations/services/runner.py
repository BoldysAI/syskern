"""Full simulation runner — orchestrates the engine over every line.

Responsibilities:
- snapshot product + active supplier into each `SimulationLine`
- run the purchase chain → PA net
- compute predictive PAMP from Odoo data when available
- mix into PR
- run the sale chain → PV
- persist results, aggregate stats and append a `SimulationRecalculation`
  trace (CDC §6.9.12)
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal

from django.db import transaction
from django.db.models import Avg, Max, Min
from django.utils import timezone

from apps.core.models import Currency
from apps.products.models import Product, ProductSupplier

from ..models import (
    RecalculationTrigger,
    Simulation,
    SimulationLine,
    SimulationRecalculation,
)
from .engine import (
    PendingPurchase,
    PriceWithCurrency,
    ProductView,
    SimulationContext,
    build_purchase_modules,
    build_sale_modules,
    compute_pr,
    compute_predictive_pamp,
    resolve_margin_rate,
    resolve_mix_pct,
    run_chain,
)

# ─── Per-line input ──────────────────────────────────────────────────────


@dataclass
class LineInput:
    product: Product
    active_supplier: ProductSupplier | None
    pending_purchases_eur: list[PendingPurchase] = field(default_factory=list)


# ─── Per-line result ─────────────────────────────────────────────────────


@dataclass
class LineResult:
    line: SimulationLine
    status: str  # 'ok' | 'warning' | 'error'
    error: str | None = None


# ─── Runner ──────────────────────────────────────────────────────────────


@transaction.atomic
def run_simulation(
    simulation: Simulation,
    *,
    trigger: RecalculationTrigger = RecalculationTrigger.MANUAL_CURRENT_PARAMS,
    odoo_snapshot_at=None,
    note: str = "",
) -> list[LineResult]:
    """Recalculate every line of `simulation` and persist results.

    Returns the per-line outcome list (also persisted on each
    `SimulationLine` via `status`).
    """
    if simulation.status == "finalized":
        raise PermissionError("Finalized simulations cannot be recalculated.")

    chain_config = simulation.calculation_chain or {}
    purchase_config = chain_config.get("purchase_chain") or {}
    sale_config = chain_config.get("sale_chain") or {}

    results: list[LineResult] = []
    now = timezone.now()

    lines = list(simulation.lines.select_related("product").all())

    for line in lines:
        result = _recalculate_line(
            simulation=simulation,
            line=line,
            purchase_config=purchase_config,
            sale_config=sale_config,
            now=now,
        )
        results.append(result)

    # Aggregate stats for the recalculation trace.
    aggregates = _aggregate(simulation, results)

    SimulationRecalculation.objects.create(
        simulation=simulation,
        calculated_at=now,
        market_params=simulation.market_params,
        odoo_snapshot_at=odoo_snapshot_at,
        calculation_chain=simulation.calculation_chain,
        stock_purchase_mix_pct=simulation.stock_purchase_mix_pct,
        syskern_margin_rate=simulation.syskern_margin_rate,
        symea_margin_rate=simulation.symea_margin_rate,
        aggregates=aggregates,
        trigger_type=trigger,
        note=note,
    )

    simulation.last_calculated_at = now
    simulation.is_dirty = False
    simulation.save(update_fields=["last_calculated_at", "is_dirty", "updated_at"])

    return results


def _recalculate_line(
    *,
    simulation: Simulation,
    line: SimulationLine,
    purchase_config: dict,
    sale_config: dict,
    now,
) -> LineResult:
    product = line.product
    supplier = (
        line.product.suppliers.filter(is_active=True).first()
        if hasattr(line.product, "suppliers")
        else None
    )

    # Snapshot the SKU + supplier for traceability (CDC §6.9.10).
    line.product_snapshot = _product_snapshot(product)
    line.supplier_snapshot = _supplier_snapshot(supplier)

    try:
        if supplier is None or supplier.po_base_price is None:
            raise ValueError(
                f"Product {product.sku_code} has no active supplier with a PO base price."
            )

        ctx = SimulationContext(
            product=ProductView.from_model(product),
            market_params=simulation.market_params or {},
        )

        # ─── Purchase chain → PA net ──────────────────────────────────
        starting_po = PriceWithCurrency(
            amount=Decimal(supplier.po_base_price),
            currency=supplier.po_currency,
        )
        purchase_modules = build_purchase_modules(
            {
                **purchase_config,
                "symea_margin": purchase_config.get("symea_margin")
                or {"rate": str(simulation.symea_margin_rate), "position": "after_transports"},
            }
        )
        purchase_result = run_chain(purchase_modules, starting_price=starting_po, context=ctx)
        pa_net = purchase_result.final_price.amount

        # ─── Predictive PAMP + PR ─────────────────────────────────────
        # MVP1: Odoo pending purchases injection comes from the runner's
        # `LineInput`; we keep the line API trivial here and use whatever
        # snapshot the simulation already carries.
        pamp_predictive = compute_predictive_pamp(
            stock_quantity=product.stock_quantity,
            pamp_eur=product.pamp_eur,
            pending_purchases=[],  # plug Odoo data here when integrating §5
        )
        mix_pct = resolve_mix_pct(
            simulation_mix_pct=simulation.stock_purchase_mix_pct,
            line_override=line.stock_purchase_mix_pct_override,
        )
        pr = compute_pr(pa_net_eur=pa_net, pamp_predictive_eur=pamp_predictive, mix_pct=mix_pct)

        # ─── Sale chain → PV ──────────────────────────────────────────
        margin_rate = resolve_margin_rate(
            simulation_margin_rate=simulation.syskern_margin_rate,
            line_override=line.margin_override,
        )
        sale_modules = build_sale_modules(sale_config, syskern_margin_rate=margin_rate)
        sale_result = run_chain(
            sale_modules,
            starting_price=PriceWithCurrency(amount=pr, currency=Currency.EUR.value),
            context=ctx,
        )

        # Persist results
        line.po_net_origin_currency = (
            purchase_result.steps[0].output_price.amount
            if purchase_result.steps
            else Decimal(supplier.po_base_price)
        )
        line.po_net_eur = next(
            (
                s.output_price.amount
                for s in purchase_result.steps
                if s.module_type == "currency_conversion"
            ),
            pa_net,
        )
        line.pa_net_eur = pa_net
        line.pamp_predictive_eur = pamp_predictive
        line.pr_eur = pr
        line.pv_eur = sale_result.final_price.amount
        line.calculation_breakdown = {
            "purchase": purchase_result.to_breakdown(),
            "sale": sale_result.to_breakdown(),
            "mix_pct": mix_pct,
            "syskern_margin_rate": str(margin_rate),
        }
        line.status = "ok"
        line.last_calculated_at = now
        line.save()
        return LineResult(line=line, status="ok")

    except Exception as exc:  # surface as line-level error (CDC §6.6)
        line.status = "error"
        line.calculation_breakdown = {"error": str(exc)}
        line.last_calculated_at = now
        line.save()
        return LineResult(line=line, status="error", error=str(exc))


def _product_snapshot(p: Product) -> dict:
    return {
        "sku_code": p.sku_code,
        "name": p.name,
        "brand": p.brand,
        "universe": p.universe,
        "family": p.family,
        "range": p.range,
        "sub_range": p.sub_range,
        "is_copper_indexed": p.is_copper_indexed,
        "copper_weight_kg_per_unit": str(p.copper_weight_kg_per_unit)
        if p.copper_weight_kg_per_unit is not None
        else None,
        "base_unit": p.base_unit,
        "pallet_qty": p.pallet_qty,
        "unit_weight_kg": str(p.unit_weight_kg) if p.unit_weight_kg is not None else None,
        "stock_quantity": str(p.stock_quantity) if p.stock_quantity is not None else None,
        "pamp_eur": str(p.pamp_eur) if p.pamp_eur is not None else None,
    }


def _supplier_snapshot(s: ProductSupplier | None) -> dict:
    if s is None:
        return {}
    return {
        "supplier_name": s.supplier_name,
        "factory_code": s.factory_code,
        "po_base_price": str(s.po_base_price) if s.po_base_price is not None else None,
        "po_currency": s.po_currency,
        "is_copper_indexed": s.is_copper_indexed,
        "copper_base_price": str(s.copper_base_price) if s.copper_base_price is not None else None,
        "incoterm": s.incoterm,
        "incoterm_location": s.incoterm_location,
    }


def _aggregate(simulation: Simulation, results: Iterable[LineResult]) -> dict:
    """Aggregate stats persisted on the recalculation trace."""
    lines_qs = simulation.lines.all()
    agg = lines_qs.aggregate(
        avg_pa=Avg("pa_net_eur"),
        avg_pr=Avg("pr_eur"),
        avg_pv=Avg("pv_eur"),
        min_pv=Min("pv_eur"),
        max_pv=Max("pv_eur"),
    )
    warnings = sum(1 for r in results if r.status == "warning")
    errors = sum(1 for r in results if r.status == "error")
    return {
        "line_count": lines_qs.count(),
        "avg_pa_eur": str(agg["avg_pa"]) if agg["avg_pa"] is not None else None,
        "avg_pr_eur": str(agg["avg_pr"]) if agg["avg_pr"] is not None else None,
        "avg_pv_eur": str(agg["avg_pv"]) if agg["avg_pv"] is not None else None,
        "min_pv_eur": str(agg["min_pv"]) if agg["min_pv"] is not None else None,
        "max_pv_eur": str(agg["max_pv"]) if agg["max_pv"] is not None else None,
        "warnings_count": warnings,
        "errors_count": errors,
    }
