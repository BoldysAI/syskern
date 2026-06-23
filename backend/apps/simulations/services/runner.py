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
from .incoterm_rules import (
    build_incoterm_context,
    check_purchase_chain_coherence,
    check_sale_chain_coherence,
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
    pending_by_product: dict[str, list[PendingPurchase]] | None = None,
) -> list[LineResult]:
    """Recalculate every line of `simulation` and persist results.

    `pending_by_product` maps a product id (str) to its pending purchases
    (in EUR) pulled from Odoo during a refresh recalc; absent or empty when
    recalculating on current params only.

    Returns the per-line outcome list (also persisted on each
    `SimulationLine` via `status`).
    """
    if simulation.status == "finalized":
        raise PermissionError("Finalized simulations cannot be recalculated.")

    chain_config = simulation.calculation_chain or {}
    purchase_config = chain_config.get("purchase_chain") or {}
    sale_config = chain_config.get("sale_chain") or {}
    pending_by_product = pending_by_product or {}

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
            pending_purchases=pending_by_product.get(str(line.product_id), []),
        )
        results.append(result)

    # Aggregate stats + per-line snapshot for the recalculation trace.
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
        sale_incoterm=simulation.sale_incoterm,
        sale_incoterm_location=simulation.sale_incoterm_location or "",
        aggregates=aggregates,
        line_snapshots=_build_line_snapshots(simulation),
        trigger_type=trigger,
        note=note,
    )

    simulation.last_calculated_at = now
    simulation.odoo_snapshot_at = odoo_snapshot_at
    simulation.is_dirty = False
    simulation.save(
        update_fields=["last_calculated_at", "odoo_snapshot_at", "is_dirty", "updated_at"]
    )

    return results


@transaction.atomic
def snapshot_finalize_trace(simulation: Simulation, *, note: str = "") -> SimulationRecalculation:
    """Append a recalc trace for a finalize event (CDC §6.9.6, §6.9.12).

    Finalizing does NOT recompute prices — it freezes the *current* line
    results into an audit trace tagged ``FINALIZE``. Must be called while the
    simulation is still writable (status ``draft``).
    """
    now = timezone.now()
    results = [LineResult(line=line, status=line.status) for line in simulation.lines.all()]
    return SimulationRecalculation.objects.create(
        simulation=simulation,
        calculated_at=now,
        market_params=simulation.market_params,
        odoo_snapshot_at=simulation.odoo_snapshot_at,
        calculation_chain=simulation.calculation_chain,
        stock_purchase_mix_pct=simulation.stock_purchase_mix_pct,
        syskern_margin_rate=simulation.syskern_margin_rate,
        symea_margin_rate=simulation.symea_margin_rate,
        sale_incoterm=simulation.sale_incoterm,
        sale_incoterm_location=simulation.sale_incoterm_location or "",
        aggregates=_aggregate(simulation, results),
        line_snapshots=_build_line_snapshots(simulation),
        trigger_type=RecalculationTrigger.FINALIZE,
        note=note,
    )


def recalculate_single_line(line: SimulationLine) -> LineResult:
    """Recalculate one line synchronously (CDC §6.9.5).

    Reuses the parent simulation's frozen params/chain and the current product
    snapshot. Unlike a global recalc, this does **not** append a
    `SimulationRecalculation` trace and does not touch the simulation's
    `is_dirty`/`last_calculated_at` — it is an operational, single-row event.
    """
    simulation = line.simulation
    chain_config = simulation.calculation_chain or {}
    return _recalculate_line(
        simulation=simulation,
        line=line,
        purchase_config=chain_config.get("purchase_chain") or {},
        sale_config=chain_config.get("sale_chain") or {},
        now=timezone.now(),
    )


