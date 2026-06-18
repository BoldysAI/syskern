"""Product matching logic for the migration pipeline (CDC §8.6).

Matching cascade (applied in strict order, short-circuiting at the first rule
that yields at least one candidate):

  Rule 1 — exact sku_code match
  Rule 2 — parent_reference + factory_code
  Rule 3 — factory_code + category (last-resort; conservative)
  Rule 4 — no match → quarantine

Conservatism rule (CDC §8.6):
  If any rule returns ≥ 2 candidates, we immediately return DUPLICATE_MATCH.
  We do NOT fall through to the next rule in hopes of narrowing down — that
  would introduce silent errors.  Olivier resolves duplicates manually.

Performance note:
  The matcher pre-loads three in-memory indexes at construction time (~3 DB
  queries for the whole product table) so that per-row matching is O(1) /
  O(log n) dict lookups rather than per-row DB queries.  For ~3 000+ products
  this is negligible in memory (<1 MB) and dramatically faster than ORM
  select() per row.
"""

from __future__ import annotations

import logging
import uuid

from apps.data_migration.models import UnmatchedReason
from apps.products.models import Product

from .types import MatchHint, MatchResult

logger = logging.getLogger(__name__)


class ProductMatcher:
    """Stateful matcher that holds pre-loaded indexes of the product table.

    Instantiate once per loader run (not once per row).

    Usage:
        matcher = ProductMatcher()
        result = matcher.match(hint)
    """

    def __init__(self) -> None:
        self._build_indexes()

    # ─── Index construction ───────────────────────────────────────────────────

    def _build_indexes(self) -> None:
        """Load three indexes from the database in a single queryset scan."""
        qs = Product.objects.only(
            "id",
            "sku_code",
            "parent_reference",
            "factory_code",
            "universe",
            "family",
            "range",
            "sub_range",
        ).iterator(chunk_size=500)

        # Rule 1: sku_code → uuid (unique by DB constraint)
        self._by_sku: dict[str, uuid.UUID] = {}

        # Rule 2: (parent_reference, factory_code) → list[uuid]
        self._by_parent_factory: dict[tuple[str, str], list[uuid.UUID]] = {}

        # Rule 3: (factory_code, category_key) → list[uuid]
        # category_key = normalised (universe, family, range, sub_range) tuple
        self._by_factory_category: dict[tuple[str, str], list[uuid.UUID]] = {}

        for p in qs:
            pid: uuid.UUID = p.id

            # Rule 1
            if p.sku_code:
                self._by_sku[p.sku_code.strip().upper()] = pid

            # Rule 2
            if p.parent_reference and p.factory_code:
                key2 = (p.parent_reference.strip().upper(), p.factory_code.strip().upper())
                self._by_parent_factory.setdefault(key2, []).append(pid)

            # Rule 3
            if p.factory_code:
                cat = self._category_key(p.universe, p.family, p.range, p.sub_range)
                if cat:
                    key3 = (p.factory_code.strip().upper(), cat)
                    self._by_factory_category.setdefault(key3, []).append(pid)

        logger.debug(
            "ProductMatcher indexes built: %d SKUs, %d parent+factory keys, "
            "%d factory+category keys",
            len(self._by_sku),
            len(self._by_parent_factory),
            len(self._by_factory_category),
        )

    @staticmethod
    def _category_key(universe: str, family: str, range_: str, sub_range: str) -> str | None:
        """Normalise hierarchy fields into a single comparable key."""
        parts = [
            (universe or "").strip().upper(),
            (family or "").strip().upper(),
            (range_ or "").strip().upper(),
            (sub_range or "").strip().upper(),
        ]
        key = "|".join(parts)
        return key if any(parts) else None

    # ─── Public interface ─────────────────────────────────────────────────────

    def match(self, hint: MatchHint) -> MatchResult:
        """Apply the §8.6 cascade and return a MatchResult."""

        # Normalise hint values once
        sku = hint.sku_code.strip().upper() if hint.sku_code else None
        parent = hint.parent_reference.strip().upper() if hint.parent_reference else None
        factory = hint.factory_code.strip().upper() if hint.factory_code else None
        category = hint.category.strip().upper() if hint.category else None

        # ── Rule 0: no usable identifiers at all ──────────────────────────────
        if not sku and not parent and not factory:
            return MatchResult(product_id=None, reason=UnmatchedReason.NO_SKU, rule_used=None)

        # ── Rule 1: exact sku_code ────────────────────────────────────────────
        if sku:
            pid = self._by_sku.get(sku)
            if pid is not None:
                return MatchResult(
                    product_id=pid,
                    reason=None,
                    rule_used="exact_sku",
                )

        # ── Rule 2: parent_reference + factory_code ───────────────────────────
        if parent and factory:
            candidates = self._by_parent_factory.get((parent, factory), [])
            if len(candidates) == 1:
                return MatchResult(
                    product_id=candidates[0],
                    reason=None,
                    rule_used="parent_factory",
                )
            if len(candidates) > 1:
                return MatchResult(
                    product_id=None,
                    reason=UnmatchedReason.DUPLICATE_MATCH,
                    rule_used="parent_factory",
                    candidates=tuple(candidates),
                )

        # ── Rule 3: factory_code + category (last resort) ─────────────────────
        if factory and category:
            candidates = self._by_factory_category.get((factory, category), [])
            if len(candidates) == 1:
                return MatchResult(
                    product_id=candidates[0],
                    reason=None,
                    rule_used="factory_category",
                )
            if len(candidates) > 1:
                return MatchResult(
                    product_id=None,
                    reason=UnmatchedReason.DUPLICATE_MATCH,
                    rule_used="factory_category",
                    candidates=tuple(candidates),
                )

        # ── Rule 4: no match ──────────────────────────────────────────────────
        return MatchResult(product_id=None, reason=UnmatchedReason.NO_MATCH, rule_used=None)

    def refresh(self) -> None:
        """Rebuild indexes from the database (useful for long-running processes)."""
        self._build_indexes()
