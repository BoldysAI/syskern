"""Destructive purge of migrated data, for replaying the migration (CDC §8.9).

Used **only before production go-live** to wipe the migrated tables and re-run
``run_migration`` from a clean slate. After go-live the ``MIGRATION_LOCKED``
guard-rail (CDC §8.9) blocks it — see :mod:`apps.data_migration.locking`.

Scope (CDC §8.9):
  * Purged   : products, product_attribute_values, product_suppliers,
               clients, migration_unmatched.
  * Preserved: attribute_registry, incoterms, transport_modes, transport_presets (reference data
               seeded by Django data migrations — re-seeding is not the
               migration's job).

This module holds the pure logic (no prompts) so it is unit-testable; the
interactive confirmation lives in the ``migration_reset`` management command.
"""

from __future__ import annotations

import logging

from django.db import transaction

from apps.attributes.models import ProductAttributeValue
from apps.clients.models import Client
from apps.products.models import Product, ProductSupplier

from .models import MigrationUnmatched

logger = logging.getLogger("apps.data_migration.reset")


def count_migration_data() -> dict[str, int]:
    """Current row counts for the tables the purge targets (for before/after logs)."""
    return {
        "products": Product.objects.count(),
        "product_attribute_values": ProductAttributeValue.objects.count(),
        "product_suppliers": ProductSupplier.objects.count(),
        "clients": Client.objects.count(),
        "migration_unmatched": MigrationUnmatched.objects.count(),
    }


@transaction.atomic
def reset_migration_data() -> dict[str, int]:
    """Delete all migrated rows in FK-safe order. Returns rows deleted per table.

    Children are deleted before parents so the ``Product`` delete never trips a
    ``PROTECT`` constraint via a child row. ``ProductAttributeValue`` and
    ``ProductSupplier`` cascade from ``Product`` anyway, but we delete them
    explicitly to report accurate per-table counts and to stay independent of
    the cascade configuration.

    Note: ``Product`` is referenced with ``on_delete=PROTECT`` from
    ``simulation_lines``. Pre-production there are no simulations, so this is a
    no-op risk; if a simulation does reference a product the delete raises
    ``ProtectedError`` — which is the correct, loud failure (you should not be
    resetting a database that already has pricing history).
    """
    deleted: dict[str, int] = {}

    deleted["migration_unmatched"] = MigrationUnmatched.objects.all().delete()[0]
    deleted["product_attribute_values"] = ProductAttributeValue.objects.all().delete()[0]
    deleted["product_suppliers"] = ProductSupplier.objects.all().delete()[0]
    # Product delete may cascade to any remaining children; we already cleared
    # the two above, so this counts the products themselves.
    deleted["products"] = Product.objects.all().delete()[0]
    deleted["clients"] = Client.objects.all().delete()[0]

    logger.warning("Migration data reset — rows deleted: %s", deleted)
    return deleted
