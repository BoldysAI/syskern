"""MIGRATION_LOCKED guard-rail (CDC §8.9).

The one-shot migration must be impossible to re-run by accident after
production go-live, otherwise a replay would clobber the data Olivier enriched
post-migration. The guard is a single environment variable, `MIGRATION_LOCKED`.

We read it from the environment (not Django settings) so it matches the check
already enforced by the Excel loader commands (`_loader_base.py`) and so a
deploy can flip it without touching the settings module. ``settings.MIGRATION``
mirrors the same value for code that prefers the settings surface.
"""

from __future__ import annotations

import os

ENV_VAR = "MIGRATION_LOCKED"


class MigrationLockedError(RuntimeError):
    """Raised when a destructive migration action is attempted while locked."""


def is_migration_locked() -> bool:
    """Return True when ``MIGRATION_LOCKED`` is set truthy in the environment."""
    return os.environ.get(ENV_VAR, "").strip().lower() in {"1", "true", "yes", "on"}


def assert_migration_unlocked(action: str) -> None:
    """Raise ``MigrationLockedError`` if the migration is locked.

    ``action`` is woven into the message so the operator knows what was blocked.
    """
    if is_migration_locked():
        raise MigrationLockedError(
            f"{ENV_VAR}=true — {action} is blocked after production go-live "
            f"(CDC §8.9). Unset {ENV_VAR} only on a fresh / pre-production "
            f"environment, then retry."
        )
