"""Abstract base class for all Excel migration loaders (CDC §8.4).

Subclass contract
-----------------
Concrete loaders must implement:

  column_mapping()   → dict[str, str]          rename Excel columns to canonical names
  required_columns() → set[str]                columns that must be present after renaming
  migration_source   → MigrationSource         class attribute (EXCEL_PRICING, …)
  normalize_row()    → NormalizedRow            clean + cast one pandas row
  build_match_hint() → MatchHint               extract identifiers for the matcher
  apply_update()     → RowOutcome              write enriched data to the DB

Optional hooks (override when needed):

  dedup_key()        → str | None             return a grouping key to merge duplicates
                                               None (default) = no deduplication
  merge_rows()       → pd.Series              merge a group of rows into one
                                               Default: take the row with most non-null values

Transaction strategy
--------------------
The pipeline uses nested ``transaction.atomic()`` blocks (Postgres / Supabase):

  outer BATCH ``atomic()``  (≤ batch_size rows, default 500)
    └── per-ROW inner ``atomic()`` → Django opens a savepoint automatically

If ``_process_row_inner()`` raises, the inner block rolls back that row's ORM
work only; ``MigrationUnmatched`` rows created in the ``except`` path run in
the batch scope and commit with the rest of the batch.  We avoid mixing
``atomic()`` with manual ``savepoint_*`` APIs so behaviour matches Django's
contract.

If the entire batch hits an unexpected error outside the per-row handlers
(e.g. a DB connection drop), Django rolls back the whole batch.  Re-running
with ``--dry-run`` previews which rows would be affected.

dry_run
-------
In dry-run mode, run() wraps the entire execution in a transaction and rolls
it back at the end.  No data is written.  The LoaderReport is still populated
so callers can preview results.
"""
from __future__ import annotations

import abc
import logging
import time
from pathlib import Path
from typing import Any

import pandas as pd
from django.db import transaction

from apps.data_migration.models import MigrationUnmatched, UnmatchedReason
from apps.products.models import MigrationSource, Product

from .exceptions import (
    AmbiguousMatchError,
    HeaderValidationError,
    InvalidRowError,
    MissingRequiredFieldError,
)
from .io import coerce_str, iter_batches, read_sheet, row_to_raw
from .matching import ProductMatcher
from .types import LoaderConfig, LoaderReport, MatchHint, NormalizedRow, RowOutcome

logger = logging.getLogger(__name__)


