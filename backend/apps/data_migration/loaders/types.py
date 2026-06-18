"""Immutable dataclasses shared across the loader pipeline (CDC §8.4–§8.8)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from apps.data_migration.models import UnmatchedReason


@dataclass(frozen=True)
class MatchHint:
    """Identifiers extracted from a source row, used by ProductMatcher.

    All fields are optional because real-world files may omit any of them.
    Presence/absence determines which matching rule (CDC §8.6) is tried.
    """

    sku_code: str | None = None
    parent_reference: str | None = None
    factory_code: str | None = None
    # Free-text category hint (universe / range / sub-range) for rule 3
    category: str | None = None


@dataclass(frozen=True)
class MatchResult:
    """Outcome of one ProductMatcher.match() call."""

    product_id: uuid.UUID | None
    reason: UnmatchedReason | None  # non-None only when product_id is None
    rule_used: str | None  # 'exact_sku' | 'parent_factory' | 'factory_category'
    # UUIDs of all candidates found — populated on DUPLICATE_MATCH for traceability
    candidates: tuple[uuid.UUID, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class NormalizedRow:
    """A single source row after cleaning and column remapping.

    `data` holds the loader-specific normalized fields (canonical names, typed
    Python values).  `raw` preserves the original series as a dict so that the
    quarantine entry contains the unmodified source data.
    """

    data: dict[str, Any]
    raw: dict[str, Any]


@dataclass(frozen=True)
class RowOutcome:
    """Result of processing one row through apply_update()."""

    row_number: int  # 1-based Excel row number (header row counts as row 1)
    matched: bool
    updated: bool
    quarantined: bool
    reason: UnmatchedReason | None = None


@dataclass
class LoaderConfig:
    """Runtime configuration passed to BaseExcelLoader.run().

    Separating config from the loader class itself makes testing easier:
    tests can instantiate a loader once and call run() with different configs.
    """

    file_path: str
    sheet_name: str | int | None = None  # None → first sheet
    header_row: int = 0  # 0-based pandas index (0 = first row)
    batch_size: int = 500
    dry_run: bool = False


@dataclass
class LoaderReport:
    """Summary returned by BaseExcelLoader.run() (feeds CDC §8.8 reporting)."""

    source_file: str
    sheet_name: str
    rows_total: int = 0
    rows_matched: int = 0
    rows_updated: int = 0
    rows_skipped_blank: int = 0
    rows_deduped: int = 0  # rows collapsed by dedup_key / merge logic
    rows_unmatched: dict[UnmatchedReason, int] = field(default_factory=dict)
    duration_seconds: float = 0.0
    dry_run: bool = False

    def increment_unmatched(self, reason: UnmatchedReason) -> None:
        self.rows_unmatched[reason] = self.rows_unmatched.get(reason, 0) + 1

    @property
    def rows_quarantined(self) -> int:
        return sum(self.rows_unmatched.values())

    def __str__(self) -> str:
        lines = [
            f"{'[DRY RUN] ' if self.dry_run else ''}LoaderReport — {self.source_file} / {self.sheet_name}",
            f"  Total rows      : {self.rows_total}",
            f"  Blank/skipped   : {self.rows_skipped_blank}",
            f"  Deduped (merged): {self.rows_deduped}",
            f"  Matched         : {self.rows_matched}",
            f"  Updated         : {self.rows_updated}",
            f"  Quarantined     : {self.rows_quarantined}",
        ]
        for reason, count in sorted(self.rows_unmatched.items(), key=lambda x: x[0]):
            lines.append(f"    {reason:<24}: {count}")
        lines.append(f"  Duration        : {self.duration_seconds:.2f}s")
        return "\n".join(lines)
