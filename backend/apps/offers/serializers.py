from __future__ import annotations

from rest_framework import serializers

from .models import Offer, OfferLine, OfferStatus, OfferType


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
            "version_number",
            "line_count",
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
        simulation = attrs.get("simulation")
        if simulation and self.instance is None and not attrs.get("incoterm"):
            attrs["incoterm"] = simulation.sale_incoterm
        return attrs


class StatusTransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=OfferStatus.choices)
    lost_reason = serializers.CharField(required=False, allow_blank=True)
