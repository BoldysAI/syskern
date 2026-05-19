"""Exceptions raised by the migration loader pipeline (CDC §8.4–§8.7)."""
from __future__ import annotations


class LoaderError(Exception):
    """Base class for all loader errors."""


class InvalidRowError(LoaderError):
    """A row cannot be processed due to malformed / unparseable data.

    Triggers an INVALID_FORMAT quarantine entry.
    """

    def __init__(self, message: str, column: str | None = None) -> None:
        super().__init__(message)
        self.column = column


class MissingRequiredFieldError(LoaderError):
    """A required column is present but its value is empty/null.

    Triggers a MISSING_REQUIRED_FIELD quarantine entry.
    """

    def __init__(self, field: str) -> None:
        super().__init__(f"Required field is missing: {field!r}")
        self.field = field


class AmbiguousMatchError(LoaderError):
    """Multiple products matched for a single source row.

    Triggers a DUPLICATE_MATCH quarantine entry.  Stores the candidate UUIDs
    so that the quarantine entry's raw_data can include them for Olivier's
    manual review.
    """

    def __init__(self, candidates: list[str], rule: str) -> None:
        super().__init__(
            f"Ambiguous match via rule {rule!r}: {len(candidates)} candidates found"
        )
        self.candidates = candidates
        self.rule = rule


class HeaderValidationError(LoaderError):
    """The Excel file is missing one or more required column headers.

    Raised before any row is processed; the entire load is aborted.
    """

    def __init__(self, missing: set[str]) -> None:
        super().__init__(f"Missing required columns: {sorted(missing)}")
        self.missing = missing
