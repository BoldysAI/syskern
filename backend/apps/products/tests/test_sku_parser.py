"""Unit tests for the SKU parser (CDC §4.1.3).

Covers real-format Syskern SKUs, the ``E``-prefixed variant, and edge cases
(no suffix, non-numeric suffix, empty/None, casing/whitespace).
"""

from __future__ import annotations

import pytest

from apps.products.services.sku_parser import (
    extract_factory_code,
    extract_parent_reference,
    parse_sku,
)


class TestExtractFactoryCode:
    @pytest.mark.parametrize(
        ("sku", "expected"),
        [
            ("KCFF6A4PZHDBL5-21", "21"),
            ("KCFF6A4PZHDBL5-E02", "E02"),
            ("ABC-5", "5"),
            ("ABC-123", "123"),
            ("ABC-E9", "E9"),
            ("  kcff6a4pzhdbl5-21  ", "21"),  # trimmed + upper-cased
        ],
    )
    def test_extracts_suffix(self, sku, expected):
        assert extract_factory_code(sku) == expected

    @pytest.mark.parametrize(
        "sku",
        [
            "KCFF6A4PZHDBL5",  # no suffix
            "ABC-XYZ",  # non-numeric suffix
            "ABC-1234",  # 4 digits → out of -NN/-ENN range
            "ABC-",  # dangling dash
            "",  # empty
            None,  # None
        ],
    )
    def test_returns_none_without_valid_suffix(self, sku):
        assert extract_factory_code(sku) is None


class TestExtractParentReference:
    @pytest.mark.parametrize(
        ("sku", "expected"),
        [
            ("KCFF6A4PZHDBL5-21", "KCFF6A4PZHDBL5"),
            ("KCFF6A4PZHDBL5-E02", "KCFF6A4PZHDBL5"),
            ("KCFF6A4PZHDBL5", "KCFF6A4PZHDBL5"),  # no suffix → unchanged
            ("ABC-XYZ", "ABC-XYZ"),  # non-numeric suffix kept
            ("ABC-1234", "ABC-1234"),  # 4 digits kept (not a spec suffix)
            ("  abc-21  ", "ABC"),  # trimmed + upper-cased
        ],
    )
    def test_strips_only_the_spec_suffix(self, sku, expected):
        assert extract_parent_reference(sku) == expected

    @pytest.mark.parametrize("sku", ["", "   ", None])
    def test_empty_returns_none(self, sku):
        assert extract_parent_reference(sku) is None


class TestParseSku:
    def test_combines_both_fields(self):
        assert parse_sku("KCFF6A4PZHDBL5-E02") == {
            "sku": "KCFF6A4PZHDBL5-E02",
            "parent_reference": "KCFF6A4PZHDBL5",
            "factory_code": "E02",
        }

    def test_no_suffix(self):
        assert parse_sku("KCFF6A4PZHDBL5") == {
            "sku": "KCFF6A4PZHDBL5",
            "parent_reference": "KCFF6A4PZHDBL5",
            "factory_code": None,
        }
