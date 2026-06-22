"""One-shot initial-migration orchestrator (CDC §8.4, §8.9).

Runs the four sequential migration steps and persists a *resume checkpoint*
after each one, so a failed run resumes from the failed step instead of
restarting from scratch:

    1. Sync Odoo initiale
    2. Enrichissement Excel
    3. Création produits hors-Odoo
    4. Validation et dérivations

Design
------
The orchestrator is deliberately generic: it knows nothing about Odoo or
Excel. It runs an ordered list of :class:`MigrationStep` objects, each wrapping
a callable that takes a :class:`MigrationContext` and returns a
:class:`StepReport`. The concrete step implementations live in ``steps.py``;
tests inject fake steps. This keeps the resume / checkpoint logic isolated and
unit-testable without a database or external services.

Checkpoint
----------
State is a small JSON file on disk (``settings.MIGRATION["STATE_FILE"]``), *not*
a DB row — it must survive ``migration_reset`` (which truncates DB tables) and
persist across separate ``docker compose run`` invocations.

Resume vs reset (two distinct "reset" notions — do not confuse):
  * ``run_migration --reset``  → clears the *checkpoint* and re-runs all steps.
  * ``migration_reset``        → truncates the *DB tables* (separate command).
"""

from __future__ import annotations

import contextlib
import json
import logging
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path

from django.utils import timezone

logger = logging.getLogger("apps.data_migration.orchestrator")

# Checkpoint status values.
STATUS_IN_PROGRESS = "in_progress"
STATUS_FAILED = "failed"
STATUS_COMPLETED = "completed"


@dataclass
class StepReport:
    """Counts + free-text returned by a step callable."""

    created: int = 0
    updated: int = 0
    failed: int = 0
    detail: str = ""
    skipped: bool = False


@dataclass
class MigrationContext:
    """Inputs handed to every step callable."""

    dry_run: bool = False
    sources_dir: Path | None = None
    manifest_path: Path | None = None
    odoo_api_version: str | None = None
    skip_odoo: bool = False
    options: dict = field(default_factory=dict)


# A step callable: ctx -> StepReport.
StepFunc = Callable[[MigrationContext], StepReport]


@dataclass
class MigrationStep:
    """One ordered migration step."""

    index: int  # 1-based position
    key: str  # machine name, e.g. "odoo_sync"
    label: str  # human label (FR)
    func: StepFunc


class MigrationStepError(RuntimeError):
    """Raised when a step fails. Carries the step index for resume hints."""

    def __init__(self, step: MigrationStep, cause: BaseException) -> None:
        self.step = step
        self.cause = cause
        super().__init__(f"Step {step.index} ({step.key}) failed: {cause}")