class BaseExcelLoader(abc.ABC):
    """Template-method base for all Excel migration loaders.

    Do not override `run()`.  Override the hook methods instead.
    """

    # ── Class-level contract (must be set by each concrete loader) ────────────

    migration_source: MigrationSource  # e.g. MigrationSource.EXCEL_PRICING

    # ── Hook: column renaming ─────────────────────────────────────────────────

    @abc.abstractmethod
    def column_mapping(self) -> dict[str, str]:
        """Map raw Excel column names to canonical internal names.

        Keys are the column headers as they appear in the source file (after
        strip-whitespace normalisation done by io.read_sheet).
        Values are the canonical names used by normalize_row() and apply_update().

        Columns not listed here are kept with their original name — they are
        still available in NormalizedRow.raw but not in NormalizedRow.data
        unless the subclass copies them.
        """

    # ── Hook: validation ──────────────────────────────────────────────────────

    @abc.abstractmethod
    def required_columns(self) -> set[str]:
        """Canonical column names that MUST be present after remapping.

        Checked once against the file header before any row is processed.
        Missing columns raise HeaderValidationError and abort the load.
        """

    # ── Hook: row normalisation ───────────────────────────────────────────────

    @abc.abstractmethod
    def normalize_row(self, raw: pd.Series) -> NormalizedRow:
        """Clean and cast one row from the source DataFrame.

        `raw` has the canonical column names (after column_mapping renaming).
        Return a NormalizedRow with:
          - data: typed Python values ready for apply_update()
          - raw: json_safe dict of the original row for quarantine entries

        Raise InvalidRowError or MissingRequiredFieldError on bad data.
        Do NOT call derivations (is_copper_indexed, factory_code extraction,
        etc.) — those live in derivations.py and run after the full migration.
        """

    # ── Hook: match hint extraction ───────────────────────────────────────────

    @abc.abstractmethod
    def build_match_hint(self, row: NormalizedRow) -> MatchHint:
        """Extract a MatchHint from a normalised row for ProductMatcher."""

    # ── Hook: DB update ───────────────────────────────────────────────────────

    @abc.abstractmethod
    def apply_update(self, product: Product, row: NormalizedRow) -> RowOutcome:
        """Write enriched data from `row` onto `product` and save to DB.

        Called only when the matcher found exactly one product.
        Must return a RowOutcome.  Must NOT start or commit outer transactions —
        the per-row nested ``atomic()`` in ``_process_row`` handles rollback on
        failure.

        Raise InvalidRowError for data that passes normalize_row() but fails
        at write-time (e.g. a Decimal overflow), so the row goes to quarantine
        rather than crashing the batch.
        """

    # ── Optional hook: deduplication (for multi-origin files like loader_technique) ──

    def dedup_key(self, row: NormalizedRow) -> str | None:
        """Return a grouping key to merge duplicate source rows.

        None (default) means no deduplication: every row is processed
        independently.  Override in loaders where the same product appears
        on multiple rows (e.g. one row per manufacturing origin).
        """
        return None

    def merge_rows(self, group: pd.DataFrame) -> pd.DataFrame:
        """Merge a group of rows sharing the same dedup_key into one row.

        Default strategy: keep the row with the fewest NaN values (i.e. the
        most complete row), then fill remaining NaNs from the other rows in
        order.

        Override for more specific merge logic.
        """
        if len(group) == 1:
            return group

        # Count non-null values per row; sort descending (most complete first)
        counts = group.notna().sum(axis=1)
        sorted_idx = counts.sort_values(ascending=False).index
        primary = group.loc[sorted_idx[0]].copy()
        for idx in sorted_idx[1:]:
            secondary = group.loc[idx]
            # Fill NaN fields in primary from secondary
            null_mask = primary.isna()
            primary[null_mask] = secondary[null_mask]

        return pd.DataFrame([primary])

    # ── Public entry point ────────────────────────────────────────────────────

    def pre_run(self, config: LoaderConfig) -> None:  # noqa: B027
        """Optional hook called once before the main row-processing loop.

        Override to read per-file metadata (header rows, lookup sheets, etc.)
        that must be available when normalize_row() / apply_update() are called.
        The default implementation does nothing.
        """

    def run(self, config: LoaderConfig) -> LoaderReport:
        """Execute the full load pipeline and return a LoaderReport."""
        start = time.monotonic()
        source_name = Path(config.file_path).name

        logger.info("Starting %s on %s (dry_run=%s)", type(self).__name__, source_name, config.dry_run)

        self.pre_run(config)

        df, sheet_name = read_sheet(config.file_path, config.sheet_name, config.header_row)
        df = self._apply_column_mapping(df)
        self._validate_header(df)

        report = LoaderReport(source_file=source_name, sheet_name=sheet_name, dry_run=config.dry_run)

        matcher = ProductMatcher()
        self._run_dataframe(df, config, matcher, report, source_name)

        report.duration_seconds = time.monotonic() - start
        logger.info("Finished %s:\n%s", type(self).__name__, report)
        return report

    def _run_dataframe(
        self,
        df: pd.DataFrame,
        config: LoaderConfig,
        matcher: ProductMatcher,
        report: LoaderReport,
        source_name: str,
    ) -> None:
        """Process an already-mapped DataFrame through dedup + batch loop.

        Extracted from ``run()`` so that loaders spanning multiple sheets
        (e.g. ``MirsanLoader``) can call it once per sheet with the same
        matcher and aggregate into a single ``report``.
        """
        df, report = self._dedup(df, report)

        if config.dry_run:
            with transaction.atomic():
                self._process_all(df, config, matcher, report, source_name)
                transaction.set_rollback(True)
        else:
            self._process_all(df, config, matcher, report, source_name)

    # ── Internal pipeline ─────────────────────────────────────────────────────

    def _apply_column_mapping(self, df: pd.DataFrame) -> pd.DataFrame:
        mapping = self.column_mapping()
        return df.rename(columns=mapping)

    def _validate_header(self, df: pd.DataFrame) -> None:
        required = self.required_columns()
        present = set(df.columns)
        missing = required - present
        if missing:
            raise HeaderValidationError(missing)

    def _dedup(self, df: pd.DataFrame, report: LoaderReport) -> tuple[pd.DataFrame, LoaderReport]:
        """Apply dedup_key / merge_rows if the subclass requires it."""
        rows_before = len(df)

        # We need to call dedup_key on normalised rows; build a temporary key column.
        # To avoid calling normalize_row twice per row, we compute keys from raw series.
        # Subclasses that override dedup_key() usually inspect canonical column values
        # directly from the DataFrame row, so we pass the series before normalisation.
        keys: list[str | None] = []
        for _, row in df.iterrows():
            try:
                nr = self.normalize_row(row)
                keys.append(self.dedup_key(nr))
            except Exception:
                keys.append(None)  # un-keyed rows pass through as-is

        df = df.copy()
        df["__dedup_key__"] = keys

        no_key = df["__dedup_key__"].isna()
        df_nokey = df[no_key].drop(columns=["__dedup_key__"])
        df_keyed = df[~no_key]

        merged_parts = [df_nokey]
        for _key, group in df_keyed.groupby("__dedup_key__", sort=False):
            group = group.drop(columns=["__dedup_key__"])
            merged = self.merge_rows(group)
            merged_parts.append(merged)

        result = pd.concat(merged_parts, ignore_index=True)
        report.rows_deduped = rows_before - len(result)
        return result, report

    def _process_all(
        self,
        df: pd.DataFrame,
        config: LoaderConfig,
        matcher: ProductMatcher,
        report: LoaderReport,
        source_name: str,
    ) -> None:
        """Iterate over batches and process each row."""
        batches = iter_batches(df, config.batch_size)
        for batch_num, batch_df in enumerate(batches, start=1):
            logger.debug("Processing batch %d/%d (%d rows)", batch_num, len(batches), len(batch_df))
            with transaction.atomic():
                for df_row_idx, raw_row in batch_df.iterrows():
                    # Excel row number = header_row (1-based) + df_row_idx + 1
                    # We use df_row_idx + 2 as a reasonable approximation (1 header + 1-indexed)
                    excel_row = int(df_row_idx) + config.header_row + 2
                    self._process_row(raw_row, excel_row, matcher, report, source_name, config)

    def _process_row(
        self,
        raw_row: pd.Series,
        excel_row: int,
        matcher: ProductMatcher,
        report: LoaderReport,
        source_name: str,
        config: LoaderConfig,
    ) -> None:
        report.rows_total += 1
        try:
            with transaction.atomic():
                self._process_row_inner(raw_row, excel_row, matcher, report, source_name, config)
        except Exception as exc:
            reason = self._classify_exception(exc)
            logger.warning(
                "Row %d of %s → quarantined (%s): %s",
                excel_row,
                source_name,
                reason,
                exc,
                exc_info=logger.isEnabledFor(logging.DEBUG),
            )
            self._log_unmatched(source_name, excel_row, raw_row, reason)
            report.increment_unmatched(reason)

    def _process_row_inner(
        self,
        raw_row: pd.Series,
        excel_row: int,
        matcher: ProductMatcher,
        report: LoaderReport,
        source_name: str,
        config: LoaderConfig,
    ) -> None:
        # Step 1: normalise
        norm = self.normalize_row(raw_row)

        # Step 2: match
        hint = self.build_match_hint(norm)
        result = matcher.match(hint)

        if result.product_id is None:
            reason = result.reason or UnmatchedReason.NO_MATCH
            logger.debug("Row %d: no match (%s)", excel_row, reason)
            self._log_unmatched(source_name, excel_row, raw_row, reason)
            report.increment_unmatched(reason)
            return

        report.rows_matched += 1

        # Step 3: apply update (skip actual DB write in dry-run)
        product = Product.objects.get(pk=result.product_id)
        if not config.dry_run:
            self.apply_update(product, norm)
        report.rows_updated += 1

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _classify_exception(exc: Exception) -> UnmatchedReason:
        if isinstance(exc, MissingRequiredFieldError):
            return UnmatchedReason.MISSING_REQUIRED_FIELD
        if isinstance(exc, AmbiguousMatchError):
            return UnmatchedReason.DUPLICATE_MATCH
        if isinstance(exc, InvalidRowError):
            return UnmatchedReason.INVALID_FORMAT
        return UnmatchedReason.INVALID_FORMAT

    @staticmethod
    def _log_unmatched(
        source_name: str,
        row_number: int,
        raw_row: pd.Series,
        reason: UnmatchedReason,
    ) -> None:
        MigrationUnmatched.objects.create(
            source_file=source_name,
            source_row_number=row_number,
            raw_data=row_to_raw(raw_row),
            reason=reason,
        )

    # ── Utility for subclasses ────────────────────────────────────────────────

    @staticmethod
    def _coerce_str(value: Any) -> str | None:
        return coerce_str(value)
