"""Tests for the migration orchestrator: ordering, checkpoint, resume, guard-rail.

These cover the acceptance criteria of the run_migration ticket:
  * the 4 steps run in order;
  * MIGRATION_LOCKED blocks a real run (dry-run still allowed);
  * forcing a failure on step 2 saves a resume checkpoint;
  * resuming from step 2 works and does not re-run step 1.

The orchestrator core is exercised with injected fake steps (no DB / no Odoo)
so the resume logic is isolated; a separate DB-backed test proves the default
pipeline is idempotent (rejeu intégral → résultat identique).
"""

from __future__ import annotations

import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.data_migration.orchestrator import (
    STATUS_COMPLETED,
    STATUS_FAILED,
    MigrationContext,
    MigrationOrchestrator,
    MigrationStep,
    MigrationStepError,
    StepReport,
)


def _steps_recording(calls: list[int], *, fail_on: int | None = None) -> list[MigrationStep]:
    """Build 4 steps that append their index to *calls*; one optionally raises."""

    def make(idx: int):
        def func(ctx: MigrationContext) -> StepReport:
            if fail_on is not None and idx == fail_on:
                raise RuntimeError(f"boom at step {idx}")
            calls.append(idx)
            return StepReport(created=idx, detail=f"ran {idx}")

        return func

    return [
        MigrationStep(1, "odoo_sync", "Sync Odoo", make(1)),
        MigrationStep(2, "excel_enrichment", "Excel", make(2)),
        MigrationStep(3, "create_non_odoo", "Hors-Odoo", make(3)),
        MigrationStep(4, "validate_derive", "Validation", make(4)),
    ]


def test_steps_run_in_order(tmp_path):
    calls: list[int] = []
    orch = MigrationOrchestrator(_steps_recording(calls), state_path=tmp_path / "state.json")
    checkpoint = orch.run(MigrationContext(), start_from=1)

    assert calls == [1, 2, 3, 4]
    assert checkpoint["status"] == STATUS_COMPLETED
    assert [s["index"] for s in checkpoint["steps"]] == [1, 2, 3, 4]
    assert checkpoint["last_completed_index"] == 4


def test_failure_on_step_2_saves_checkpoint(tmp_path):
    calls: list[int] = []
    state = tmp_path / "state.json"
    orch = MigrationOrchestrator(_steps_recording(calls, fail_on=2), state_path=state)

    with pytest.raises(MigrationStepError) as exc:
        orch.run(MigrationContext(), start_from=1)

    assert exc.value.step.index == 2
    assert calls == [1]  # step 1 ran, step 2 raised before recording

    saved = json.loads(state.read_text())
    assert saved["status"] == STATUS_FAILED
    assert saved["failed_index"] == 2
    assert saved["last_completed_index"] == 1
    # Only step 1's record is kept, plus the failed step-2 record.
    statuses = {s["index"]: s["status"] for s in saved["steps"]}
    assert statuses == {1: "success", 2: STATUS_FAILED}


def test_resume_from_step_2_skips_step_1(tmp_path):
    state = tmp_path / "state.json"

    # First run fails at step 2.
    calls_first: list[int] = []
    orch = MigrationOrchestrator(_steps_recording(calls_first, fail_on=2), state_path=state)
    with pytest.raises(MigrationStepError):
        orch.run(MigrationContext(), start_from=1)
    assert calls_first == [1]

    # Resume: a fresh orchestrator with now-passing steps, starting where it stopped.
    calls_second: list[int] = []
    orch2 = MigrationOrchestrator(_steps_recording(calls_second), state_path=state)
    resume = orch2.resume_index()
    assert resume == 2

    checkpoint = orch2.run(MigrationContext(), start_from=resume)
    assert calls_second == [2, 3, 4]  # step 1 NOT re-run
    assert checkpoint["status"] == STATUS_COMPLETED
    # The step-1 success record from the first run is preserved.
    statuses = {s["index"]: s["status"] for s in checkpoint["steps"]}
    assert statuses == {1: "success", 2: "success", 3: "success", 4: "success"}


def test_resume_index_none_when_completed(tmp_path):
    calls: list[int] = []
    orch = MigrationOrchestrator(_steps_recording(calls), state_path=tmp_path / "s.json")
    orch.run(MigrationContext(), start_from=1)
    assert orch.resume_index() is None  # nothing to resume after success


def test_clear_checkpoint(tmp_path):
    state = tmp_path / "s.json"
    orch = MigrationOrchestrator(_steps_recording([], fail_on=3), state_path=state)
    with pytest.raises(MigrationStepError):
        orch.run(MigrationContext())
    assert state.exists()
    orch.clear_checkpoint()
    assert not state.exists()
    assert orch.resume_index() is None


@pytest.mark.parametrize(
    "token,expected_index",
    [("2", 2), ("step_2", 2), ("excel_enrichment", 2), ("STEP_4", 4), ("odoo_sync", 1)],
)
def test_step_by_token(tmp_path, token, expected_index):
    orch = MigrationOrchestrator(_steps_recording([]), state_path=tmp_path / "s.json")
    assert orch.step_by_token(token).index == expected_index


def test_step_by_token_invalid(tmp_path):
    orch = MigrationOrchestrator(_steps_recording([]), state_path=tmp_path / "s.json")
    with pytest.raises(ValueError):
        orch.step_by_token("nope")


# ── Command-level guard-rail (CDC §8.9) ─────────────────────────────────────


def test_command_blocked_when_locked(monkeypatch, tmp_path):
    monkeypatch.setenv("MIGRATION_LOCKED", "true")
    with pytest.raises(CommandError, match="MIGRATION_LOCKED"):
        call_command("run_migration", state_file=str(tmp_path / "s.json"))


def test_command_dry_run_allowed_when_locked(monkeypatch, tmp_path, db):
    """Dry-run must run even when locked (it writes nothing)."""
    monkeypatch.setenv("MIGRATION_LOCKED", "true")
    # No Odoo configured + no manifest → every step skips or no-ops; no writes.
    call_command("run_migration", "--dry-run", "--skip-odoo", state_file=str(tmp_path / "s.json"))
    saved = json.loads((tmp_path / "s.json").read_text())
    assert saved["status"] == STATUS_COMPLETED
    assert saved["dry_run"] is True
