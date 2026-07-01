from __future__ import annotations

from rest_framework import serializers

from .models import MigrationUnmatched, ResolutionAction


class MigrationUnmatchedSerializer(serializers.ModelSerializer):
    class Meta:
        model = MigrationUnmatched
        fields = "__all__"
        read_only_fields = ("id", "raw_data", "created_at", "updated_at")


class ResolveProductSerializer(serializers.Serializer):
    """Minimal payload to create a product from a quarantine row (action=create)."""

    sku_code = serializers.RegexField(r"^[A-Z0-9-]+$", max_length=64)
    name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    description_marketing_fr = serializers.CharField(required=False, allow_blank=True, default="")


class ResolveSerializer(serializers.Serializer):
    """Resolve a quarantine row with an explicit, executed action (CDC §8.7).

    ``resolved_by`` is optional — the view falls back to the logged-in user.
    ``product`` is required only when ``action == create``.
    """

    action = serializers.ChoiceField(
        choices=ResolutionAction.choices, default=ResolutionAction.IGNORE
    )
    resolved_by = serializers.EmailField(required=False, allow_blank=True)
    resolution_notes = serializers.CharField(required=False, allow_blank=True, default="")
    product = ResolveProductSerializer(required=False)

    def validate(self, attrs: dict) -> dict:
        if attrs["action"] == ResolutionAction.CREATE and not attrs.get("product"):
            raise serializers.ValidationError(
                {"product": "Requis pour créer le produit (au moins le code SKU)."}
            )
        return attrs
