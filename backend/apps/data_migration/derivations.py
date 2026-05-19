"""Automatic field derivations for the initial data migration (CDC §8.5).

All functions are **pure** — no Django ORM imports, no DB access.
This makes them 100% unit-testable without ``@pytest.mark.django_db``.

Callers (management commands, loaders) are responsible for:
  - Fetching the required inputs from the database.
  - Persisting the returned values back to model instances.

SKU naming convention (Syskern / Symea)
----------------------------------------
A full SKU may carry a factory suffix that identifies the manufacturing origin:

  ``KCFF6A4PZHDBL5-21``   → factory "21"  (China — HT)
  ``KCFF6A4PZHDBL5-E02``  → factory "E02" (Turkey — KK)
  ``KPS600ZH``            → no suffix, factory unknown

The suffix pattern is ``-[E]?\\d+`` at the *end* of the SKU string.
SKUs without this pattern have no derivable factory code or parent reference.
"""
from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_SUFFIX_RE = re.compile(r"-([E]?\d+)$")


def _split_sku(sku: str) -> tuple[str, str | None]:
    """Return ``(base, suffix)`` where suffix is the factory segment or None.

    >>> _split_sku("KCFF6A4PZHDBL5-21")
    ('KCFF6A4PZHDBL5', '21')
    >>> _split_sku("KCFF6A4-E02")
    ('KCFF6A4', 'E02')
    >>> _split_sku("KPS600ZH")
    ('KPS600ZH', None)
    """
    m = _SUFFIX_RE.search(sku)
    if m:
        return sku[: m.start()], m.group(1)
    return sku, None


# ---------------------------------------------------------------------------
# Public derivation functions
# ---------------------------------------------------------------------------


def derive_is_copper_indexed(copper_weight: Optional[Decimal]) -> bool:
    """Return True if the product carries a positive copper weight.

    A product is copper-indexed when its price depends on the LME copper spot
    price.  The presence of a strictly positive ``copper_weight_kg_per_unit``
    is the only trigger (CDC §8.5).

    Args:
        copper_weight: The ``copper_weight_kg_per_unit`` field value, or None
            when not provided by the source file.

    Returns:
        True if ``copper_weight`` is a positive Decimal, False otherwise.

    Examples:
        >>> derive_is_copper_indexed(Decimal("17.5"))
        True
        >>> derive_is_copper_indexed(Decimal("0"))
        False
        >>> derive_is_copper_indexed(None)
        False
    """
    return copper_weight is not None and copper_weight > Decimal(0)


def derive_factory_code(sku: str) -> Optional[str]:
    """Extract the factory-origin suffix from a Syskern SKU.

    The suffix must match the pattern ``-[E]?\\d+`` at the end of the SKU.
    This encodes the manufacturing origin (e.g. ``21`` for China-HT,
    ``E02`` for Turkey-KK).

    Args:
        sku: A Syskern SKU string (e.g. ``"KCFF6A4PZHDBL5-21"``).

    Returns:
        The suffix without the leading dash, or None if the SKU does not
        follow the convention.

    Note:
        This function operates on the SKU string as per CDC §8.5.  Some
        loaders derive ``factory_code`` from the supplier's ``internal_code``
        field instead — see ``loader_po_fournisseurs.py`` for that variant.

    Examples:
        >>> derive_factory_code("KCFF6A4PZHDBL5-21")
        '21'
        >>> derive_factory_code("KCFF6A4-E02")
        'E02'
        >>> derive_factory_code("KPS600ZH")
        None
        >>> derive_factory_code("KPS-600-ZH")  # non-numeric suffix
        None
    """
    _, suffix = _split_sku(sku)
    return suffix


def derive_parent_reference(sku: str) -> Optional[str]:
    """Return the SKU prefix that precedes the factory suffix.

    For products that share a commercial identity across multiple manufacturing
    origins, the ``parent_reference`` is the SKU without the trailing
    ``-[E]?\\d+`` segment (CDC §8.5 — "Code SKU avant le suffixe").

    When the SKU has no recognisable suffix, this function returns ``None``
    (not the SKU itself) to distinguish "parent not derivable" from
    "parent = self", which are different concepts in the matching cascade.

    Args:
        sku: A Syskern SKU string.

    Returns:
        The base SKU without the factory suffix, or None if no suffix
        is present.

    Examples:
        >>> derive_parent_reference("KCFF6A4PZHDBL5-21")
        'KCFF6A4PZHDBL5'
        >>> derive_parent_reference("KCFF6A4-E02")
        'KCFF6A4'
        >>> derive_parent_reference("KPS600ZH")
        None
    """
    base, suffix = _split_sku(sku)
    return base if suffix is not None else None


