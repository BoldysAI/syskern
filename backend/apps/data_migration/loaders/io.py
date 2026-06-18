"""I/O helpers: Excel reading via pandas+openpyxl, and JSON-safe serialisation.

Design decisions:
- We use pandas read_excel with engine='openpyxl' so that the same library
  version handles both reading and the test fixture generation.
- json_safe() converts every non-serialisable type that appears in the real
  source files (NaN, NaT, Decimal, datetime, numpy scalars, Excel error
  strings like #REF! / #N/A) into JSON-compatible Python values, so that
  MigrationUnmatched.raw_data never triggers a serialisation error.
"""

from __future__ import annotations

import math
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pandas as pd

# ─── Excel reading ────────────────────────────────────────────────────────────


def read_sheet(
    file_path: str,
    sheet_name: str | int | None = None,
    header_row: int = 0,
) -> tuple[pd.DataFrame, str]:
    """Read one sheet from an Excel file and return (DataFrame, resolved_sheet_name).

    Args:
        file_path:  Path to the .xlsx file.
        sheet_name: Sheet name (str) or index (int).  None = first sheet.
        header_row: 0-based row index of the header row (default 0 = first row).

    Returns:
        A tuple of (df, resolved_sheet_name).  The DataFrame has string column
        names stripped of leading/trailing whitespace.  Rows that are entirely
        NaN are dropped.

    Raises:
        FileNotFoundError: if the file does not exist.
        ValueError: if the sheet is not found or the header row is out of range.
    """
    xl = pd.ExcelFile(file_path, engine="openpyxl")
    available = xl.sheet_names

    if sheet_name is None:
        resolved = available[0]
    elif isinstance(sheet_name, int):
        try:
            resolved = available[sheet_name]
        except IndexError as exc:
            raise ValueError(
                f"Sheet index {sheet_name} out of range (file has {len(available)} sheets)"
            ) from exc
    else:
        if sheet_name not in available:
            raise ValueError(f"Sheet {sheet_name!r} not found. Available: {available}")
        resolved = sheet_name

    df = pd.read_excel(
        xl,
        sheet_name=resolved,
        header=header_row,
        engine="openpyxl",
        dtype=str,  # keep everything as str initially; loaders cast themselves
    )

    # Normalise column names
    df.columns = [
        str(c).strip() if not str(c).startswith("Unnamed") else f"__col_{i}__"
        for i, c in enumerate(df.columns)
    ]

    # Drop rows that are entirely blank
    df = df.dropna(how="all").reset_index(drop=True)

    return df, resolved


def iter_batches(df: pd.DataFrame, batch_size: int) -> list[pd.DataFrame]:
    """Split a DataFrame into chunks of at most `batch_size` rows."""
    return [df.iloc[i : i + batch_size] for i in range(0, len(df), batch_size)]


# ─── JSON-safe serialisation ──────────────────────────────────────────────────

# Excel error strings produced by openpyxl when a cell contains a formula error
_EXCEL_ERRORS = {"#REF!", "#N/A", "#DIV/0!", "#VALUE!", "#NAME?", "#NULL!", "#NUM!", "#ERROR!"}


def json_safe(value: Any) -> Any:  # noqa: ANN401
    """Recursively convert *value* to a JSON-serialisable Python object.

    Handles:
    - NaN / NaT / None → None
    - Decimal → str (preserves precision, avoids float rounding)
    - datetime / date → ISO 8601 string
    - numpy numeric scalars → Python int / float
    - Excel error strings (#REF!, #N/A, …) → preserved as-is (str)
    - dict / list → recursed
    - Everything else → str() fallback
    """
    if value is None:
        return None

    # NaN / NaT from pandas
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        # Excel errors and empty strings
        stripped = value.strip()
        if not stripped:
            return None
        return stripped  # includes #REF!, #N/A, etc. — preserve for Olivier
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(v) for v in value]

    # numpy scalars and other numeric types
    try:
        import numpy as np  # optional; openpyxl may return them

        if isinstance(value, np.integer):
            return int(value)
        if isinstance(value, np.floating):
            v = float(value)
            return None if (math.isnan(v) or math.isinf(v)) else v
        if isinstance(value, np.bool_):
            return bool(value)
    except ImportError:
        pass

    return str(value)


def row_to_raw(series: pd.Series) -> dict[str, Any]:
    """Convert a pandas Series (one Excel row) to a JSON-safe dict.

    Used to populate MigrationUnmatched.raw_data.
    """
    return {str(k): json_safe(v) for k, v in series.items()}


def coerce_str(value: Any) -> str | None:  # noqa: ANN401
    """Return a stripped non-empty string or None."""
    safe = json_safe(value)
    if safe is None:
        return None
    s = str(safe).strip()
    return s if s else None


def coerce_decimal(value: Any) -> str | None:  # noqa: ANN401
    """Return a decimal string suitable for Decimal(…) or None.

    Handles values like '394.29', 394.29 (float), and Excel errors.
    """
    safe = json_safe(value)
    if safe is None:
        return None
    s = str(safe).strip()
    if not s or s in _EXCEL_ERRORS:
        return None
    try:
        Decimal(s)
        return s
    except Exception:
        return None


def coerce_int(value: Any) -> int | None:  # noqa: ANN401
    """Return an int or None."""
    safe = json_safe(value)
    if safe is None:
        return None
    try:
        return int(float(str(safe)))
    except (ValueError, TypeError):
        return None
