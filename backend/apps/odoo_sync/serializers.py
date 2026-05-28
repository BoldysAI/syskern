from __future__ import annotations

from rest_framework import serializers

from .models import SyncLog, SyncScope


class SyncLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncLog
        fields = "__all__"
        read_only_fields = tuple(field.name for field in SyncLog._meta.fields)


class TriggerSyncSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=SyncScope.choices, default=SyncScope.ALL)
    api_version = serializers.ChoiceField(
        choices=["v16", "v19"],
        default="v19",
        help_text="Which Odoo instance to sync from.",
    )
