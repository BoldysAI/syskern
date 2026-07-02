"""One-shot catalog bootstrap on deploy (CDC §8) — idempotent, deploy-safe.

Runs the initial Excel load **only the first time** — if the catalog is already
populated (or the migration is locked), it does nothing. Designed to run at
container start (after `migrate`), so a fresh environment self-loads once and
every later deploy is a no-op.

Sources are auto-discovered in ``MIGRATION["SOURCES_DIR"]`` by filename glob, so
the confidential .xlsx (gitignored) just need to be present in that dir. A
missing source is skipped with a warning — it never fails the deploy.
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

    def handle(self, *args: Any, **opts: Any) -> None:
        if settings.MIGRATION.get("LOCKED", False):
            self.stdout.write("Migration locked — bootstrap skipped.")
            return
        if not opts["force"] and Product.objects.exists():
            self.stdout.write("Catalog already populated — bootstrap skipped (nothing to do).")
            return

        sources_dir = settings.MIGRATION.get("SOURCES_DIR", "")
        if not sources_dir or not os.path.isdir(sources_dir):
            self.stdout.write(
                self.style.WARNING(f"Sources dir absent ({sources_dir!r}) — nothing to load.")
            )
            return

        loaded = 0
        for src in _SOURCES:
            matches = sorted(glob.glob(os.path.join(sources_dir, src["glob"])))
            if not matches:
                self.stdout.write(self.style.WARNING(f"Source absent: {src['glob']} — skipped."))
                continue
            file_path = matches[0]
            try:
                report = self._load(file_path, src)
                loaded += 1
                self.stdout.write(self.style.SUCCESS(f"Loaded {Path(file_path).name}:\n{report}"))
            except Exception as exc:  # noqa: BLE001 — a bad source must not fail the deploy
                self.stdout.write(self.style.ERROR(f"Source {Path(file_path).name} failed: {exc}"))

        # Market parameters (idempotent) — best effort.
        try:
            call_command("seed_client_market_params")
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(self.style.ERROR(f"Market params seeding failed: {exc}"))

        self.stdout.write(self.style.SUCCESS(f"Bootstrap done ({loaded} source file(s) loaded)."))

    def _load(self, file_path: str, src: _Source):
        loader = LOADER_REGISTRY[src["loader"]]()
        sheet: str | int | None = None
        prefix = src["sheet_prefix"]
        if prefix:
            sheet = self._find_sheet(file_path, prefix)
        config = LoaderConfig(
            file_path=file_path,
            sheet_name=sheet,
            header_row=src["header_row"],
            create_missing=src["create_missing"],
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
