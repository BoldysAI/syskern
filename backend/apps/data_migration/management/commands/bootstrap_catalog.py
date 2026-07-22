"""One-shot catalog bootstrap on deploy (CDC §8) — idempotent, deploy-safe.

Runs the initial Excel load **only the first time** — if the catalog is already
populated (or the migration is locked), it does nothing. Designed to run at
container start (after `migrate`), so a fresh environment self-loads once and
every later deploy is a no-op.

Sources are auto-discovered by filename glob: first in ``MIGRATION["SOURCES_DIR"]``
(a mounted volume), then falling back to the Excel baked into the image at
``backend/migration_sources/`` — so prod self-loads with no volume and no env var.
A missing source is skipped with a warning — it never fails the deploy.
"""

from __future__ import annotations

import glob
import os
from pathlib import Path
from typing import Any, TypedDict

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand

from apps.data_migration.loaders.types import LoaderConfig
from apps.data_migration.steps import LOADER_REGISTRY
from apps.products.models import Product


class _Source(TypedDict):
    glob: str
    loader: str
    sheet_prefix: str | None  # auto-detect a dated sheet; None → loader's own sheets
    header_row: int
    create_missing: bool


# Ordered sources. `sheet_prefix` auto-detects a dated sheet (e.g. "PO & SC Dec
# 2026"); None lets the loader pick its own sheets (AYP auto-detects).
_SOURCES: list[_Source] = [
    {
        "glob": "UKN_RANGE_PRICES*.xlsx",
        "loader": "po_fournisseurs",
        "sheet_prefix": "PO & SC",
        "header_row": 12,
        "create_missing": True,
    },
    {
        "glob": "LAN_CABLE_PRICE_LIST*.xlsx",
        "loader": "po_ayp",
        "sheet_prefix": None,
        "header_row": 0,
        "create_missing": False,
    },
]


