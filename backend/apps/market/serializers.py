from __future__ import annotations

from rest_framework import serializers

from .models import MarketParameter, MarketParameterType, TransportMode, TransportPreset


class TransportModeSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportMode
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class TransportPresetSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportPreset
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_transport_mode_code(self, value: str) -> str:
        code = (value or "").strip().upper()
        if not code:
            raise serializers.ValidationError("Le mode de transport est requis.")
        if not TransportMode.objects.filter(code=code, is_active=True).exists():
            raise serializers.ValidationError(f"Mode de transport inconnu ou inactif : {code}.")
        return code

    def validate_name(self, value: str) -> str:
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("Le nom est requis.")
        return name


class MarketParameterSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketParameter
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs: dict) -> dict:
        ptype = attrs.get("parameter_type", getattr(self.instance, "parameter_type", None))
        if ptype == MarketParameterType.COPPER_PRICE:
            if not attrs.get("copper_price") and not getattr(self.instance, "copper_price", None):
                raise serializers.ValidationError({"copper_price": "Required for copper_price."})
        elif ptype == MarketParameterType.FX_RATE:
            if not attrs.get("fx_rate") and not getattr(self.instance, "fx_rate", None):
                raise serializers.ValidationError({"fx_rate": "Required for fx_rate."})
            # allow partial update if both currencies are already on instance
            missing_payload = not attrs.get("fx_from_currency") or not attrs.get("fx_to_currency")
            missing_instance = not (
                getattr(self.instance, "fx_from_currency", "")
                and getattr(self.instance, "fx_to_currency", "")
            )
            if missing_payload and missing_instance:
                raise serializers.ValidationError(
                    "fx_from_currency / fx_to_currency required for fx_rate."
                )
        return attrs
