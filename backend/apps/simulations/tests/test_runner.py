"""End-to-end tests for the simulation runner (CDC §6.5, §6.9.12).

The runner orchestrates the engine over every `SimulationLine`: snapshots,
PA chain → PAMP → PR → PV chain, persistence, per-line error isolation and
the `SimulationRecalculation` audit trace.

The §6.4 worked example is exercised here at the ORM level (a real
`Simulation` + `SimulationLine`) to complement the framework-free engine
tests in `test_engine.py`.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from apps.core.models import Currency
from apps.products.models import Product, ProductSupplier
from apps.simulations.models import (
    Simulation,
    SimulationLine,
    SimulationRecalculation,
    SimulationType,
)
from apps.simulations.services.runner import run_simulation

pytestmark = pytest.mark.django_db


_CDC_MARKET_PARAMS = {
    "copper_base_price_rmb": "70000",
    "copper_current_price_rmb": "97000",
    "fx_eur_rmb": "7.95",
    "fx_eur_usd": "1.15",
}

_CDC_CALCULATION_CHAIN = {
    "purchase_chain": {
        "copper_variation": {},
        "currency_conversion": {"to_currency": "EUR"},
        "transports": [
            {
                "order": 1,
                "transport_mode_code": "40HQ",
                "global_cost": "3000",
                "currency": "USD",
                "pallet_count": 40,
            },
            {
                "order": 2,
                "transport_mode_code": "TRUCK_FULL",
                "global_cost": "1000",
                "currency": "EUR",
                "pallet_count": 40,
            },
        ],
        "customs": {"global_cost": "0", "currency": "EUR"},
        "symea_margin": {"rate": "0.06", "position": "after_transports"},
    },
    "sale_chain": {
        "transports": [],
        "customs": None,
        "syskern_margin": {"rate": "0.20"},
    },
}


def _cdc_simulation(*, market_params: dict | None = None) -> Simulation:
    return Simulation.objects.create(
        label="CDC §6.4",
        simulation_type=SimulationType.TARIFF,
        market_params=_CDC_MARKET_PARAMS if market_params is None else market_params,
        calculation_chain=_CDC_CALCULATION_CHAIN,
    )


def _cdc_line(sim: Simulation) -> SimulationLine:
    product = Product.objects.create(
        sku_code="KCFF6A4PZHDBL5",
        name="Câble §6.4",
        is_copper_indexed=True,
        copper_weight_kg_per_unit=Decimal("18"),
        pallet_qty=9,
        base_unit="km",
        stock_quantity=Decimal("0"),
    )
    ProductSupplier.objects.create(
        product=product,
        supplier_name="Fournisseur Chine",
        is_active=True,
        po_base_price=Decimal("2350"),
        po_currency=Currency.RMB,
    )
    return SimulationLine.objects.create(simulation=sim, product=product, status="pending")


class TestRunnerCdcExample:
    def test_pa_pr_pv_reproduce_cdc_64(self) -> None:
        sim = _cdc_simulation()
        line = _cdc_line(sim)

        results = run_simulation(sim)

        assert [r.status for r in results] == ["ok"]
        line.refresh_from_db()
        assert line.status == "ok"
        # PA net = 390.1636 €/km (CDC §6.4) — non-negotiable.
        assert line.pa_net_eur == Decimal("390.1636")
        # Mix 0 % + no PAMP → PR = PA net.
        assert line.pr_eur == Decimal("390.1636")
        # Syskern margin 20 % → PV = 390.1636 / 0.80 = 487.7045.
        assert line.pv_eur == Decimal("487.7045")

    def test_breakdown_stores_all_chains(self) -> None:
        sim = _cdc_simulation()
        line = _cdc_line(sim)

        run_simulation(sim)

        line.refresh_from_db()
        breakdown = line.calculation_breakdown
        assert "purchase" in breakdown and "pr" in breakdown and "sale" in breakdown
        assert breakdown["purchase"]["final_amount"] == "390.1636"
        assert breakdown["pr"]["final_amount"] == "390.1636"
        pr_modules = [step["module"] for step in breakdown["pr"]["steps"]]
        assert pr_modules == ["predictive_pamp", "pr_mix"]
        # The purchase chain records every module as an ordered step.
        modules = [step["module"] for step in breakdown["purchase"]["steps"]]
        assert modules == [
            "copper_variation",
            "currency_conversion",
            "transport",
            "transport",
            "customs",
            "symea_margin",
        ]
        sale_modules = [step["module"] for step in breakdown["sale"]["steps"]]
        assert sale_modules == ["syskern_margin"]

    def test_recalculation_trace_appended(self) -> None:
        sim = _cdc_simulation()
        _cdc_line(sim)

        run_simulation(sim)

        sim.refresh_from_db()
        assert sim.is_dirty is False
        assert sim.last_calculated_at is not None
        trace = SimulationRecalculation.objects.filter(simulation=sim).get()
        assert trace.aggregates["line_count"] == 1
        assert trace.aggregates["errors_count"] == 0
        # AVG comes back from Postgres with extended scale → compare as Decimal.
        assert Decimal(trace.aggregates["avg_pv_eur"]) == Decimal("487.7045")


class TestRunnerErrorIsolation:
    def test_one_bad_line_does_not_block_the_others(self) -> None:
        """CDC §6.6 — a line that fails is flagged; the rest still price."""
        sim = _cdc_simulation()
        ok_line = _cdc_line(sim)

        # A second SKU with no active supplier → cannot price → error.
        broken_product = Product.objects.create(sku_code="NO-SUP", name="Sans fournisseur")
        broken_line = SimulationLine.objects.create(
            simulation=sim, product=broken_product, status="pending"
        )

        results = run_simulation(sim)

        assert {r.status for r in results} == {"ok", "error"}
        ok_line.refresh_from_db()
        broken_line.refresh_from_db()
        assert ok_line.status == "ok"
        assert ok_line.pv_eur == Decimal("487.7045")
        assert broken_line.status == "error"
        assert "error" in broken_line.calculation_breakdown

        trace = SimulationRecalculation.objects.filter(simulation=sim).get()
        assert trace.aggregates["errors_count"] == 1
        assert trace.aggregates["line_count"] == 2


class TestRunnerWarnings:
    def test_copper_indexed_without_weight_marks_line_warning(self) -> None:
        """An indexed SKU with no copper weight is a data gap → status warning."""
        sim = _cdc_simulation()
        product = Product.objects.create(
            sku_code="WARN-CU",
            name="Indexé sans poids",
            is_copper_indexed=True,
            copper_weight_kg_per_unit=None,
            pallet_qty=9,
            base_unit="km",
            stock_quantity=Decimal("0"),
        )
        ProductSupplier.objects.create(
            product=product,
            supplier_name="Fournisseur",
            is_active=True,
            po_base_price=Decimal("2350"),
            po_currency=Currency.RMB,
        )
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.status == "warning"
        warnings = line.calculation_breakdown["warnings"]
        assert any("indexé cuivre" in w for w in warnings)
        assert line.pv_eur is not None  # still priced

    def test_zero_po_base_price_errors(self) -> None:
        """A PO base price of 0 blocks the calculation (CDC §6.6)."""
        sim = _cdc_simulation()
        product = Product.objects.create(
            sku_code="ZERO-PO",
            name="PO à zéro",
            is_copper_indexed=False,
            pallet_qty=9,
            base_unit="km",
            stock_quantity=Decimal("0"),
        )
        ProductSupplier.objects.create(
            product=product,
            supplier_name="Fournisseur",
            is_active=True,
            po_base_price=Decimal("0"),
            po_currency=Currency.EUR,
        )
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.status == "error"
        errors = line.calculation_breakdown["errors"]
        assert any("prix d'achat (po)" in e.lower() for e in errors)
        assert line.pv_eur is None or line.pa_net_eur is None

    def test_negative_pa_from_copper_variation_errors(self) -> None:
        """PO trop faible + cuivre actuel < base → PA négatif = erreur bloquante."""
        sim = _cdc_simulation(
            market_params={
                "copper_base_price_rmb": "97000",
                "copper_current_price_rmb": "70000",
                "fx_eur_rmb": "7.95",
                "fx_eur_usd": "1.15",
            }
        )
        product = Product.objects.create(
            sku_code="NEG-PA",
            name="PA négatif",
            is_copper_indexed=True,
            copper_weight_kg_per_unit=Decimal("18"),
            pallet_qty=9,
            base_unit="km",
            stock_quantity=Decimal("0"),
        )
        ProductSupplier.objects.create(
            product=product,
            supplier_name="Fournisseur",
            is_active=True,
            po_base_price=Decimal("100"),
            po_currency=Currency.RMB,
        )
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.status == "error"
        errors = line.calculation_breakdown["errors"]
        assert any("pa net négatif" in e.lower() for e in errors)

    def test_missing_pallet_qty_with_transport_warns_not_error(self) -> None:
        """Transport without pallet_qty is a data gap → warning, not a hard error."""
        sim = _cdc_simulation()
        product = Product.objects.create(
            sku_code="NO-PALLET",
            name="Sans palette",
            is_copper_indexed=False,
            pallet_qty=None,
            base_unit="unit",
            stock_quantity=Decimal("0"),
        )
        ProductSupplier.objects.create(
            product=product,
            supplier_name="Fournisseur",
            is_active=True,
            po_base_price=Decimal("2350"),
            po_currency=Currency.RMB,
        )
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.status == "warning"
        warnings = line.calculation_breakdown["warnings"]
        assert any("pallet_qty" in w for w in warnings)
        assert line.pv_eur is not None

    def test_missing_supplier_errors_in_french(self) -> None:
        """No active supplier / PO price → hard error with an actionable FR message."""
        sim = _cdc_simulation()
        product = Product.objects.create(sku_code="NO-SUP-2", name="Sans fournisseur")
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.status == "error"
        errors = line.calculation_breakdown["errors"]
        assert any("prix d'achat (po)" in e.lower() for e in errors)
        # Legacy single-string key preserved for backward compatibility.
        assert line.calculation_breakdown["error"] == errors[0]

    def test_preflight_accumulates_po_and_fx_errors(self) -> None:
        """Missing PO and missing standard FX rates are all reported together."""
        sim = _cdc_simulation(market_params={})
        product = Product.objects.create(sku_code="MULTI-ERR", name="Multi erreurs")
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.status == "error"
        errors = line.calculation_breakdown["errors"]
        assert len(errors) >= 3
        assert any("prix d'achat (po)" in e.lower() for e in errors)
        assert any("EUR → USD" in e for e in errors)
        assert any("EUR → RMB" in e for e in errors)


class TestRunnerPampMix:
    """Predictive PAMP availability drives the effective mix (CDC §6.7.1).

    The graceful Odoo-failure (degraded) path is covered at the task level in
    `test_views.TestRecalculateTask` (a refresh failure still recalculates on
    current params with no pending purchases).
    """

    def _synced_product(self, sku: str, *, odoo_id: int | None, stock, pamp) -> Product:
        product = Product.objects.create(
            sku_code=sku,
            name=sku,
            is_copper_indexed=False,
            pallet_qty=40,
            base_unit="unit",
            odoo_id=odoo_id,
            stock_quantity=stock,
            pamp_eur=pamp,
        )
        ProductSupplier.objects.create(
            product=product,
            supplier_name="Fournisseur",
            is_active=True,
            po_base_price=Decimal("100"),
            po_currency=Currency.EUR,
        )
        return product

    def test_synced_stock_applies_mix(self) -> None:
        sim = _cdc_simulation()
        sim.stock_purchase_mix_pct = 100
        sim.save(update_fields=["stock_purchase_mix_pct"])
        product = self._synced_product(
            "MIX-OK", odoo_id=50, stock=Decimal("10"), pamp=Decimal("80")
        )
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        # Stock-only PAMP = 80 ; mix 100 % → PR = PAMP = 80.
        assert line.pamp_predictive_eur == Decimal("80.0000")
        assert line.effective_mix_pct == 100
        assert line.pr_eur == Decimal("80.0000")
        # No mix warning when the PAMP is available.
        assert not any(
            "PAMP prévisionnel indisponible" in w for w in line.calculation_breakdown["warnings"]
        )

    def test_non_synced_product_forces_mix_zero_with_warning(self) -> None:
        sim = _cdc_simulation()
        sim.stock_purchase_mix_pct = 50
        sim.save(update_fields=["stock_purchase_mix_pct"])
        # odoo_id None → never synced; even a residual stock must not yield a PAMP.
        product = self._synced_product(
            "NO-SYNC", odoo_id=None, stock=Decimal("10"), pamp=Decimal("80")
        )
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.pamp_predictive_eur is None
        assert line.effective_mix_pct == 0
        # Mix forced to 0 → PR = PA net (PA net = 100 EUR base, no chain modules add cost here).
        assert line.pr_eur == line.pa_net_eur
        assert line.status == "warning"
        assert any(
            "PAMP prévisionnel indisponible" in w for w in line.calculation_breakdown["warnings"]
        )

    def test_synced_without_stock_or_pending_forces_mix_zero(self) -> None:
        sim = _cdc_simulation()
        sim.stock_purchase_mix_pct = 50
        sim.save(update_fields=["stock_purchase_mix_pct"])
        # Synced but stock 0 and no pending purchases (none passed) → PAMP None.
        product = self._synced_product("SYNC-EMPTY", odoo_id=51, stock=Decimal("0"), pamp=None)
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.pamp_predictive_eur is None
        assert line.effective_mix_pct == 0
        assert line.status == "warning"
        assert any(
            "PAMP prévisionnel indisponible" in w for w in line.calculation_breakdown["warnings"]
        )


class TestRunnerIncotermWarnings:
    def test_exw_with_sale_transport_emits_incoterm_warning(self) -> None:
        """EXW + transport vente → warning §6.8.3, status warning, incoterm_context persisted."""
        sim = _cdc_simulation()
        sim.sale_incoterm = "EXW"
        sim.calculation_chain = {
            **_CDC_CALCULATION_CHAIN,
            "sale_chain": {
                "transports": [
                    {
                        "order": 1,
                        "transport_mode_code": "TRUCK_FULL",
                        "global_cost": "500",
                        "currency": "EUR",
                        "pallet_count": 9,
                    }
                ],
                "customs": None,
                "syskern_margin": {"rate": "0.20"},
            },
        }
        sim.save(update_fields=["sale_incoterm", "calculation_chain"])
        line = _cdc_line(sim)

        run_simulation(sim)

        line.refresh_from_db()
        assert line.status == "warning"
        ctx = line.calculation_breakdown["incoterm_context"]
        assert ctx["sale_incoterm"] == "EXW"
        warnings = line.calculation_breakdown["warnings"]
        assert any("EXW" in w for w in warnings)

    def test_sale_breakdown_margin_before_transport(self) -> None:
        """Persisted sale breakdown lists Syskern margin before PV transports."""
        sim = _cdc_simulation()
        sim.calculation_chain = {
            **_CDC_CALCULATION_CHAIN,
            "sale_chain": {
                "transports": [
                    {
                        "order": 1,
                        "transport_mode_code": "TRUCK_FULL",
                        "global_cost": "100",
                        "currency": "EUR",
                        "pallet_count": 1,
                    }
                ],
                "customs": None,
                "syskern_margin": {"rate": "0.20"},
            },
        }
        sim.save(update_fields=["calculation_chain"])
        line = _cdc_line(sim)

        run_simulation(sim)

        line.refresh_from_db()
        sale_steps = line.calculation_breakdown["sale"]["steps"]
        assert sale_steps[0]["module"] == "syskern_margin"
        assert sale_steps[1]["module"] == "transport"
        pr = line.pr_eur
        transport_per_unit = Decimal("100") / Decimal("9")  # 1 pallet, 9 units/pallet
        wrong_pv = (pr + transport_per_unit) / Decimal("0.8")
        assert line.pv_eur != wrong_pv
        assert sale_steps[0]["output_price"]["amount"] == str(pr / Decimal("0.8"))


# ─── CDC Feedback 1 — quantity-driven mix + PA coefficient ─────────────────

_MINIMAL_CHAIN: dict = {
    "purchase_chain": {
        "currency_conversion": {"to_currency": "EUR"},
        "transports": [],
        "customs": None,
        "symea_margin": {"rate": "0", "position": "after_transports"},
    },
    "sale_chain": {"transports": [], "customs": None, "syskern_margin": {"rate": "0.20"}},
}


class TestRunnerFeedback1:
    """Quantity per SKU drives the mix on project sims; transport coefficient on chain."""

    def _product(self, sku: str, *, stock, pamp, odoo_id: int | None = 90) -> Product:
        product = Product.objects.create(
            sku_code=sku,
            name=sku,
            is_copper_indexed=False,
            pallet_qty=40,
            base_unit="unit",
            odoo_id=odoo_id,
            stock_quantity=stock,
            pamp_eur=pamp,
        )
        ProductSupplier.objects.create(
            product=product,
            supplier_name="Fournisseur",
            is_active=True,
            po_base_price=Decimal("100"),
            po_currency=Currency.EUR,
        )
        return product

    def _sim(self, sim_type: SimulationType) -> Simulation:
        return Simulation.objects.create(
            label="FB1",
            simulation_type=sim_type,
            project_name="Projet" if sim_type == SimulationType.PROJECT else "",
            market_params=_CDC_MARKET_PARAMS,
            calculation_chain=_MINIMAL_CHAIN,
        )

    def test_project_quantity_drives_auto_mix(self) -> None:
        sim = self._sim(SimulationType.PROJECT)
        product = self._product("FB1-AUTO", stock=Decimal("30"), pamp=Decimal("100"))
        line = SimulationLine.objects.create(
            simulation=sim, product=product, quantity=Decimal("100"), status="pending"
        )

        run_simulation(sim)

        line.refresh_from_db()
        # part_stock = min(30, 100) / 100 = 30 %.
        assert line.effective_mix_pct == 30
        assert line.calculation_breakdown["pr"]["steps"][-1]["metadata"]["mix_source"] == (
            "quantity_driven"
        )

    def test_force_manual_mix_uses_slider(self) -> None:
        sim = self._sim(SimulationType.PROJECT)
        sim.stock_purchase_mix_pct = 100
        sim.save(update_fields=["stock_purchase_mix_pct"])
        product = self._product("FB1-MANUAL", stock=Decimal("30"), pamp=Decimal("100"))
        line = SimulationLine.objects.create(
            simulation=sim,
            product=product,
            quantity=Decimal("100"),
            force_manual_mix=True,
            status="pending",
        )

        run_simulation(sim)

        line.refresh_from_db()
        # Manual mix wins over the quantity-driven auto-mix.
        assert line.effective_mix_pct == 100
        assert line.calculation_breakdown["pr"]["steps"][-1]["metadata"]["mix_source"] == "manual"

    def test_tariff_ignores_quantity(self) -> None:
        sim = self._sim(SimulationType.TARIFF)
        sim.stock_purchase_mix_pct = 50
        sim.save(update_fields=["stock_purchase_mix_pct"])
        product = self._product("FB1-TARIFF", stock=Decimal("30"), pamp=Decimal("100"))
        line = SimulationLine.objects.create(
            simulation=sim, product=product, quantity=Decimal("100"), status="pending"
        )

        run_simulation(sim)

        line.refresh_from_db()
        # Tariff → manual mix only; quantity is ignored.
        assert line.effective_mix_pct == 50

    def test_transport_coefficient_multiplies_pa(self) -> None:
        sim = self._sim(SimulationType.TARIFF)
        sim.calculation_chain = {
            **_MINIMAL_CHAIN,
            "purchase_chain": {
                **_MINIMAL_CHAIN["purchase_chain"],
                "transport_pricing": "coefficient",
                "transport_coefficient": "1.10",
                "transports": [
                    {
                        "order": 1,
                        "transport_mode_code": "COEF",
                        "global_cost": "0",
                        "currency": "EUR",
                        "pallet_count": 0,
                        "override_coefficient": "1.10",
                    }
                ],
            },
        }
        sim.save(update_fields=["calculation_chain"])
        product = self._product("FB1-COEF", stock=Decimal("0"), pamp=None)
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        # PO 100 EUR, symea 0 % → PA net 100, then transport x1.10 = 110.
        assert line.pa_net_eur == Decimal("110.0000")
        transport_steps = [
            s
            for s in line.calculation_breakdown["purchase"]["steps"]
            if s.get("module") == "transport"
        ]
        assert len(transport_steps) == 1
        assert transport_steps[0]["metadata"]["mode"] == "coefficient"
        assert transport_steps[0]["metadata"]["coefficient"] == "1.10"

    def test_line_pa_coefficient_override_on_detailed_chain(self) -> None:
        """Per-line coefficient replaces detailed transports for that line only."""
        sim = self._sim(SimulationType.TARIFF)
        sim.calculation_chain = {
            **_MINIMAL_CHAIN,
            "purchase_chain": {
                **_MINIMAL_CHAIN["purchase_chain"],
                "transport_pricing": "detailed",
                "transports": [
                    {
                        "order": 1,
                        "transport_mode_code": "TRUCK_FULL",
                        "global_cost": "100",
                        "currency": "EUR",
                        "pallet_count": 1,
                    }
                ],
            },
        }
        sim.save(update_fields=["calculation_chain"])
        product = self._product("FB1-LINE-COEF", stock=Decimal("0"), pamp=None, odoo_id=None)
        line = SimulationLine.objects.create(
            simulation=sim,
            product=product,
            pa_coefficient_override=Decimal("1.05"),
            status="pending",
        )

        run_simulation(sim)

        line.refresh_from_db()
        assert line.pa_net_eur == Decimal("105.0000")

    def test_null_line_coefficient_keeps_chain_coefficient(self) -> None:
        """Lines without override keep the simulation-wide chain coefficient."""
        sim = self._sim(SimulationType.TARIFF)
        sim.calculation_chain = {
            **_MINIMAL_CHAIN,
            "purchase_chain": {
                **_MINIMAL_CHAIN["purchase_chain"],
                "transport_pricing": "coefficient",
                "transport_coefficient": "1.10",
                "transports": [
                    {
                        "order": 1,
                        "transport_mode_code": "COEF",
                        "global_cost": "0",
                        "currency": "EUR",
                        "pallet_count": 0,
                        "override_coefficient": "1.10",
                    }
                ],
            },
        }
        sim.save(update_fields=["calculation_chain"])
        product = self._product("FB1-CHAIN-COEF", stock=Decimal("0"), pamp=None)
        line = SimulationLine.objects.create(simulation=sim, product=product, status="pending")

        run_simulation(sim)

        line.refresh_from_db()
        assert line.pa_net_eur == Decimal("110.0000")
