from __future__ import annotations

from rest_framework import serializers

from .models import (
    Simulation,
    SimulationLine,
    SimulationRecalculation,
)


class SimulationLineSerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source="product.sku_code", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = SimulationLine
        fields = (
            "id",
            "simulation",
            "product",
            "product_sku",
            "product_name",
            "product_snapshot",
            "supplier_snapshot",
            "margin_override",
            "stock_purchase_mix_pct_override",
            "po_net_origin_currency",
            "po_net_eur",
            "pa_net_eur",
            "pamp_predictive_eur",
            "pr_eur",
            "pv_eur",
            "calculation_breakdown",
            "status",
            "last_calculated_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "product_sku",
            "product_name",
            "product_snapshot",
            "supplier_snapshot",
            "po_net_origin_currency",
            "po_net_eur",
            "pa_net_eur",
            "pamp_predictive_eur",
            "pr_eur",
            "pv_eur",
            "calculation_breakdown",
            "status",
            "last_calculated_at",
            "created_at",
            "updated_at",
        )


class SimulationListSerializer(serializers.ModelSerializer):
    line_count = serializers.IntegerField(source="lines.count", read_only=True)

    class Meta:
        model = Simulation
        fields = (
            "id",
            "label",
            "simulation_type",
            "status",
            "project_name",
            "is_dirty",
            "last_calculated_at",
            "stock_purchase_mix_pct",
            "symea_margin_rate",
            "syskern_margin_rate",
            "line_count",
            "created_at",
            "updated_at",
        )


class SimulationDetailSerializer(serializers.ModelSerializer):
    lines = SimulationLineSerializer(many=True, read_only=True)

    class Meta:
        model = Simulation
        fields = "__all__"
        read_only_fields = (
            "id",
            "status",
            "is_dirty",
            "last_calculated_at",
            "created_at",
            "updated_at",
        )


class SimulationWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Simulation
        exclude = ("created_at", "updated_at", "last_calculated_at", "is_dirty", "status")


class SimulationRecalculationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SimulationRecalculation
        fields = "__all__"


class AddLinesSerializer(serializers.Serializer):
    """Body for `POST /api/simulations/{id}/lines`."""

    product_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)


class BulkEditSerializer(serializers.Serializer):
    """Body for `POST /api/simulations/{id}/lines/bulk`."""

    filter = serializers.DictField(required=False, default=dict)
    margin_override = serializers.DecimalField(
        max_digits=5, decimal_places=4, required=False, allow_null=True
    )
    stock_purchase_mix_pct_override = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=100
    )
    reset = serializers.BooleanField(default=False)


class RecalculateSerializer(serializers.Serializer):
    """Body for `POST /api/simulations/{id}/recalculate`."""

    refresh_odoo = serializers.BooleanField(default=False)
    market_params = serializers.DictField(required=False)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class CompareSerializer(serializers.Serializer):
    simulation_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=2, max_length=4
    )
