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
        required=False,
        allow_null=True,
        # PAS de `default` : un défaut ici écrasait silencieusement la config du
        # déploiement. Omis → `sync()` retombe sur `settings.ODOO["API_VERSION"]`,
        # donc c'est l'environnement qui décide de l'instance, pas ce littéral.
        help_text="Instance Odoo à synchroniser. Omis = ODOO_API_VERSION du déploiement.",
    )
