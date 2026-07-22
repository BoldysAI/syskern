"""Tests for the idempotent one-shot catalog bootstrap (CDC §8)."""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.products.models import MigrationSource, Product

pytestmark = pytest.mark.django_db


def _run(*args: str) -> str:
    out = StringIO()
    call_command("bootstrap_catalog", *args, stdout=out)
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


def test_purge_wipes_migrated_data_then_reruns(tmp_path):
    # --purge wipes the catalog first, then re-bootstraps (here offline + no
    # sources → ends empty). Proves the one-command reset path.
    Product.objects.create(sku_code="OLD1", name="old", migration_source=MigrationSource.MANUAL)
    out = StringIO()
    with override_settings(
        MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nonexistent-dir-xyz"},
        BASE_DIR=tmp_path,
        ODOO={"SYNC_ENABLED": False},
    ):
        call_command("bootstrap_catalog", "--purge", stdout=out)
    assert "purge done" in out.getvalue().lower()
    assert Product.objects.count() == 0


@override_settings(MIGRATION={"LOCKED": True, "SOURCES_DIR": "/nope"})
def test_purge_blocked_when_locked():
    Product.objects.create(sku_code="KEEP", name="k", migration_source=MigrationSource.MANUAL)
    out = StringIO()
    call_command("bootstrap_catalog", "--purge", stdout=out)
    assert "locked" in out.getvalue().lower()
    assert Product.objects.count() == 1  # purge never ran


@pytest.mark.django_db(transaction=True)  # ALTER TABLE ... DISABLE TRIGGER needs a real txn
def test_purge_with_simulations_clears_finalized_sim_and_products(tmp_path):
    from apps.products.models import Product
    from apps.simulations.models import (
        Simulation,
        SimulationLine,
        SimulationStatus,
        SimulationType,
    )

    p = Product.objects.create(sku_code="SIMP1", name="x", migration_source=MigrationSource.MANUAL)
    sim = Simulation.objects.create(label="s", simulation_type=SimulationType.TARIFF)
    SimulationLine.objects.create(simulation=sim, product=p)
    # finalize it (draft→finalized is allowed); now it's un-deletable via the guard.
    Simulation.objects.filter(pk=sim.pk).update(status=SimulationStatus.FINALIZED)

    out = StringIO()
    with override_settings(
        MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nope"},
        BASE_DIR=tmp_path,
        ODOO={"SYNC_ENABLED": False},
    ):
        call_command("bootstrap_catalog", "--purge", "--with-simulations", stdout=out)
    assert Simulation.objects.count() == 0
    assert Product.objects.count() == 0


def test_purge_without_flag_fails_on_pricing_history(tmp_path):
    from django.db.models import ProtectedError

    from apps.products.models import Product
    from apps.simulations.models import Simulation, SimulationLine, SimulationType

    p = Product.objects.create(sku_code="SIMP2", name="x", migration_source=MigrationSource.MANUAL)
    sim = Simulation.objects.create(label="s", simulation_type=SimulationType.TARIFF)
    SimulationLine.objects.create(simulation=sim, product=p)

    with (
        override_settings(
            MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nope"},
            BASE_DIR=tmp_path,
            ODOO={"SYNC_ENABLED": False},
        ),
        pytest.raises(ProtectedError),
    ):
        call_command("bootstrap_catalog", "--purge", stdout=StringIO())


def test_bootstrap_applies_derivations(tmp_path):
    """`bootstrap_catalog` doit dériver les champs déductibles du SKU (CDC §8.5).

    Régression réelle : les dérivations ne vivaient que dans `run_migration.py`
    (orchestrateur one-shot), alors que c'est `bootstrap_catalog` qui tourne au
    déploiement. Résultat en prod : `parent_reference` vide sur tout le catalogue,
    et un champ figé à 0 % dans le widget de complétude.
    """
    Product.objects.create(sku_code="KCFF6A4PZHDBL5-21", name="Câble dérivable")

    with override_settings(
        MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nonexistent-dir-xyz"},
        BASE_DIR=tmp_path,
        ODOO={"SYNC_ENABLED": False},
    ):
        output = _run("--force")

    assert "derivations" in output.lower()
    p = Product.objects.get(sku_code="KCFF6A4PZHDBL5-21")
    assert p.parent_reference == "KCFF6A4PZHDBL5"
    assert p.factory_code == "21"  # suffixe -NN du SKU


def test_derivations_never_fail_the_deploy(tmp_path, monkeypatch):
    """Une dérivation qui explose ne doit pas faire échouer le démarrage."""

    def _boom(*_args, **_kwargs):
        raise RuntimeError("derivation boom")

    monkeypatch.setattr("apps.data_migration.derivations.apply_derivations", _boom)
    with override_settings(
        MIGRATION={"LOCKED": False, "SOURCES_DIR": "/nonexistent-dir-xyz"},
        BASE_DIR=tmp_path,
        ODOO={"SYNC_ENABLED": False},
    ):
        output = _run("--force")
    assert "derivations failed" in output.lower()
    assert "bootstrap done" in output.lower()
