"""Tests for stale sale-margin breakdown detection."""

from __future__ import annotations

from apps.simulations.services.pricing_staleness import (
    invalidate_stale_sale_margin_lines,
    sale_margin_before_transport_stale,
)


def test_stale_when_margin_after_transport():
    breakdown = {
        "sale": {
            "steps": [
                {"module": "transport", "order": 1},
                {"module": "margin", "order": 2, "metadata": {"label": "syskern"}},
            ]
        }
    }
    assert sale_margin_before_transport_stale(breakdown) is True


def test_fresh_when_margin_before_transport():
    breakdown = {
        "sale": {
            "steps": [
                {"module": "syskern_margin", "order": 1},
                {"module": "transport", "order": 2},
            ]
        }
    }
    assert sale_margin_before_transport_stale(breakdown) is False


def test_not_stale_margin_only_chain():
    breakdown = {
        "sale": {
            "steps": [
                {"module": "syskern_margin", "order": 1},
            ]
        }
    }
    assert sale_margin_before_transport_stale(breakdown) is False


def test_invalidate_marks_draft_lines_dirty(db):
    from apps.products.models import Product
    from apps.simulations.models import Simulation, SimulationLine, SimulationType

    sim = Simulation.objects.create(
        label="Stale",
        simulation_type=SimulationType.TARIFF,
        market_params={},
        calculation_chain={},
        is_dirty=False,
    )
    product = Product.objects.create(sku_code="STALE-1", name="Stale")
    SimulationLine.objects.create(
        simulation=sim,
        product=product,
        status="ok",
        calculation_breakdown={
            "sale": {
                "steps": [
                    {"module": "transport", "order": 1},
                    {"module": "margin", "order": 2, "metadata": {"label": "syskern"}},
                ]
            }
        },
    )

    stats = invalidate_stale_sale_margin_lines()
    sim.refresh_from_db()
    line = sim.lines.get()

    assert stats["lines_stale"] == 1
    assert stats["simulations_marked_dirty"] == 1
    assert sim.is_dirty is True
    assert line.status == "dirty"
