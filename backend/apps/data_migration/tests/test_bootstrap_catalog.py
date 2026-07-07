"""Tests for the idempotent one-shot catalog bootstrap (CDC §8)."""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.products.models import MigrationSource, Product

pytestmark = pytest.mark.django_db


def _run() -> str:
    out = StringIO()
    call_command("bootstrap_catalog", stdout=out)
    return out.getvalue()


def test_skips_when_catalog_populated():
    Product.objects.create(sku_code="EXISTS", name="x", migration_source=MigrationSource.MANUAL)
    output = _run()
    assert "already populated" in output
    assert Product.objects.count() == 1  # nothing loaded / duplicated


@override_settings(MIGRATION={"LOCKED": True, "SOURCES_DIR": "/nope"})
def test_skips_when_locked():
    output = _run()
    assert "locked" in output.lower()
    assert Product.objects.count() == 0


def test_empty_db_missing_sources_is_noop(tmp_path):
    # Fresh DB, neither the configured dir nor the baked-in fallback exists →
    # graceful no-op (never fails the deploy). BASE_DIR is pointed at an empty
    # tmp dir so the `backend/migration_sources/` fallback doesn't kick in.
    with override_settings(
        MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nonexistent-dir-xyz"},
        BASE_DIR=tmp_path,
        # Odoo-first bootstrap now syncs before loading — keep the unit test
        # offline so it stays a pure no-op.
        ODOO={"SYNC_ENABLED": False},
    ):
        output = _run()
    assert "nothing to load" in output.lower()
    assert Product.objects.count() == 0


def test_falls_back_to_baked_in_sources_dir(tmp_path):
    # Configured dir absent, but a baked-in `<BASE_DIR>/migration_sources/` holds a
    # matching source → the resolver picks it up (prod runs with no volume/env var).
    from apps.data_migration.management.commands.bootstrap_catalog import Command

    baked = tmp_path / "migration_sources"
    baked.mkdir()
    (baked / "UKN_RANGE_PRICES_TEST.xlsx").write_bytes(b"stub")  # name matches a _SOURCES glob
    with override_settings(
        MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nonexistent-dir-xyz"},
        BASE_DIR=tmp_path,
    ):
        assert Command()._resolve_sources_dir() == str(baked)
