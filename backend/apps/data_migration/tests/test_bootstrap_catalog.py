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


@override_settings(MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nonexistent-dir-xyz"})
def test_empty_db_missing_sources_is_noop():
    # Fresh DB, no sources dir → graceful no-op (never fails the deploy).
    output = _run()
    assert "nothing to load" in output.lower()
    assert Product.objects.count() == 0
