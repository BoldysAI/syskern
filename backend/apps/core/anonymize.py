"""Display-only brand scrubber for the throwaway demo branch.

Masks Syskern / Symea / Unikkern / Amplify in strings that leave the API or
generated artefacts (Excel, Gamma). Never writes to the database.
Do not merge to main.
"""

from __future__ import annotations

import re
from typing import Any

EMPTY = "—"

# Engine identifiers in breakdown metadata — keep so UI mapping still works.
_KEEP_EXACT = frozenset({"syskern", "symea"})

_DOMAIN_RE = re.compile(r"(?i)(?:syskern|symea|unikkern|unnikkern|amplify)(?:\.[a-z]{2,})+")
_TOKEN_RE = re.compile(r"(?i)amplify\s+invest|unnikkern|unikkern|syskern|symea|simea|amplify")
_MULTI_SPACE_RE = re.compile(r"\s{2,}")
_SPACE_COMMA_RE = re.compile(r"\s+,")
_EMPTY_PARENS_RE = re.compile(r"\(\s*\)")
_EDGE_PUNCT_RE = re.compile(r"^[\s\-–—/,]+|[\s\-–—/,]+$")


def anonymize_text(value: str) -> str:
    """Strip client brand tokens from a visible string. Empty result → em dash."""
    if value == "":
        return value
    if value in _KEEP_EXACT:
        return value
    out = _DOMAIN_RE.sub("exemple.com", value)
    out = _TOKEN_RE.sub("", out)
    out = _MULTI_SPACE_RE.sub(" ", out)
    out = _SPACE_COMMA_RE.sub(",", out)
    out = _EMPTY_PARENS_RE.sub("", out)
    out = _EDGE_PUNCT_RE.sub("", out)
    out = out.strip()
    return out if out else EMPTY


def anonymize_json(value: Any) -> Any:
    """Walk JSON-like data and scrub string *values* only (keys are left intact)."""
    if isinstance(value, str):
        return anonymize_text(value)
    if isinstance(value, list):
        return [anonymize_json(item) for item in value]
    if isinstance(value, dict):
        return {key: anonymize_json(nested) for key, nested in value.items()}
    return value
