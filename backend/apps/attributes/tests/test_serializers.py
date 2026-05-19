"""Unit tests for attribute value validation (CDC §4.5)."""
from __future__ import annotations

import pytest
from rest_framework import serializers

from apps.attributes.models import AttributeDataType
from apps.attributes.serializers import _allowed_option_values, _validate_attribute_value


class TestAllowedOptionValues:
    def test_builds_allowed_set(self) -> None:
        options = [{"value": "A", "label": {"fr": "A"}}, {"value": "B", "label": {"fr": "B"}}]
        assert _allowed_option_values(options) == {"A", "B"}

    def test_missing_value_key_raises_validation_error(self) -> None:
        with pytest.raises(serializers.ValidationError) as exc_info:
            _allowed_option_values([{"label": {"fr": "UTP"}}])
        assert "options" in exc_info.value.detail
        assert "value" in str(exc_info.value.detail["options"]).lower()

    def test_non_dict_option_raises_validation_error(self) -> None:
        with pytest.raises(serializers.ValidationError) as exc_info:
            _allowed_option_values(["UTP"])
        assert "options" in exc_info.value.detail


class TestValidateAttributeValueSelect:
    def test_select_invalid_value_returns_validation_error(self) -> None:
        options = [{"value": "UTP", "label": {"fr": "UTP"}}]
        with pytest.raises(serializers.ValidationError) as exc_info:
            _validate_attribute_value(AttributeDataType.SELECT, options, "COAX")
        assert "value" in exc_info.value.detail

    def test_select_malformed_options_returns_validation_error_not_key_error(self) -> None:
        with pytest.raises(serializers.ValidationError) as exc_info:
            _validate_attribute_value(
                AttributeDataType.SELECT,
                [{"label": {"fr": "UTP"}}],
                "UTP",
            )
        assert "options" in exc_info.value.detail


class TestValidateAttributeValueMultiselect:
    _OPTIONS = [
        {"value": "CE", "label": {"fr": "CE"}},
        {"value": "UL", "label": {"fr": "UL"}},
    ]

    def test_string_list_members_pass(self) -> None:
        _validate_attribute_value(AttributeDataType.MULTISELECT, self._OPTIONS, ["CE", "UL"])

    def test_numeric_list_members_coerced_to_match_string_options(self) -> None:
        # Options are stored as strings; JSON may send numbers for numeric-looking codes
        options = [{"value": "42", "label": {"fr": "42"}}]
        _validate_attribute_value(AttributeDataType.MULTISELECT, options, [42])

    def test_invalid_member_after_coercion_raises(self) -> None:
        with pytest.raises(serializers.ValidationError) as exc_info:
            _validate_attribute_value(AttributeDataType.MULTISELECT, self._OPTIONS, ["CE", 999])
        assert "value" in exc_info.value.detail