def derive_base_unit(category_path: str) -> str:
    """Return the selling unit for a product based on its category hierarchy.

    Cables are sold by the kilometre in Syskern's commercial practice.  The
    rule is: if the word *câble* (case-insensitive) appears anywhere in the
    product's category path, the base unit is ``'km'``; otherwise ``'unit'``
    (CDC §8.5 — confirmed by Olivier).

    Args:
        category_path: A free-form string built by the caller as the
            concatenation of the hierarchy fields:
            ``f"{universe} {family} {range} {sub_range}"``.
            May be empty.

    Returns:
        ``'km'`` if *câble* is found, ``'unit'`` otherwise.

    Examples:
        >>> derive_base_unit("COPPER Câbles réseau Catégorie 7 Câble blindé")
        'km'
        >>> derive_base_unit("COPPER DATA CABLES SOLID CABLE CAT6")
        'unit'
        >>> derive_base_unit("")
        'unit'
    """
    return "km" if "câble" in category_path.lower() else "unit"


def derive_pamp_eur(
    standard_price_odoo: Decimal,
    currency_odoo: str,
    fx_rates: dict[str, Decimal],
) -> Decimal:
    """Convert an Odoo standard price to EUR using the provided FX rates.

    The PAMP (Prix d'Achat Moyen Pondéré) is snapshotted from Odoo at
    migration time.  When Odoo stores the price in a non-EUR currency,
    this function converts it (CDC §8.5).

    FX rate convention
    ------------------
    ``fx_rates`` uses the same semantics as ``MarketParameter.fx_rate``:
    the rate is expressed as "1 unit of source currency = X EUR".

        ``{"USD": Decimal("0.925"), "RMB": Decimal("0.127")}``

    This is the value stored in ``MarketParameter`` where
    ``fx_from_currency="USD"``, ``fx_to_currency="EUR"``, ``fx_rate=0.925``.

    Args:
        standard_price_odoo: The raw ``standard_price`` from Odoo.
        currency_odoo: The currency code of ``standard_price_odoo``
            (e.g. ``"EUR"``, ``"USD"``, ``"RMB"``).
        fx_rates: Mapping from currency code to EUR conversion rate.

    Returns:
        The price expressed in EUR, quantized to 4 decimal places.

    Raises:
        KeyError: If ``currency_odoo`` is not ``"EUR"`` and is absent from
            ``fx_rates``.  Callers should catch this and quarantine the
            product rather than silently producing a wrong PAMP.

    Examples:
        >>> from decimal import Decimal
        >>> rates = {"USD": Decimal("0.9259"), "RMB": Decimal("0.1270")}
        >>> derive_pamp_eur(Decimal("100"), "EUR", rates)
        Decimal('100')
        >>> derive_pamp_eur(Decimal("100"), "USD", rates)
        Decimal('92.5900')
        >>> derive_pamp_eur(Decimal("2350"), "RMB", rates)
        Decimal('298.4500')
    """
    if currency_odoo == "EUR":
        return standard_price_odoo
    rate: Decimal = fx_rates[currency_odoo]  # raises KeyError for unknown currencies
    return (standard_price_odoo * rate).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def derive_is_active(odoo_active: bool) -> bool:
    """Map the Odoo ``active`` flag to the platform's ``is_active`` field.

    Products archived in Odoo (``active=False``) must not appear in the
    platform catalogue.  This passthrough function is intentionally trivial;
    it exists to make the derivation pipeline explicit and testable (CDC §8.5).

    Args:
        odoo_active: The ``active`` boolean from the Odoo product record.

    Returns:
        The same value, unchanged.

    Examples:
        >>> derive_is_active(True)
        True
        >>> derive_is_active(False)
        False
    """
    return odoo_active
