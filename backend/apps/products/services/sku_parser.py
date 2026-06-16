"""SKU parsing helpers for the product creation wizard (CDC §4.1.3).

Syskern SKUs encode a *specification suffix* at the end of the code:

    KCFF6A4PZHDBL5-21   → factory_code "21",  parent_reference "KCFF6A4PZHDBL5"
    KCFF6A4PZHDBL5-E02  → factory_code "E02", parent_reference "KCFF6A4PZHDBL5"

The suffix is ``-NN`` or ``-ENN`` (1 to 3 digits, optionally prefixed by ``E``).
These helpers feed the wizard auto-suggestion and the ``parse-sku`` endpoint;
the user can always override the proposed values.

Note: the literal ``extract_parent_reference`` regex in the original ticket
(``^(.+?)(-E?\\d{1,3})?$``) is buggy — a non-greedy ``.+?`` with an optional
trailing group matches the whole string, returning the SKU *with* its suffix,
which contradicts the documented examples. We therefore strip the suffix
instead, matching the acceptance criteria (see ``docs/agent/decisions.md``).
"""

from __future__ import annotations

import re

# Specification suffix: a dash followed by an optional ``E`` and 1-3 digits,
# anchored at the end of the SKU.
_SUFFIX_RE = re.compile(r"-(E?\d{1,3})$")


def _normalize(sku: str | None) -> str:
    return (sku or "").strip().upper()


def extract_factory_code(sku: str | None) -> str | None:
    """Return the ``-NN`` / ``-ENN`` suffix of *sku* without its dash.

    >>> extract_factory_code("KCFF6A4PZHDBL5-21")
    '21'
    >>> extract_factory_code("KCFF6A4PZHDBL5-E02")
    'E02'
    >>> extract_factory_code("KCFF6A4PZHDBL5") is None
    True
    """
    match = _SUFFIX_RE.search(_normalize(sku))
    return match.group(1) if match else None


def extract_parent_reference(sku: str | None) -> str | None:
    """Return the SKU stripped of its specification suffix.

    >>> extract_parent_reference("KCFF6A4PZHDBL5-21")
    'KCFF6A4PZHDBL5'
    >>> extract_parent_reference("KCFF6A4PZHDBL5")
    'KCFF6A4PZHDBL5'
    >>> extract_parent_reference("") is None
    True
    """
    normalized = _normalize(sku)
    if not normalized:
        return None
    return _SUFFIX_RE.sub("", normalized)


def parse_sku(sku: str | None) -> dict[str, str | None]:
    """Combined helper returning both derived fields for *sku*."""
    return {
        "sku": _normalize(sku),
        "parent_reference": extract_parent_reference(sku),
        "factory_code": extract_factory_code(sku),
    }
