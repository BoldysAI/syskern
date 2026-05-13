from __future__ import annotations

from rest_framework import serializers

from .models import MigrationUnmatched


class MigrationUnmatchedSerializer(serializers.ModelSerializer):
    class Meta:
        model = MigrationUnmatched
        fields = "__all__"
        read_only_fields = ("id", "raw_data", "created_at", "updated_at")


class ResolveSerializer(serializers.Serializer):
    resolved_by = serializers.EmailField()
    resolution_notes = serializers.CharField(required=False, allow_blank=True, default="")
