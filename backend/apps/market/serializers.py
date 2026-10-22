from __future__ import annotations

from rest_framework import serializers

from apps.accounts.ui_locale import translate_request

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
        request = self.context.get("request")
        if not code:
            raise serializers.ValidationError(
                translate_request(request, "market.transport_required")
            )
        if not TransportMode.objects.filter(code=code, is_active=True).exists():
            raise serializers.ValidationError(
                translate_request(request, "market.transport_unknown", code=code)
            )
        return code

    def validate_name(self, value: str) -> str:
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError(
                translate_request(self.context.get("request"), "market.name_required")
            )
        return name


class MarketParameterSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketParameter
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs: dict) -> dict:
        request = self.context.get("request")
        ptype = attrs.get("parameter_type", getattr(self.instance, "parameter_type", None))
        if ptype == MarketParameterType.COPPER_PRICE:
            if not attrs.get("copper_price") and not getattr(self.instance, "copper_price", None):
                raise serializers.ValidationError(
                    {"copper_price": translate_request(request, "market.copper_price_required")}
                )
        elif ptype == MarketParameterType.FX_RATE:
            if not attrs.get("fx_rate") and not getattr(self.instance, "fx_rate", None):
                raise serializers.ValidationError(
                    {"fx_rate": translate_request(request, "market.fx_rate_required")}
                )
            # allow partial update if both currencies are already on instance
            missing_payload = not attrs.get("fx_from_currency") or not attrs.get("fx_to_currency")
            missing_instance = not (
                getattr(self.instance, "fx_from_currency", "")
                and getattr(self.instance, "fx_to_currency", "")
            )
            if missing_payload and missing_instance:
                raise serializers.ValidationError(
                    translate_request(request, "market.fx_currencies_required")
                )
        return attrs
