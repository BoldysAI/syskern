"""Excel loaders for the one-shot initial migration (CDC §8.4).

Each concrete loader lives in its own module and subclasses BaseExcelLoader.
The public surface is minimal: loaders expose only `run()` and return a
`LoaderReport`.  Callers (management commands, orchestrator) never touch the
internal pipeline.
"""

from .base import BaseExcelLoader
from .types import LoaderConfig, LoaderReport, MatchHint, MatchResult, NormalizedRow, RowOutcome

__all__ = [
    "BaseExcelLoader",
    "LoaderConfig",
    "LoaderReport",
    "MatchHint",
    "MatchResult",
    "NormalizedRow",
    "RowOutcome",
]