class MigrationOrchestrator:
    """Runs the ordered steps with on-disk resume checkpointing."""

    def __init__(self, steps: list[MigrationStep], *, state_path: str | Path) -> None:
        if not steps:
            raise ValueError("MigrationOrchestrator requires at least one step")
        # Defensive: keep steps sorted and re-index 1..N so callers can pass any order.
        self.steps = sorted(steps, key=lambda s: s.index)
        self.state_path = Path(state_path)

    # ── Checkpoint I/O ─────────────────────────────────────────────────────────

    def load_checkpoint(self) -> dict | None:
        """Return the persisted checkpoint dict, or None if absent/unreadable."""
        if not self.state_path.exists():
            return None
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Ignoring unreadable checkpoint %s: %s", self.state_path, exc)
            return None

    def clear_checkpoint(self) -> None:
        """Delete the checkpoint file (used by ``--reset``)."""
        with contextlib.suppress(FileNotFoundError):
            self.state_path.unlink()

    def _write_checkpoint(self, checkpoint: dict) -> None:
        checkpoint["updated_at"] = timezone.now().isoformat()
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic-ish write: tmp then replace, so a crash mid-write never leaves
        # a half-written checkpoint that would block the next resume.
        tmp = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        tmp.write_text(json.dumps(checkpoint, indent=2, default=str), encoding="utf-8")
        tmp.replace(self.state_path)

    # ── Start-index resolution ──────────────────────────────────────────────────

    def step_by_token(self, token: str) -> MigrationStep:
        """Resolve a ``--start-from`` token to a step.

        Accepts the 1-based index ("2"), the ``step_N`` form ("step_2"),
        or the step key ("excel_enrichment").
        """
        raw = token.strip().lower()
        if raw.startswith("step_"):
            raw = raw[len("step_") :]
        if raw.isdigit():
            idx = int(raw)
            for step in self.steps:
                if step.index == idx:
                    return step
            raise ValueError(f"No step with index {idx} (valid: 1..{len(self.steps)})")
        for step in self.steps:
            if step.key == raw:
                return step
        valid = ", ".join(f"{s.index}={s.key}" for s in self.steps)
        raise ValueError(f"Unknown step {token!r}. Valid: {valid}")

    def resume_index(self) -> int | None:
        """If a failed/in-progress checkpoint exists, the index to resume from.

        Returns the failed step's index (re-run it), else None.
        """
        cp = self.load_checkpoint()
        if not cp or cp.get("status") not in {STATUS_FAILED, STATUS_IN_PROGRESS}:
            return None
        failed = cp.get("failed_index")
        if isinstance(failed, int):
            return failed
        # In-progress but no recorded failure → resume after last completed step.
        last = cp.get("last_completed_index", 0)
        return min(int(last) + 1, self.steps[-1].index)

    # ── Run ───────────────────────────────────────────────────────────────────

    def run(self, ctx: MigrationContext, *, start_from: int = 1) -> dict:
        """Run steps from ``start_from`` (1-based) to the end.

        Persists the checkpoint after every step. On a step failure, records
        ``status=failed`` + ``failed_index`` and raises :class:`MigrationStepError`
        so the caller exits non-zero; the checkpoint is left in place for resume.
        Returns the final checkpoint dict on success.
        """
        existing = self.load_checkpoint() or {}
        checkpoint: dict = {
            "status": STATUS_IN_PROGRESS,
            "started_at": existing.get("started_at") or timezone.now().isoformat(),
            "dry_run": ctx.dry_run,
            "last_completed_index": min(start_from - 1, self.steps[-1].index),
            "failed_index": None,
            # Preserve prior step records for steps we skip on resume.
            "steps": existing.get("steps", []) if start_from > 1 else [],
        }
        # Trim any stale records at/after the resume point.
        checkpoint["steps"] = [s for s in checkpoint["steps"] if s.get("index", 0) < start_from]
        self._write_checkpoint(checkpoint)

        for step in self.steps:
            if step.index < start_from:
                logger.info("Skipping step %d (%s) — before start point", step.index, step.key)
                continue

            logger.info("─" * 60)
            logger.info("▶ Step %d/%d — %s (%s)", step.index, len(self.steps), step.label, step.key)
            started = timezone.now()
            t0 = time.monotonic()
            try:
                report = step.func(ctx)
            except Exception as exc:  # noqa: BLE001 — checkpoint then re-raise
                elapsed = time.monotonic() - t0
                logger.exception("✖ Step %d (%s) failed after %.2fs", step.index, step.key, elapsed)
                checkpoint["status"] = STATUS_FAILED
                checkpoint["failed_index"] = step.index
                checkpoint["steps"].append(
                    {
                        "index": step.index,
                        "key": step.key,
                        "label": step.label,
                        "status": STATUS_FAILED,
                        "error": f"{type(exc).__name__}: {exc}",
                        "started_at": started.isoformat(),
                        "duration_seconds": round(elapsed, 3),
                    }
                )
                self._write_checkpoint(checkpoint)
                raise MigrationStepError(step, exc) from exc

            elapsed = time.monotonic() - t0
            status = "skipped" if report.skipped else "success"
            logger.info(
                "✔ Step %d (%s) %s in %.2fs — created=%d updated=%d failed=%d %s",
                step.index,
                step.key,
                status,
                elapsed,
                report.created,
                report.updated,
                report.failed,
                f"({report.detail})" if report.detail else "",
            )
            record = asdict(report)
            record.update(
                {
                    "index": step.index,
                    "key": step.key,
                    "label": step.label,
                    "status": status,
                    "started_at": started.isoformat(),
                    "duration_seconds": round(elapsed, 3),
                }
            )
            checkpoint["steps"].append(record)
            checkpoint["last_completed_index"] = step.index
            self._write_checkpoint(checkpoint)

        checkpoint["status"] = STATUS_COMPLETED
        checkpoint["failed_index"] = None
        self._write_checkpoint(checkpoint)
        logger.info("─" * 60)
        logger.info("✔ Migration completed (%d steps).", len(self.steps))
        return checkpoint
