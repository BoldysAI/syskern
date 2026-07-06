from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from rest_framework import serializers

from .models import AttributeDataType, AttributeRegistry, ProductAttributeValue

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _allowed_option_values(options: list | None) -> set[str]:
    """Build the set of allowed option values; raise ValidationError on malformed options."""
    allowed: set[str] = set()
    for idx, opt in enumerate(options or []):
        if not isinstance(opt, dict):
            raise serializers.ValidationError(
                {"options": f"Option at index {idx} must be an object with a 'value' key."}
            )
        if "value" not in opt:
            raise serializers.ValidationError(
                {"options": f"Option at index {idx} is missing required key 'value'."}
            )
        allowed.add(str(opt["value"]))
    return allowed


def is_attribute_value_empty(value: object) -> bool:
    """True when an attribute value is unset (distinct from boolean false / number 0)."""
    if value is None:
        return True
    if value == "":
        return True
    return isinstance(value, list) and len(value) == 0


def _normalize_attribute_value(data_type: str, value: object) -> object:
    """Coerce values to canonical JSON shapes (numbers as JSON numbers, not strings)."""
    if value is None:
        return None
    if data_type == AttributeDataType.NUMBER:
        dec = Decimal(str(value))
        f = float(dec)
        if dec == dec.to_integral_value():
            return int(f)
        return f
    return value


def _validate_attribute_value(
    data_type: str,
    options: list | None,
    value: object,
    *,
    field: str = "value",
) -> None:
    """Raise ValidationError if *value* does not match *data_type* (CDC §4.5)."""
    if value is None:
        return

    if data_type == AttributeDataType.TEXT:
        if not isinstance(value, str):
            raise serializers.ValidationError(
                {field: "Expected a string for data_type 'text'."}
            )

    elif data_type == AttributeDataType.NUMBER:
        try:
            Decimal(str(value))
        except (InvalidOperation, TypeError) as exc:
            raise serializers.ValidationError(
                {field: f"Expected a numeric value for data_type 'number', got {value!r}."}
            ) from exc

    elif data_type == AttributeDataType.BOOLEAN:
        if not isinstance(value, bool):
            raise serializers.ValidationError(
                {field: f"Expected true or false for data_type 'boolean', got {value!r}."}
            )

    elif data_type == AttributeDataType.DATE:
        if not isinstance(value, str) or not _ISO_DATE_RE.match(value):
            raise serializers.ValidationError(
                {
                    field: (
                        f"Expected ISO 8601 date (YYYY-MM-DD) for data_type 'date', got {value!r}."
                    )
                }
            )

    elif data_type == AttributeDataType.SELECT:
        allowed = _allowed_option_values(options)
        if not isinstance(value, str) or value not in allowed:
            raise serializers.ValidationError(
                {field: f"Invalid value for data_type 'select': {value!r} is not in options."}
            )

    elif data_type == AttributeDataType.MULTISELECT:
        allowed = _allowed_option_values(options)
        if not isinstance(value, list):
            raise serializers.ValidationError(
                {field: "Expected a list of values for data_type 'multiselect'."}
            )
        invalid = [v for v in value if str(v) not in allowed]
        if invalid:
            raise serializers.ValidationError(
                {
                    field: (
                        f"Invalid values for data_type 'multiselect': {invalid!r} are not in options."
                    )
                }
            )


class AttributeRegistrySerializer(serializers.ModelSerializer):
    # Number of ProductAttributeValue rows that would be cascade-deleted with
    # this attribute. Annotated on the list/detail queryset; falls back to a
    # live count on create/update responses (single object, no N+1 risk).
    value_count = serializers.SerializerMethodField()

    class Meta:
        model = AttributeRegistry
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def get_value_count(self, obj: AttributeRegistry) -> int:
        annotated = getattr(obj, "value_count", None)
        return annotated if annotated is not None else obj.values.count()

    def validate(self, attrs: dict) -> dict:
        # `code` is immutable after creation (CDC §4.5).
        if self.instance is not None and "code" in attrs and attrs["code"] != self.instance.code:
            raise serializers.ValidationError({"code": "Attribute code is immutable."})

        label = attrs.get("label", getattr(self.instance, "label", {}) or {})
        if not (isinstance(label, dict) and label.get("fr")):
            raise serializers.ValidationError({"label": "French label (`fr`) is required."})

        data_type = attrs.get("data_type", getattr(self.instance, "data_type", None))
        options = attrs.get("options", getattr(self.instance, "options", None))
        if data_type in {AttributeDataType.SELECT, AttributeDataType.MULTISELECT}:
            if not options or not isinstance(options, list):
                raise serializers.ValidationError(
                    {"options": "At least one option required for select/multiselect."}
                )
            _allowed_option_values(options)

        default_value = attrs.get(
            "default_value", getattr(self.instance, "default_value", None)
        )
        is_required = attrs.get("is_required", getattr(self.instance, "is_required", False))
        if is_required and is_attribute_value_empty(default_value):
            raise serializers.ValidationError(
                {
                    "default_value": (
                        "Une valeur par défaut est requise pour un attribut obligatoire."
                    )
                }
            )
        if default_value is not None and data_type is not None:
            _validate_attribute_value(data_type, options, default_value, field="default_value")
            attrs["default_value"] = _normalize_attribute_value(data_type, default_value)

        return attrs


class ProductAttributeValueSerializer(serializers.ModelSerializer):
    attribute_code = serializers.CharField(source="attribute.code", read_only=True)

    class Meta:
        model = ProductAttributeValue
        fields = (
            "id",
            "product",
            "attribute",
            "attribute_code",
            "value",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at", "attribute_code")

    def validate(self, attrs: dict) -> dict:
        """Validate *value* against the linked attribute's data_type (CDC §4.5)."""
        attribute: AttributeRegistry | None = attrs.get(
            "attribute", getattr(self.instance, "attribute", None)
        )
        value = attrs.get("value", getattr(self.instance, "value", None))

        if attribute is not None:
            _validate_attribute_value(attribute.data_type, attribute.options, value)
            if "value" in attrs:
                attrs["value"] = _normalize_attribute_value(attribute.data_type, attrs["value"])
            elif value is not None:
                attrs["value"] = _normalize_attribute_value(attribute.data_type, value)

        return attrs


class AttributeReorderSerializer(serializers.Serializer):
    """Body for POST /api/attributes/reorder."""

    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
