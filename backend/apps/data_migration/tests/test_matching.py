"""Unit tests for ProductMatcher (CDC §8.6).

These tests mock the three in-memory indexes directly rather than hitting the
DB, so they run without a database and are fast.

Scenarios covered:
  1. Exact SKU match (rule 1)
  2. parent_reference + factory_code match (rule 2)
  3. factory_code + category match (rule 3)
  4. No identifiers at all → NO_SKU
  5. Ambiguous candidates on rule 2 → DUPLICATE_MATCH (no cascade to rule 3)
  6. Ambiguous candidates on rule 3 → DUPLICATE_MATCH
  7. Rule 1 miss → rule 2 match (cascade behaviour)
  8. Rules 1 and 2 miss → rule 3 match (cascade behaviour)
  9. All rules miss → NO_MATCH
"""
from __future__ import annotations

import uuid

from apps.data_migration.loaders.matching import ProductMatcher
from apps.data_migration.loaders.types import MatchHint
from apps.data_migration.models import UnmatchedReason

# ─── Fixtures ────────────────────────────────────────────────────────────────

ID_A = uuid.uuid4()
ID_B = uuid.uuid4()
ID_C = uuid.uuid4()

BY_SKU = {
    "KCFU64PZHDGR5": ID_A,
}

BY_PARENT_FACTORY = {
    ("KCFU64PZHDGR5", "21"): [ID_A],
    ("AMBIGUOUS_PARENT", "21"): [ID_B, ID_C],
}

BY_FACTORY_CATEGORY = {
    ("91", "COPPER|DATA CABLES|SOLID CABLE CAT6|F/UTP"): [ID_B],
    ("E02", "COPPER|DATA CABLES|SOLID CABLE CAT6|AMBIGUOUS"): [ID_B, ID_C],
}


def make_matcher() -> ProductMatcher:
    """Return a ProductMatcher with pre-built mock indexes (no DB call)."""
    matcher = ProductMatcher.__new__(ProductMatcher)
    matcher._by_sku = dict(BY_SKU)
    matcher._by_parent_factory = {k: list(v) for k, v in BY_PARENT_FACTORY.items()}
    matcher._by_factory_category = {k: list(v) for k, v in BY_FACTORY_CATEGORY.items()}
    return matcher


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestProductMatcher:
    def setup_method(self) -> None:
        self.m = make_matcher()

    # 1. Exact SKU match
    def test_rule1_exact_sku(self) -> None:
        result = self.m.match(MatchHint(sku_code="KCFU64PZHDGR5"))
        assert result.product_id == ID_A
        assert result.rule_used == "exact_sku"
        assert result.reason is None

    # 1b. Case insensitive
    def test_rule1_case_insensitive(self) -> None:
        result = self.m.match(MatchHint(sku_code="kcfu64pzhdgr5"))
        assert result.product_id == ID_A

    # 2. parent_reference + factory_code
    def test_rule2_parent_factory(self) -> None:
        result = self.m.match(
            MatchHint(sku_code=None, parent_reference="KCFU64PZHDGR5", factory_code="21")
        )
        assert result.product_id == ID_A
        assert result.rule_used == "parent_factory"

    # 3. factory_code + category
    def test_rule3_factory_category(self) -> None:
        result = self.m.match(
            MatchHint(factory_code="91", category="COPPER|DATA CABLES|SOLID CABLE CAT6|F/UTP")
        )
        assert result.product_id == ID_B
        assert result.rule_used == "factory_category"

    # 4. No identifiers
    def test_no_identifiers_no_sku(self) -> None:
        result = self.m.match(MatchHint())
        assert result.product_id is None
        assert result.reason == UnmatchedReason.NO_SKU

    # 5. Ambiguous on rule 2 → DUPLICATE_MATCH, no cascade
    def test_rule2_ambiguous_stops_cascade(self) -> None:
        result = self.m.match(
            MatchHint(parent_reference="AMBIGUOUS_PARENT", factory_code="21")
        )
        assert result.product_id is None
        assert result.reason == UnmatchedReason.DUPLICATE_MATCH
        assert result.rule_used == "parent_factory"
        assert len(result.candidates) == 2
        # Must NOT have fallen through to rule 3
        assert result.candidates == (ID_B, ID_C) or set(result.candidates) == {ID_B, ID_C}

    # 6. Ambiguous on rule 3
    def test_rule3_ambiguous(self) -> None:
        result = self.m.match(
            MatchHint(factory_code="E02", category="COPPER|DATA CABLES|SOLID CABLE CAT6|AMBIGUOUS")
        )
        assert result.product_id is None
        assert result.reason == UnmatchedReason.DUPLICATE_MATCH
        assert result.rule_used == "factory_category"
        assert len(result.candidates) == 2

    # 7. Rule 1 miss → rule 2 hits
    def test_cascade_rule1_miss_rule2_hit(self) -> None:
        result = self.m.match(
            MatchHint(sku_code="UNKNOWN_SKU", parent_reference="KCFU64PZHDGR5", factory_code="21")
        )
        assert result.product_id == ID_A
        assert result.rule_used == "parent_factory"

    # 8. Rules 1&2 miss → rule 3 hits
    def test_cascade_rule1_rule2_miss_rule3_hit(self) -> None:
        result = self.m.match(
            MatchHint(
                sku_code="UNKNOWN",
                parent_reference="UNKNOWN_PARENT",
                factory_code="91",
                category="COPPER|DATA CABLES|SOLID CABLE CAT6|F/UTP",
            )
        )
        assert result.product_id == ID_B
        assert result.rule_used == "factory_category"

    # 9. All rules miss → NO_MATCH
    def test_all_rules_miss_no_match(self) -> None:
        result = self.m.match(
            MatchHint(sku_code="NOPE", parent_reference="NOPE", factory_code="NOPE")
        )
        assert result.product_id is None
        assert result.reason == UnmatchedReason.NO_MATCH

    # 10. Only parent (no factory_code) → rule 2 not attempted, cascade to rule 3
    def test_rule2_skipped_if_no_factory(self) -> None:
        result = self.m.match(
            MatchHint(sku_code=None, parent_reference="KCFU64PZHDGR5", factory_code=None)
        )
        # parent alone is not enough for rule 2; falls through to rule 3 (no category → NO_MATCH)
        assert result.product_id is None
        assert result.reason == UnmatchedReason.NO_MATCH

    # 11. Empty string sku_code treated as None
    def test_empty_string_sku_treated_as_no_match(self) -> None:
        result = self.m.match(MatchHint(sku_code="", factory_code=""))
        assert result.reason == UnmatchedReason.NO_SKU
