"""`fix_active_supplier` — activate the priced ProductSupplier per product.

The pricing engine reads the active supplier's ``po_base_price``; the migration
left Symea (price 0) active while the real factory price sat inactive. This
command repairs that.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.core.management import call_command

from apps.products.management.commands.fix_active_supplier import (
    choose_priced_supplier,
    to_eur,
)
from apps.products.models import Product, ProductSupplier

# ── Pure selection helper (no DB) ───────────────────────────────────────────────


def _sup(name, price, ccy="EUR"):
    return ProductSupplier(
        supplier_name=name,
        po_base_price=None if price is None else Decimal(str(price)),
        po_currency=ccy,
    )


def test_choose_single_priced_over_unpriced():
    symea = _sup("Symea", None)
    mirsan = _sup("Mirsan", "3.45", "USD")
    assert choose_priced_supplier([symea, mirsan], {}).supplier_name == "Mirsan"


def test_choose_none_when_no_price():
    assert choose_priced_supplier([_sup("Symea", 0), _sup("X", None)], {}) is None


def test_choose_cheapest_eur_normalised():
    fx = {"USD": Decimal("1.1"), "RMB": Decimal("7.9")}
    a = _sup("A", "790", "RMB")  # 100 EUR
    b = _sup("B", "99", "EUR")  # 99 EUR  ← cheapest
    c = _sup("C", "110", "USD")  # 100 EUR
    assert choose_priced_supplier([a, b, c], fx).supplier_name == "B"


def test_unconvertible_currency_sorts_last():
    fx = {"USD": Decimal("1.1")}  # no RMB rate
    priced_rmb = _sup("RMBonly", "10", "RMB")  # unconvertible
    priced_eur = _sup("EURone", "50", "EUR")
    assert choose_priced_supplier([priced_rmb, priced_eur], fx).supplier_name == "EURone"


def test_to_eur():
    fx = {"USD": Decimal("1.1"), "RMB": Decimal("7.9")}
    assert to_eur(Decimal("110"), "USD", fx) == Decimal("100")
    assert to_eur(Decimal("50"), "EUR", fx) == Decimal("50")
    assert to_eur(Decimal("10"), "GBP", fx) is None


# ── Command integration (DB) ────────────────────────────────────────────────────

pytestmark = pytest.mark.django_db


def test_command_activates_priced_source():
    p = Product.objects.create(sku_code="KBLANK1U", name="Blank")
    ProductSupplier.objects.create(
        product=p,
        supplier_name="SYMEA",
        po_base_price=Decimal("0"),
        po_currency="EUR",
        is_active=True,
    )
    ProductSupplier.objects.create(
        product=p,
        supplier_name="MIRSAN",
        po_base_price=Decimal("3.45"),
        po_currency="USD",
        is_active=False,
    )
    call_command("fix_active_supplier")
    assert p.suppliers.get(is_active=True).supplier_name == "MIRSAN"
    assert p.suppliers.filter(is_active=True).count() == 1  # one-active invariant


def test_command_leaves_priced_active_untouched():
    p = Product.objects.create(sku_code="KEEP1", name="Keep")
    ProductSupplier.objects.create(
        product=p,
        supplier_name="MIRSAN",
        po_base_price=Decimal("3.45"),
        po_currency="USD",
        is_active=True,
    )
    ProductSupplier.objects.create(
        product=p,
        supplier_name="OTRANS",
        po_base_price=Decimal("2.00"),
        po_currency="USD",
        is_active=False,
    )
    call_command("fix_active_supplier")
    assert p.suppliers.get(is_active=True).supplier_name == "MIRSAN"  # not switched


def test_command_dry_run_writes_nothing():
    p = Product.objects.create(sku_code="DRY1", name="Dry")
    ProductSupplier.objects.create(
        product=p,
        supplier_name="SYMEA",
        po_base_price=Decimal("0"),
        po_currency="EUR",
        is_active=True,
    )
    ProductSupplier.objects.create(
        product=p,
        supplier_name="MIRSAN",
        po_base_price=Decimal("3.45"),
        po_currency="USD",
        is_active=False,
    )
    call_command("fix_active_supplier", "--dry-run")
    assert p.suppliers.get(is_active=True).supplier_name == "SYMEA"  # unchanged
