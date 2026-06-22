"""``migration_reset`` — purge migrated data before replaying (CDC §8.9).

DESTRUCTIVE. Wipes the migrated tables (products, attribute values, suppliers,
clients, quarantine) while preserving reference data (attribute registry,
incoterms, transport modes). Intended **only before production go-live** to
re-run ``run_migration`` from a clean slate.

Guard-rails:
  * Blocked when ``MIGRATION_LOCKED=true`` (CDC §8.9).
  * Interactive confirmation: the operator must type ``RESET`` (skip with
    ``--no-input`` for scripted runbooks).

Example
-------
    docker compose run --rm backend python manage.py migration_reset
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from apps.data_migration.locking import MigrationLockedError, assert_migration_unlocked
from apps.data_migration.reset import count_migration_data, reset_migration_data

CONFIRM_TOKEN = "RESET"


class Command(BaseCommand):
    help = "Purge migrated data so the one-shot migration can be replayed (CDC §8.9)."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--no-input",
            action="store_true",
            default=False,
            help=f"Skip the interactive '{CONFIRM_TOKEN}' confirmation (scripted use).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            stream=sys.stderr,
        )

        # Guard-rail first — never even prompt when locked.
        try:
            assert_migration_unlocked("migration_reset")
        except MigrationLockedError as exc:
            raise CommandError(str(exc)) from exc

        before = count_migration_data()
        self.stdout.write(self.style.WARNING("About to DELETE migrated data (CDC §8.9):"))
        for table, count in before.items():
            self.stdout.write(f"  {table:<28} {count} row(s)")
        self.stdout.write(
            "Reference data (attribute_registry, incoterms, transport_modes) is preserved."
        )

        if not options["no_input"]:
            answer = input(f"\nType '{CONFIRM_TOKEN}' to confirm this destructive purge: ").strip()
            if answer != CONFIRM_TOKEN:
                raise CommandError("Confirmation token mismatch — aborted. Nothing was deleted.")

        deleted = reset_migration_data()

        self.stdout.write(self.style.SUCCESS("\nReset complete — rows deleted:"))
        for table, count in deleted.items():
            self.stdout.write(f"  {table:<28} {count}")
        after = count_migration_data()
        remaining = sum(after.values())
        if remaining:
            self.stdout.write(
                self.style.WARNING(f"\n{remaining} row(s) remain across migrated tables: {after}")
            )
