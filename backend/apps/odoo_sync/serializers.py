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
