"""Tests for pre-flight FX validation."""

from __future__ import annotations

from decimal import Decimal

import pytest

from apps.products.models import Product
from apps.simulations.services.engine.validation import (
    collect_line_fx_currencies,
    collect_preflight_fx_errors,
    missing_fx_errors,
)


@pytest.mark.django_db
def test_collect_preflight_fx_errors_includes_standard_keys() -> None:
    product = Product(sku_code="SKU-FX", name="Test", is_copper_indexed=False)
    errors = collect_preflight_fx_errors(
        {},
        product=product,
        po_currency="EUR",
        purchase_config={"currency_conversion": {"to_currency": "EUR"}, "transports": []},
        sale_config={"transports": []},
    )
    assert len(errors) == 2
    assert any("EUR → USD" in e for e in errors)
    assert any("EUR → RMB" in e for e in errors)


@pytest.mark.django_db
def test_missing_fx_errors_lists_all_gaps() -> None:
    errors = missing_fx_errors({}, {"USD", "RMB"})
    assert len(errors) == 2
    assert any("EUR → USD" in e for e in errors)
    assert any("EUR → RMB" in e for e in errors)


@pytest.mark.django_db
def test_collect_line_fx_currencies_usd_po_and_copper() -> None:
    product = Product(
        sku_code="SKU-FX",
        name="Test",
        is_copper_indexed=True,
        copper_weight_kg_per_unit=Decimal("1.5"),
    )
    currencies = collect_line_fx_currencies(
        product=product,
        po_currency="USD",
        purchase_config={
            "copper_variation": {},
            "currency_conversion": {"to_currency": "EUR"},
            "transports": [],
        },
        sale_config={"transports": []},
    )
    assert currencies == {"USD", "RMB"}
