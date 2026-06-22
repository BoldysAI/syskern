"""Tests for step-4 derivations + validation (CDC §8.4 étape 4, §8.5).

Includes the "rejeu intégral → résultat identique" idempotency check, run
through the real default pipeline (Odoo skipped, no Excel manifest, so only
step 4 does work).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from apps.data_migration.derivations import (
    VALIDATION_SOURCE,
    apply_derivations,
    derive_fields_for,
    validate_products,
)
from apps.data_migration.models import MigrationUnmatched
from apps.data_migration.orchestrator import MigrationContext, MigrationOrchestrator
from apps.data_migration.steps import build_default_steps
from apps.products.models import BaseUnit, Product, ProductSupplier

pytestmark = pytest.mark.django_db


def _make_product(**kwargs) -> Product:
    defaults = {"sku_code": "KCFF6A4PZHDBL5-21", "name": "Câble cat7"}
    defaults.update(kwargs)
    return Product.objects.create(**defaults)


def test_derive_sku_fields_when_empty():
    p = _make_product(sku_code="KCFF6A4PZHDBL5-E02", factory_code="", parent_reference="")
    updates = derive_fields_for(p)
    assert updates["factory_code"] == "E02"
    assert updates["parent_reference"] == "KCFF6A4PZHDBL5"


def test_derive_does_not_clobber_existing_sku_fields():
    p = _make_product(factory_code="99", parent_reference="CUSTOM")
    updates = derive_fields_for(p)
    assert "factory_code" not in updates
    assert "parent_reference" not in updates


def test_derive_copper_indexed_from_weight():
    p = _make_product(copper_weight_kg_per_unit=Decimal("18"), is_copper_indexed=False)
    assert derive_fields_for(p)["is_copper_indexed"] is True

    p2 = _make_product(
        sku_code="NOCOPPER-1", copper_weight_kg_per_unit=None, is_copper_indexed=True
    )
    assert derive_fields_for(p2)["is_copper_indexed"] is False


def test_derive_base_unit_km_for_cable():
    cable = _make_product(family="Câbles réseau", base_unit=BaseUnit.UNIT)
    assert derive_fields_for(cable)["base_unit"] == BaseUnit.KM

    rack = _make_product(sku_code="RACK-1", universe="Rack", base_unit=BaseUnit.UNIT)
    assert "base_unit" not in derive_fields_for(rack)  # non-cable left as-is


def test_apply_derivations_is_idempotent():
    _make_product(
        sku_code="KCFF6A4PZHDBL5-21",
        family="Câbles réseau",
        copper_weight_kg_per_unit=Decimal("18"),
    )
    first = apply_derivations()
    assert first == 1
    p = Product.objects.get(sku_code="KCFF6A4PZHDBL5-21")
    assert p.factory_code == "21"
    assert p.parent_reference == "KCFF6A4PZHDBL5"
    assert p.is_copper_indexed is True
    assert p.base_unit == BaseUnit.KM

    # Second run changes nothing.
    assert apply_derivations() == 0


def test_validate_flags_anomalies_to_quarantine():
    # copper-indexed but no weight → 1 anomaly
    _make_product(sku_code="BADCOPPER-1", is_copper_indexed=True, copper_weight_kg_per_unit=None)
    # active supplier missing po_base_price + incoterm → 1 anomaly
    ok = _make_product(sku_code="HASSUP-1")
    ProductSupplier.objects.create(product=ok, supplier_name="Symea", is_active=True)

    count = validate_products(quarantine=True)
    assert count == 2
    logged = MigrationUnmatched.objects.filter(source_file=VALIDATION_SOURCE)
    assert logged.count() == 2


def test_validate_is_idempotent():
    _make_product(sku_code="BADCOPPER-1", is_copper_indexed=True, copper_weight_kg_per_unit=None)
    first = validate_products(quarantine=True)
    second = validate_products(quarantine=True)
    assert first == second == 1
    # No accumulation: prior validation rows are cleared before re-logging.
    assert MigrationUnmatched.objects.filter(source_file=VALIDATION_SOURCE).count() == 1


def test_validate_quarantine_false_does_not_write():
    _make_product(sku_code="BADCOPPER-1", is_copper_indexed=True, copper_weight_kg_per_unit=None)
    assert validate_products(quarantine=False) == 1
    assert MigrationUnmatched.objects.filter(source_file=VALIDATION_SOURCE).count() == 0


def test_full_pipeline_replay_is_identical(tmp_path):
    """Rejeu intégral sur env (déjà migré) → état identique (acceptance)."""
    _make_product(
        sku_code="KCFF6A4PZHDBL5-21",
        family="Câbles réseau",
        copper_weight_kg_per_unit=Decimal("18"),
    )
    _make_product(sku_code="RACK-1", universe="Rack")

    ctx = MigrationContext(skip_odoo=True)  # no Odoo, no manifest → only step 4 works

    def run_once():
        orch = MigrationOrchestrator(build_default_steps(), state_path=tmp_path / "s.json")
        return orch.run(ctx, start_from=1)

    cp1 = run_once()
    snapshot1 = _product_snapshot()

    cp2 = run_once()
    snapshot2 = _product_snapshot()

    assert cp1["status"] == cp2["status"] == "completed"
    # Final DB state is identical between runs.
    assert snapshot1 == snapshot2
    # Stability: the 2nd run's derivation step changes nothing.
    step4_second = next(s for s in cp2["steps"] if s["index"] == 4)
    assert step4_second["updated"] == 0


def _product_snapshot() -> dict:
    return {
        p.sku_code: (p.factory_code, p.parent_reference, p.is_copper_indexed, p.base_unit)
        for p in Product.objects.order_by("sku_code")
    }
