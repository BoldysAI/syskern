"""Tests for the destructive migration reset (CDC §8.9).

Covers the reset ticket's acceptance criteria:
  * reset purges the migrated tables;
  * reference data (attribute_registry, incoterms, transport_modes) preserved;
  * interactive confirmation is mandatory (token mismatch → abort, no deletion);
  * MIGRATION_LOCKED blocks execution.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.attributes.models import AttributeRegistry, ProductAttributeValue
from apps.clients.models import Client
from apps.data_migration.models import MigrationUnmatched, UnmatchedReason
from apps.data_migration.reset import count_migration_data, reset_migration_data
from apps.market.models import Incoterm, TransportMode
from apps.products.models import Product, ProductSupplier

pytestmark = pytest.mark.django_db


def _seed_migrated_data() -> None:
    p = Product.objects.create(sku_code="SKU-1", name="Product 1")
    ProductSupplier.objects.create(
        product=p, supplier_name="Symea", is_active=True, po_base_price=Decimal("100")
    )
    attr = AttributeRegistry.objects.create(
        code="shielding_type", label={"fr": "Blindage"}, category="technical", data_type="text"
    )
    ProductAttributeValue.objects.create(product=p, attribute=attr, value="S/FTP")
    Client.objects.create(name="Acme", is_prospect=True)
    MigrationUnmatched.objects.create(
        source_file="PO.xlsx", raw_data={"x": 1}, reason=UnmatchedReason.NO_MATCH
    )


def test_reset_purges_migrated_tables():
    _seed_migrated_data()
    assert Product.objects.count() == 1

    deleted = reset_migration_data()

    assert Product.objects.count() == 0
    assert ProductSupplier.objects.count() == 0
    assert ProductAttributeValue.objects.count() == 0
    assert Client.objects.count() == 0
    assert MigrationUnmatched.objects.count() == 0
    assert deleted["products"] == 1
    assert deleted["migration_unmatched"] == 1


def test_reset_preserves_reference_data():
    _seed_migrated_data()
    # Reference data is seeded by data migrations; the attribute we created is
    # itself reference data and must survive (only its *values* are purged).
    registry_before = AttributeRegistry.objects.count()
    incoterms_before = Incoterm.objects.count()
    transports_before = TransportMode.objects.count()
    assert incoterms_before > 0 and transports_before > 0  # seeded on migrate

    reset_migration_data()

    assert AttributeRegistry.objects.count() == registry_before
    assert Incoterm.objects.count() == incoterms_before
    assert TransportMode.objects.count() == transports_before


def test_count_migration_data():
    _seed_migrated_data()
    counts = count_migration_data()
    assert counts == {
        "products": 1,
        "product_attribute_values": 1,
        "product_suppliers": 1,
        "clients": 1,
        "migration_unmatched": 1,
    }


# ── Command-level ───────────────────────────────────────────────────────────


def test_command_requires_confirmation(monkeypatch):
    _seed_migrated_data()
    # Simulate the operator typing the wrong token.
    monkeypatch.setattr("builtins.input", lambda *a, **k: "nope")
    with pytest.raises(CommandError, match="Confirmation token mismatch"):
        call_command("migration_reset")
    # Nothing deleted.
    assert Product.objects.count() == 1


def test_command_confirmation_accepts_reset_token(monkeypatch):
    _seed_migrated_data()
    monkeypatch.setattr("builtins.input", lambda *a, **k: "RESET")
    call_command("migration_reset")
    assert Product.objects.count() == 0


def test_command_no_input_skips_prompt():
    _seed_migrated_data()
    call_command("migration_reset", "--no-input")
    assert Product.objects.count() == 0


def test_command_blocked_when_locked(monkeypatch):
    _seed_migrated_data()
    monkeypatch.setenv("MIGRATION_LOCKED", "true")
    with pytest.raises(CommandError, match="MIGRATION_LOCKED"):
        call_command("migration_reset", "--no-input")
    # Guard-rail fired before any deletion.
    assert Product.objects.count() == 1