class Command(BaseCommand):
    help = "One-shot catalog bootstrap from the client Excel (idempotent, deploy-safe)."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Run even if the catalog is already populated (still respects MIGRATION_LOCKED).",
        )
        parser.add_argument(
            "--purge",
            action="store_true",
            default=False,
            help=(
                "DESTRUCTIVE — wipe the migrated data first (CDC §8.9: products, suppliers, "
                "attribute values, clients, quarantine), then re-bootstrap Odoo-first. Fails "
                "loudly if a simulation references a product (pricing history present)."
            ),
        )
        parser.add_argument(
            "--with-simulations",
            action="store_true",
            default=False,
            help=(
                "With --purge: ALSO delete offers + simulations (incl. finalized/archived, "
                "bypassing the DB guard triggers) so the product purge can proceed. "
                "DESTROYS pricing history — use only for a full pre-go-live reset."
            ),
        )

    def handle(self, *args: Any, **opts: Any) -> None:
        if settings.MIGRATION.get("LOCKED", False):
            self.stdout.write("Migration locked — bootstrap skipped.")
            return

        if opts["purge"]:
            from apps.data_migration.reset import count_migration_data, reset_migration_data

            if opts["with_simulations"]:
                self._purge_simulations_and_offers()
            self.stdout.write(
                self.style.WARNING(f"--purge: wiping migrated data {count_migration_data()}")
            )
            deleted = reset_migration_data()
            self.stdout.write(self.style.SUCCESS(f"Purge done — deleted {deleted}"))

        if not opts["force"] and not opts["purge"] and Product.objects.exists():
            self.stdout.write("Catalog already populated — bootstrap skipped (nothing to do).")
            return

        # CDC §8.4 Étape 1 — Odoo is the source of truth: sync it FIRST so the
        # Excel step *enriches* (and quarantines unmatched SKUs) instead of
        # creating every product. Only when Odoo is unavailable do we fall back
        # to bootstrapping the catalog from the Excel (create_missing).
        odoo_synced = self._sync_odoo_first()

        # Pas d'Excel ≠ rien à faire : un catalogue peut venir d'Odoo seul, et les
        # étapes de fin (dérivations, paramètres marché, activation fournisseur)
        # portent sur l'état de la base, pas sur les fichiers. On saute donc le
        # chargement sans court-circuiter la suite.
        sources_dir = self._resolve_sources_dir()
        if not sources_dir:
            self.stdout.write(
                self.style.WARNING("No sources dir with client Excel found — nothing to load.")
            )
        else:
            self.stdout.write(f"Loading client Excel from {sources_dir}")

        loaded = 0
        for src in _SOURCES if sources_dir else []:
            matches = sorted(glob.glob(os.path.join(sources_dir, src["glob"])))
            if not matches:
                self.stdout.write(self.style.WARNING(f"Source absent: {src['glob']} — skipped."))
                continue
            file_path = matches[0]
            # Odoo-first: enrich only (unmatched → quarantine). No Odoo → bootstrap.
            create_missing = src["create_missing"] and not odoo_synced
            try:
                report = self._load(file_path, src, create_missing)
                loaded += 1
                self.stdout.write(self.style.SUCCESS(f"Loaded {Path(file_path).name}:\n{report}"))
            except Exception as exc:  # noqa: BLE001 — a bad source must not fail the deploy
                self.stdout.write(self.style.ERROR(f"Source {Path(file_path).name} failed: {exc}"))

        # Dérivations CDC §8.5 — `factory_code` / `parent_reference` se déduisent du
        # SKU. Elles ne vivaient que dans `run_migration.py` (orchestrateur one-shot),
        # alors que c'est CE chemin qui tourne au déploiement : les deux champs
        # restaient donc vides sur tout le catalogue (0 % de complétude, constaté en
        # prod le 2026-07-22). Idempotent : ne remplit que ce qui est vide.
        try:
            from apps.data_migration.derivations import apply_derivations

            derived = apply_derivations()
            self.stdout.write(self.style.SUCCESS(f"Derivations: {derived} product(s) enriched"))
        except Exception as exc:  # noqa: BLE001 — ne doit jamais faire échouer le deploy
            self.stdout.write(self.style.ERROR(f"Derivations failed: {exc}"))

        # Market parameters (idempotent) — best effort.
        try:
            call_command("seed_client_market_params")
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(self.style.ERROR(f"Market params seeding failed: {exc}"))

        # Pricing readiness — the Excel step added the real factory prices AFTER
        # the sync's activation ran, so re-assert the priced-supplier activation
        # now (CDC §3.2). Without this the engine can't price most SKUs.
        try:
            from apps.products.management.commands.fix_active_supplier import (
                activate_priced_suppliers,
            )

            r = activate_priced_suppliers()
            self.stdout.write(
                self.style.SUCCESS(
                    f"Supplier activation: {r['fixed_single'] + r['fixed_multi']} products fixed "
                    f"({r['already_ok']} already priced, {r['no_price']} without price)"
                )
            )
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(self.style.ERROR(f"Supplier activation failed: {exc}"))

        self.stdout.write(self.style.SUCCESS(f"Bootstrap done ({loaded} source file(s) loaded)."))

    def _purge_simulations_and_offers(self) -> None:
        """Delete offers + simulations, incl. finalized/archived ones.

        The DB triggers (migration simulations/0003) block deleting a finalized/
        archived simulation and its lines; there is no UI/API path to remove
        them either (by design). For a full pre-go-live reset we disable those
        guard triggers, delete offers (FK-PROTECT parents) then simulations
        (cascades lines + recalculations), and re-enable the triggers.
        """
        from django.db import connection

        from apps.offers.models import Offer
        from apps.simulations.models import Simulation

        with connection.cursor() as cur:
            cur.execute(
                "ALTER TABLE simulation_lines "
                "DISABLE TRIGGER simulation_lines_guard_finalized_parent_trigger;"
            )
            cur.execute(
                "ALTER TABLE simulations DISABLE TRIGGER simulations_guard_finalized_trigger;"
            )
        try:
            n_offers = Offer.objects.all().delete()[0]
            n_sims = Simulation.objects.all().delete()[0]
            self.stdout.write(
                self.style.WARNING(
                    f"--with-simulations: deleted {n_offers} offer row(s) + {n_sims} "
                    f"simulation row(s) (guard triggers bypassed)."
                )
            )
        finally:
            with connection.cursor() as cur:
                cur.execute(
                    "ALTER TABLE simulations ENABLE TRIGGER simulations_guard_finalized_trigger;"
                )
                cur.execute(
                    "ALTER TABLE simulation_lines "
                    "ENABLE TRIGGER simulation_lines_guard_finalized_parent_trigger;"
                )

    def _resolve_sources_dir(self) -> str:
        """First candidate dir that actually holds one of our source globs.

        Prefers the configured ``MIGRATION_SOURCES_DIR`` (a mounted volume), then
        falls back to the Excel baked into the image at ``backend/migration_sources/``
        — so prod self-loads with no volume and no env var to set.
        """
        candidates = [
            settings.MIGRATION.get("SOURCES_DIR", ""),
            str(settings.BASE_DIR / "migration_sources"),
        ]
        for candidate in candidates:
            if not candidate or not os.path.isdir(candidate):
                continue
            has_source = any(glob.glob(os.path.join(candidate, src["glob"])) for src in _SOURCES)
            if has_source:
                return candidate
        return ""

    def _sync_odoo_first(self) -> bool:
        """CDC §8.4 Étape 1 — pull products from Odoo before the Excel step.

        Returns ``True`` when Odoo produced products (so the Excel loaders should
        enrich only). Disabled/failed/empty Odoo → ``False`` (Excel bootstraps).
        Never fails the deploy.
        """
        if not settings.ODOO.get("SYNC_ENABLED"):
            self.stdout.write("Odoo sync disabled — Excel will bootstrap the catalog.")
            return False
        try:
            from apps.odoo_sync.models import SyncLog, SyncScope, SyncType
            from apps.odoo_sync.services.runner import sync

            # Bootstrap is a full load: drop prior sync watermarks so the sync
            # pulls the whole catalog (not just modified-since-last-run).
            SyncLog.objects.filter(scope__in=[SyncScope.PRODUCTS, SyncScope.ALL]).delete()
            log = sync(
                scope=SyncScope.PRODUCTS, sync_type=SyncType.MANUAL, triggered_by="bootstrap"
            )
            has_odoo_products = Product.objects.filter(odoo_id__isnull=False).exists()
            self.stdout.write(
                self.style.SUCCESS(
                    f"Odoo sync ({log.odoo_api_version}): {log.status} "
                    f"created={log.items_created} updated={log.items_updated}"
                )
            )
            return has_odoo_products
        except Exception as exc:  # noqa: BLE001 — Odoo issues must not fail the deploy
            self.stdout.write(
                self.style.WARNING(f"Odoo sync failed ({exc}) — Excel will bootstrap the catalog.")
            )
            return False

    def _load(self, file_path: str, src: _Source, create_missing: bool):
        loader = LOADER_REGISTRY[src["loader"]]()
        sheet: str | int | None = None
        prefix = src["sheet_prefix"]
        if prefix:
            sheet = self._find_sheet(file_path, prefix)
        config = LoaderConfig(
            file_path=file_path,
            sheet_name=sheet,
            header_row=src["header_row"],
            create_missing=create_missing,
        )
        return loader.run(config)

    @staticmethod
    def _find_sheet(file_path: str, prefix: str) -> str | None:
        """Return the first sheet whose name starts with *prefix* (dated sheets)."""
        import openpyxl

        wb = openpyxl.load_workbook(file_path, read_only=True)
        try:
            for name in wb.sheetnames:
                if name.strip().startswith(prefix):
                    return name
        finally:
            wb.close()
        return None
