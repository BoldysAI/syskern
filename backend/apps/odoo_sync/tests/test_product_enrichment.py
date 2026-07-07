"""Odoo → Product enrichment: brand, DoP number, and UoM → BaseUnit.

Odoo `product.template` carries brand_id, x_studio_num_dop_* and uom_id, but
the sync used to drop them. The runner now fills them *additively* — Odoo and
Excel complement each other (CDC §2.1), so a value Odoo doesn't provide must
never wipe one seeded elsewhere (e.g. the initial Excel migration).
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.utils import timezone

from apps.odoo_sync.models import SyncLog, SyncScope, SyncStatus, SyncType
from apps.odoo_sync.schemas import OdooProduct
from apps.odoo_sync.services.runner import _uom_to_base_unit, _upsert_product
from apps.products.models import BaseUnit, Product, ProductSupplier

pytestmark = pytest.mark.django_db


def _log() -> SyncLog:
    return SyncLog.objects.create(
        sync_type=SyncType.MANUAL,
        scope=SyncScope.PRODUCTS,
        odoo_api_version="v19",
        started_at=timezone.now(),
        status=SyncStatus.RUNNING,
        triggered_by="test",
    )


@pytest.mark.parametrize(
    ("uom", "expected"),
    [
        ("Units", BaseUnit.UNIT),
        ("units", BaseUnit.UNIT),
        ("PC", BaseUnit.UNIT),
        ("Pcs", BaseUnit.UNIT),
        ("KM", BaseUnit.KM),
        ("Kilometre", BaseUnit.KM),
        ("M", BaseUnit.M),
        ("kg", ""),  # unknown → caller keeps existing value
        ("", ""),
        (None, ""),
    ],
)
def test_uom_to_base_unit(uom, expected) -> None:
    assert _uom_to_base_unit(uom) == expected


def test_upsert_fills_brand_dop_uom() -> None:
    op = OdooProduct(
        odoo_id=501,
        sku_code="ENR-1",
        name="Câble enrichi",
        brand="Boldys",
        dop_number="DOP-CN-9",
        uom_name="KM",
        standard_price_eur=Decimal("8.5"),
    )
    _upsert_product(op, _log(), "v19", Product, ProductSupplier)

    p = Product.objects.get(sku_code="ENR-1")
    assert p.brand == "Boldys"
    assert p.dop_number == "DOP-CN-9"
    assert p.base_unit == BaseUnit.KM
    assert p.uom == "KM"  # real Odoo unit kept verbatim


def test_apply_packaging_maps_named_levels() -> None:
    from apps.odoo_sync.adapters.v16 import apply_packaging

    op = OdooProduct(odoo_id=1, sku_code="X", name="X")
    apply_packaging(op, {"PRIMARY": 1, "SECONDARY": 30, "TERTIARY": 60, "LOGISTIC": 720})
    assert op.primary_packaging_qty == 1
    assert op.secondary_packaging_qty == 30
    assert op.tertiary_packaging_qty == 60
    assert op.pallet_qty == 720


def test_upsert_writes_odoo_packaging() -> None:
    op = OdooProduct(
        odoo_id=601,
        sku_code="PKG-1",
        name="Câble conditionné",
        primary_packaging_qty=1,
        secondary_packaging_qty=30,
        tertiary_packaging_qty=60,
        pallet_qty=720,
    )
    _upsert_product(op, _log(), "v19", Product, ProductSupplier)
    p = Product.objects.get(sku_code="PKG-1")
    assert p.primary_packaging_qty == 1
    assert p.secondary_packaging_qty == 30
    assert p.tertiary_packaging_qty == 60
    assert p.pallet_qty == 720


def test_upsert_keeps_real_uom_even_when_unmapped() -> None:
    # A UoM the engine can't normalise (e.g. kg) must still be stored verbatim
    # on `uom` — full fidelity — while base_unit stays at its default.
    op = OdooProduct(odoo_id=503, sku_code="ENR-3", name="Au kilo", uom_name="kg")
    _upsert_product(op, _log(), "v19", Product, ProductSupplier)

    p = Product.objects.get(sku_code="ENR-3")
    assert p.uom == "kg"  # kept verbatim
    assert p.base_unit == BaseUnit.UNIT  # default, engine can't convert kg


def test_upsert_does_not_wipe_seeded_values_when_odoo_empty() -> None:
    # Values seeded from the Excel migration must survive a later Odoo sync
    # that carries no brand/dop and an unmappable UoM.
    Product.objects.create(
        sku_code="ENR-2",
        name="Seed",
        brand="ExcelBrand",
        dop_number="DOP-SEED",
        base_unit=BaseUnit.M,
    )
    op = OdooProduct(odoo_id=502, sku_code="ENR-2", name="Seed", uom_name="kg")
    _upsert_product(op, _log(), "v19", Product, ProductSupplier)

    p = Product.objects.get(sku_code="ENR-2")
    assert p.brand == "ExcelBrand"  # not wiped
    assert p.dop_number == "DOP-SEED"  # not wiped
    assert p.base_unit == BaseUnit.M  # unknown UoM → kept