def _recalculate_line(
    *,
    simulation: Simulation,
    line: SimulationLine,
    purchase_config: dict,
    sale_config: dict,
    now,
    pending_purchases: list[PendingPurchase] | None = None,
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

    # Pre-flight: a missing PO base price is a hard error; a zero base price is
    # a warning (we still compute, but the result is meaningless until filled).
    input_errors, input_warnings = _validate_line_inputs(product, supplier)
    if input_errors:
        return _persist_error(line, input_errors, now)
    # Narrowed by _validate_line_inputs (supplier + PO base price are present).
    assert supplier is not None
    po_base_price = supplier.po_base_price
    assert po_base_price is not None

    try:
        ctx = SimulationContext(
            product=ProductView.from_model(product),
            market_params=simulation.market_params or {},
        )

        # ─── Purchase chain → PA net ──────────────────────────────────
        starting_po = PriceWithCurrency(
            amount=po_base_price,
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
        # Odoo pending purchases (already EUR-converted) come from the
        # simulation-wide refresh; a product never synced with Odoo
        # (`odoo_id is None`) has no predictive PAMP (CDC §6.7.1).
        pamp_predictive = compute_predictive_pamp(
            odoo_synced=product.odoo_id is not None,
            stock_quantity=product.stock_quantity,
            pamp_eur=product.pamp_eur,
            pending_purchases=pending_purchases or [],
        )
        # The requested mix (override vs simulation) vs the effective mix: when
        # the predictive PAMP is unavailable the mix is forced to 0 (CDC §6.7.1)
        # — and we never hide that behind a silent 0 (CDC §6.6).
        requested_mix_pct = resolve_mix_pct(
            simulation_mix_pct=simulation.stock_purchase_mix_pct,
            line_override=line.stock_purchase_mix_pct_override,
        )
        mix_pct = resolve_mix_pct(
            simulation_mix_pct=simulation.stock_purchase_mix_pct,
            line_override=line.stock_purchase_mix_pct_override,
            pamp_available=pamp_predictive is not None,
        )
        mix_warnings: list[str] = []
        if pamp_predictive is None and requested_mix_pct > 0:
            mix_warnings.append(
                f"Produit {product.sku_code} : PAMP prévisionnel indisponible "
                f"— mix stock/achat forcé à 0 % (PR = PA net)."
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

        purchase_incoterm = str(line.supplier_snapshot.get("incoterm") or "")
        purchase_location = str(line.supplier_snapshot.get("incoterm_location") or "")
        incoterm_ctx = build_incoterm_context(
            sale_incoterm=simulation.sale_incoterm,
            sale_incoterm_location=simulation.sale_incoterm_location or "",
            purchase_incoterm=purchase_incoterm,
            purchase_incoterm_location=purchase_location,
        )
        incoterm_warnings = check_sale_chain_coherence(
            simulation.sale_incoterm,
            sale_config,
        ) + check_purchase_chain_coherence(purchase_incoterm, purchase_config)

        # Persist results
        line.po_net_origin_currency = (
            purchase_result.steps[0].output_price.amount if purchase_result.steps else po_base_price
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
        line.effective_mix_pct = mix_pct
        line.effective_margin_rate = margin_rate
        warnings = (
            input_warnings
            + mix_warnings
            + purchase_result.warnings
            + sale_result.warnings
            + incoterm_warnings
        )
        line.calculation_breakdown = {
            "purchase": purchase_result.to_breakdown(),
            "sale": sale_result.to_breakdown(),
            "mix_pct": mix_pct,
            "syskern_margin_rate": str(margin_rate),
            "market_params_snapshot": _market_params_snapshot(simulation.market_params or {}),
            "incoterm_context": incoterm_ctx,
            "warnings": warnings,
            "errors": [],
        }
        # Honest status: warnings never hide behind a green "ok".
        line.status = "warning" if warnings else "ok"
        line.last_calculated_at = now
        line.save()
        return LineResult(line=line, status=line.status)

    except Exception as exc:  # surface as line-level error (CDC §6.6)
        return _persist_error(line, [str(exc)], now)


def _validate_line_inputs(
    product: Product, supplier: ProductSupplier | None
) -> tuple[list[str], list[str]]:
    """Pre-flight validation of a line's inputs (CDC §6.6).

    Returns `(errors, warnings)`. A hard error stops the calculation entirely;
    a warning lets it proceed but flags a meaningless/at-risk result so the UI
    never shows a silent 0.
    """
    errors: list[str] = []
    warnings: list[str] = []
    if supplier is None or supplier.po_base_price is None:
        errors.append(
            f"Produit {product.sku_code} : aucun fournisseur actif avec un prix "
            f"d'achat (PO) renseigné — calcul impossible."
        )
        return errors, warnings
    if supplier.po_base_price == 0:
        warnings.append(
            f"Produit {product.sku_code} : prix d'achat (PO) à 0 — le résultat "
            f"reste nul tant que le prix fournisseur n'est pas renseigné."
        )
    return errors, warnings


def _persist_error(line: SimulationLine, errors: list[str], now) -> LineResult:
    """Persist a line-level failure with standardized diagnostics."""
    line.status = "error"
    line.calculation_breakdown = {
        "errors": errors,
        "warnings": [],
        # Legacy single-string key kept for backward compatibility.
        "error": errors[0] if errors else "",
    }
    line.last_calculated_at = now
    line.save()
    return LineResult(line=line, status="error", error=errors[0] if errors else None)


def _market_params_snapshot(market_params: dict) -> dict:
    """Persist the market keys used by the engine for audit in the breakdown UI."""
    keys = (
        "copper_base_price_rmb",
        "copper_current_price_rmb",
        "fx_eur_rmb",
        "fx_eur_usd",
    )
    return {
        k: market_params[k]
        for k in keys
        if k in market_params and market_params[k] not in (None, "")
    }


def _product_snapshot(p: Product) -> dict:
    return {
        "sku_code": p.sku_code,
        "name": p.name,
        "designation": p.designation,
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
    """Aggregate stats persisted on the recalculation trace (CDC §6.9.12)."""
    lines_qs = simulation.lines.all()
    agg = lines_qs.aggregate(
        avg_pa=Avg("pa_net_eur"),
        avg_pr=Avg("pr_eur"),
        avg_pv=Avg("pv_eur"),
        avg_margin=Avg("effective_margin_rate"),
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
        "avg_margin": str(agg["avg_margin"]) if agg["avg_margin"] is not None else None,
        "min_pv_eur": str(agg["min_pv"]) if agg["min_pv"] is not None else None,
        "max_pv_eur": str(agg["max_pv"]) if agg["max_pv"] is not None else None,
        "warnings_count": warnings,
        "errors_count": errors,
    }


def _build_line_snapshots(simulation: Simulation) -> list[dict]:
    """Freeze the current per-SKU results for the recalc trace (CDC §6.9.12).

    Stored on `SimulationRecalculation.line_snapshots` so a historical recalc
    can be inspected line-by-line and compared against the live state, without
    ever recomputing prices from a past snapshot.
    """
    snapshots: list[dict] = []
    for line in simulation.lines.select_related("product").all():
        product = line.product
        snapshots.append(
            {
                "product_id": str(line.product_id),
                "sku": product.sku_code,
                "designation": product.designation,
                "pa_net_eur": str(line.pa_net_eur) if line.pa_net_eur is not None else None,
                "pr_eur": str(line.pr_eur) if line.pr_eur is not None else None,
                "pv_eur": str(line.pv_eur) if line.pv_eur is not None else None,
                "effective_margin_rate": (
                    str(line.effective_margin_rate)
                    if line.effective_margin_rate is not None
                    else None
                ),
                "effective_mix_pct": line.effective_mix_pct,
                "status": line.status,
            }
        )
    return snapshots
