"""``run_migration`` — orchestrate the one-shot initial migration (CDC §8.4, §8.9).

Runs the four sequential steps (Odoo sync → Excel enrichment → hors-Odoo
creation → validation/derivations) with on-disk resume checkpointing.

Examples
--------
    # Full run (fresh environment)
    docker compose run --rm backend python manage.py run_migration

    # Preview without writing (Odoo/Excel steps are no-ops in dry-run)
    docker compose run --rm backend python manage.py run_migration --dry-run

    # Resume after a failure (auto-detected; or be explicit)
    docker compose run --rm backend python manage.py run_migration --start-from=step_2

    # Re-run everything, discarding the resume checkpoint
    docker compose run --rm backend python manage.py run_migration --reset

Two distinct "reset" notions — do not confuse:
  * ``run_migration --reset``  clears the *resume checkpoint* and re-runs steps.
  * ``migration_reset``        truncates the *DB tables* (separate command).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.data_migration.locking import MigrationLockedError, assert_migration_unlocked
from apps.data_migration.orchestrator import (
    STATUS_COMPLETED,
    MigrationContext,
    MigrationOrchestrator,
    MigrationStepError,
)
from apps.data_migration.steps import build_default_steps


class Command(BaseCommand):
    help = "Run the one-shot initial data migration (CDC §8.4)."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--start-from",
            metavar="STEP",
            default=None,
            help="Resume from a step: index (2), 'step_2', or key (excel_enrichment).",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            default=False,
            help="Discard the resume checkpoint and run every step from the start.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Preview: write nothing. Allowed even when MIGRATION_LOCKED=true.",
        )
        parser.add_argument(
            "--skip-odoo",
            action="store_true",
            default=False,
            help="Skip step 1 (Odoo sync) — e.g. Excel-only re-enrichment.",
        )
        parser.add_argument(
            "--api-version",
            choices=["v16", "v19"],
            default=None,
            help="Odoo instance for step 1 (default: settings ODOO API_VERSION).",
        )
        parser.add_argument(
            "--sources-dir",
            default=None,
            metavar="PATH",
            help="Directory holding Excel sources (default: settings MIGRATION SOURCES_DIR).",
        )
        parser.add_argument(
            "--manifest",
            default=None,
            metavar="PATH",
            help="Path to the JSON sources manifest (default: settings MIGRATION MANIFEST).",
        )
        parser.add_argument(
            "--state-file",
            default=None,
            metavar="PATH",
            help="Resume-checkpoint path (default: settings MIGRATION STATE_FILE).",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            default=False,
            help="Non-interactive: auto-resume from a failed checkpoint without prompting.",
        )
        parser.add_argument(
            "--log-level",
            default="INFO",
            choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        )

    # ── Entry point ─────────────────────────────────────────────────────────

    def handle(self, *args: Any, **options: Any) -> None:
        self._configure_logging(options["log_level"])

        dry_run = options["dry_run"]
        # Guard-rail: a real run is blocked when locked; dry-run is always allowed.
        if not dry_run:
            try:
                assert_migration_unlocked("run_migration")
            except MigrationLockedError as exc:
                raise CommandError(str(exc)) from exc

        state_file = options["state_file"] or settings.MIGRATION["STATE_FILE"]
        orchestrator = MigrationOrchestrator(build_default_steps(), state_path=state_file)

        ctx = self._build_context(options)
        start_from = self._resolve_start(orchestrator, options)

        try:
            checkpoint = orchestrator.run(ctx, start_from=start_from)
        except MigrationStepError as exc:
            raise CommandError(
                f"{exc}\n\nThe checkpoint was saved. Fix the cause, then resume with:\n"
                f"  python manage.py run_migration --start-from=step_{exc.step.index}"
            ) from exc

        self._print_summary(checkpoint, dry_run=dry_run)

    # ── Helpers ─────────────────────────────────────────────────────────────

    def _build_context(self, options: dict[str, Any]) -> MigrationContext:
        sources = options["sources_dir"] or settings.MIGRATION["SOURCES_DIR"]
        manifest = options["manifest"] or settings.MIGRATION.get("MANIFEST") or None
        return MigrationContext(
            dry_run=options["dry_run"],
            sources_dir=Path(sources) if sources else None,
            manifest_path=Path(manifest) if manifest else None,
            odoo_api_version=options["api_version"],
            skip_odoo=options["skip_odoo"],
        )

    def _resolve_start(self, orchestrator: MigrationOrchestrator, options: dict[str, Any]) -> int:
        if options["reset"]:
            orchestrator.clear_checkpoint()
            self.stdout.write(self.style.WARNING("Resume checkpoint discarded (--reset)."))
            return 1

        if options["start_from"]:
            try:
                step = orchestrator.step_by_token(options["start_from"])
            except ValueError as exc:
                raise CommandError(str(exc)) from exc
            return step.index

        resume = orchestrator.resume_index()
        if resume is None:
            return 1

        # A failed/in-progress checkpoint exists → resume, prompting if interactive.
        if options["yes"] or not sys.stdin.isatty():
            self.stdout.write(
                self.style.WARNING(f"Resuming from step {resume} (prior run incomplete).")
            )
            return resume

        answer = (
            input(
                f"A previous migration stopped at step {resume}. "
                f"[R]esume from step {resume} or [S]tart over? [R/s] "
            )
            .strip()
            .lower()
        )
        if answer in {"s", "start", "startover"}:
            orchestrator.clear_checkpoint()
            return 1
        return resume

    def _print_summary(self, checkpoint: dict, *, dry_run: bool) -> None:
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Migration summary"))
        for step in checkpoint.get("steps", []):
            line = (
                f"  [{step['index']}] {step['label']:<28} {step['status']:<8} "
                f"created={step.get('created', 0)} updated={step.get('updated', 0)} "
                f"failed={step.get('failed', 0)}"
            )
            detail = step.get("detail")
            if detail:
                line += f"  ({detail})"
            self.stdout.write(line)

        if checkpoint.get("status") == STATUS_COMPLETED:
            msg = "Migration completed."
            if dry_run:
                msg = "[DRY RUN] Migration preview completed — no data written."
            self.stdout.write(self.style.SUCCESS("\n" + msg))

    @staticmethod
    def _configure_logging(level: str) -> None:
        logging.basicConfig(
            level=getattr(logging, level),
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            stream=sys.stderr,
        )
