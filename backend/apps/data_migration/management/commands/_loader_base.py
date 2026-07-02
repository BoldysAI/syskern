"""Shared management command base for all Excel migration loaders (CDC §8.4).

Each concrete loader command (load_po_fournisseurs, load_technique, …) inherits
from BaseLoaderCommand and declares:

  loader_class: type[BaseExcelLoader]   the loader to instantiate and run
  default_sheet: str | int | None       default sheet for this file type

Usage (once implemented by a concrete command):

  docker compose run --rm backend python manage.py load_po_fournisseurs \\
      --file /migration/sources/PO_Symea_March2026.xlsx \\
      --dry-run

  docker compose run --rm backend python manage.py load_technique \\
      --file /migration/sources/UKN_all_items_list.xlsx \\
      --sheet "GTIN code & packing details" \\
      --batch-size 200

The guard-rail MIGRATION_LOCKED=true (CDC §8.9) is enforced here so that every
loader respects it without each command having to implement it.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from apps.data_migration.loaders.base import BaseExcelLoader
from apps.data_migration.loaders.exceptions import HeaderValidationError
from apps.data_migration.loaders.types import LoaderConfig


class BaseLoaderCommand(BaseCommand):
    """Abstract base for management commands that wrap a BaseExcelLoader.

    Subclasses must set `loader_class` and may override `default_sheet`.
    """

    help = "Run a data migration Excel loader (CDC §8.4)."

    # ── Subclass contract ─────────────────────────────────────────────────────

    loader_class: type[BaseExcelLoader]
    default_sheet: str | int | None = None  # None → first sheet
    default_header_row: int = 0  # 0-based

    # ── Argument parsing ──────────────────────────────────────────────────────

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--file",
            required=True,
            metavar="PATH",
            help="Path to the Excel source file.",
        )
        parser.add_argument(
            "--sheet",
            default=None,
            metavar="SHEET",
            help=(f"Sheet name or 0-based index to load.  Defaults to {self.default_sheet!r}."),
        )
        parser.add_argument(
            "--header-row",
            type=int,
            default=self.default_header_row,
            metavar="N",
            help="0-based row index of the header row (default: %(default)s).",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=500,
            metavar="N",
            help="Number of rows per DB transaction batch (default: %(default)s).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Run without writing to the database.  Prints the report only.",
        )
        parser.add_argument(
            "--create-missing",
            action="store_true",
            default=False,
            help=(
                "Create the product for an unmatched row instead of quarantining it "
                "(only for loaders that carry the full product definition, e.g. po_fournisseurs)."
            ),
        )
        parser.add_argument(
            "--log-level",
            default="INFO",
            choices=["DEBUG", "INFO", "WARNING", "ERROR"],
            metavar="LEVEL",
            help="Logging verbosity (default: %(default)s).",
        )

    # ── Command entry point ───────────────────────────────────────────────────

    def handle(self, *args: Any, **options: Any) -> None:
        self._configure_logging(options["log_level"])
        self._check_migration_lock(options["dry_run"])

        sheet = options["sheet"] if options["sheet"] is not None else self.default_sheet

        # Attempt to coerce sheet to int if it looks like one
        if isinstance(sheet, str) and sheet.isdigit():
            sheet = int(sheet)

        config = LoaderConfig(
            file_path=options["file"],
            sheet_name=sheet,
            header_row=options["header_row"],
            batch_size=options["batch_size"],
            dry_run=options["dry_run"],
            create_missing=options["create_missing"],
        )

        loader = self.loader_class()

        try:
            report = loader.run(config)
        except HeaderValidationError as exc:
            raise CommandError(str(exc)) from exc
        except FileNotFoundError as exc:
            raise CommandError(f"File not found: {exc}") from exc
        except Exception as exc:
            raise CommandError(f"Loader failed: {exc}") from exc

        self.stdout.write(str(report))

        if report.rows_quarantined > 0:
            self.stderr.write(
                self.style.WARNING(
                    f"\n{report.rows_quarantined} row(s) sent to quarantine "
                    f"(migration_unmatched).  Review in the admin or via:\n"
                    f'  python manage.py shell -c "'
                    f"from apps.data_migration.models import MigrationUnmatched; "
                    f"print(MigrationUnmatched.objects.filter("
                    f"source_file='{report.source_file}').count())\""
                )
            )

        if report.dry_run:
            self.stdout.write(self.style.WARNING("\n[DRY RUN] No changes were committed."))
        else:
            self.stdout.write(self.style.SUCCESS("\nMigration completed successfully."))

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _configure_logging(level: str) -> None:
        logging.basicConfig(
            level=getattr(logging, level),
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            stream=sys.stderr,
        )

    @staticmethod
    def _check_migration_lock(dry_run: bool) -> None:
        """Enforce the MIGRATION_LOCKED guard-rail (CDC §8.9).

        After production go-live, MIGRATION_LOCKED=true prevents accidental
        re-runs that would overwrite data enriched by Olivier post-migration.
        Dry-run is always allowed regardless of the lock.
        """
        if dry_run:
            return
        if os.environ.get("MIGRATION_LOCKED", "").lower() == "true":
            raise CommandError(
                "MIGRATION_LOCKED=true is set.  The migration is locked after "
                "production go-live (CDC §8.9).  Use --dry-run to preview, or "
                "unset MIGRATION_LOCKED if you are on a fresh environment."
            )
