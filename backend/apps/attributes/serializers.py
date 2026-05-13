from __future__ import annotations

from rest_framework import serializers

from .models import AttributeDataType, AttributeRegistry, ProductAttributeValue


class AttributeRegistrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AttributeRegistry
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs: dict) -> dict:
        # `code` is immutable after creation (CDC §4.5).
        if self.instance is not None and "code" in attrs and attrs["code"] != self.instance.code:
            raise serializers.ValidationError({"code": "Attribute code is immutable."})

        label = attrs.get("label", getattr(self.instance, "label", {}) or {})
        if not (isinstance(label, dict) and label.get("fr")):
            raise serializers.ValidationError(
                {"label": "French label (`fr`) is required."}
            )

        data_type = attrs.get("data_type", getattr(self.instance, "data_type", None))
        options = attrs.get("options", getattr(self.instance, "options", None))
        if data_type in {AttributeDataType.SELECT, AttributeDataType.MULTISELECT}:
            if not options or not isinstance(options, list) or not options:
                raise serializers.ValidationError(
                    {"options": "At least one option required for select/multiselect."}
                )
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


class AttributeReorderSerializer(serializers.Serializer):
    """Body for POST /api/attributes/reorder."""

    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
