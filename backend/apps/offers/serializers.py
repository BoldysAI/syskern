from __future__ import annotations

from rest_framework import serializers

from apps.clients.models import Client
from apps.core.models import Currency, Language

from .models import Offer, OfferAlertConfig, OfferLine, OfferStatus, OfferType
from .services.excel import validate_columns


class OfferLineSerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source="product.sku_code", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = OfferLine
        fields = (
            "id",
            "offer",
            "product",
            "product_sku",
            "product_name",
            "simulation_line",
            "final_price",
            "discount_pct",
            "quantity",
            "display_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "product_sku", "product_name", "created_at", "updated_at")


class OfferListSerializer(serializers.ModelSerializer):
    line_count = serializers.IntegerField(source="lines.count", read_only=True)

    class Meta:
        model = Offer
        fields = (
            "id",
            "label",
            "offer_type",
            "status",
            "currency",
            "incoterm",
            "language",
            "valid_from",
            "valid_to",
            "project_name",
            "client_ids",
            "version_number",
            "line_count",
            "generation_status",
            "generated_file_url",
            "gamma_document_id",
            "generation_error",
            "created_at",
            "updated_at",
        )


class OfferDetailSerializer(serializers.ModelSerializer):
    lines = OfferLineSerializer(many=True, read_only=True)

    class Meta:
        model = Offer
        fields = "__all__"
        read_only_fields = (
            "id",
            "sent_at",
            "won_at",
            "lost_at",
            "version_number",
            "previous_offer",
            "generated_file_url",
            "gamma_document_id",
            "created_at",
            "updated_at",
        )


class OfferWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Offer
        exclude = (
            "created_at",
            "updated_at",
            "sent_at",
            "won_at",
            "lost_at",
            "generated_file_url",
            "gamma_document_id",
            "version_number",
        )

    def validate(self, attrs: dict) -> dict:
        offer_type = attrs.get("offer_type", getattr(self.instance, "offer_type", None))
        client_ids = attrs.get("client_ids", getattr(self.instance, "client_ids", []) or [])
        if offer_type == OfferType.PROJECT and len(client_ids) != 1:
            raise serializers.ValidationError(
                {"client_ids": "Project offers target exactly one client."}
            )
        if offer_type == OfferType.TARIFF and not client_ids:
            raise serializers.ValidationError(
                {"client_ids": "Tariff offers require at least one client."}
            )
        return attrs


class StatusTransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=OfferStatus.choices)
    lost_reason = serializers.CharField(required=False, allow_blank=True)


class ExtendExpirationSerializer(serializers.Serializer):
    new_date = serializers.DateField()


class OfferAlertConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = OfferAlertConfig
        fields = ("recipients",)


class GenerateTariffOffersSerializer(serializers.Serializer):
    """Input for `POST /api/simulations/{id}/generate-tariff-offers` (CDC §7.2)."""

    client_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    columns = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    target_currency = serializers.ChoiceField(choices=Currency.choices, default=Currency.EUR)
    language = serializers.ChoiceField(choices=Language.choices, default=Language.FR)
    expiration_date = serializers.DateField(required=False, allow_null=True)
    incoterm = serializers.CharField(required=False, allow_blank=True, default="EXW")
    label = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_columns(self, value: list[str]) -> list[str]:
        if value:
            try:
                validate_columns(value)
            except ValueError as exc:
                raise serializers.ValidationError(str(exc)) from exc
        return value

    def validate_client_ids(self, value: list) -> list:
        existing = set(Client.objects.filter(id__in=value).values_list("id", flat=True))
        missing = [str(v) for v in value if v not in existing]
        if missing:
            raise serializers.ValidationError(f"Clients introuvables : {missing}")
        return value


class GenerateProjectOfferSerializer(serializers.Serializer):
    """Input for `POST /api/simulations/{id}/generate-project-offer` (CDC §7.3)."""

    client_id = serializers.UUIDField()
    project_name = serializers.CharField(max_length=255)
    quantities = serializers.DictField(child=serializers.FloatField(), allow_empty=False)
    language = serializers.ChoiceField(choices=Language.choices, default=Language.FR)
    expiration_date = serializers.DateField(required=False, allow_null=True)
    ai_instructions = serializers.CharField(required=False, allow_blank=True, default="")
    sections_config = serializers.DictField(
        child=serializers.BooleanField(), required=False, allow_null=True
    )

    def validate_client_id(self, value):
        if not Client.objects.filter(id=value).exists():
            raise serializers.ValidationError(f"Client introuvable : {value}")
        return value

    def validate_quantities(self, value: dict) -> dict:
        if any(q <= 0 for q in value.values()):
            raise serializers.ValidationError("Les quantités doivent être strictement positives.")
        return value
