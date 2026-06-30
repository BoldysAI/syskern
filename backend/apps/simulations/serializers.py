from __future__ import annotations

from rest_framework import serializers

from .models import (
    SavedComparison,
    Simulation,
    SimulationLine,
    SimulationRecalculation,
    SimulationType,
)


class SimulationLineSerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source="product.sku_code", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_designation = serializers.CharField(source="product.designation", read_only=True)
    product_range = serializers.CharField(source="product.range", read_only=True)
    product_stock = serializers.DecimalField(
        source="product.stock_quantity",
        max_digits=14,
        decimal_places=4,
        read_only=True,
    )
    product_pamp_eur = serializers.DecimalField(
        source="product.pamp_eur",
        max_digits=12,
        decimal_places=4,
        read_only=True,
    )

    class Meta:
        model = SimulationLine
        fields = (
            "id",
            "simulation",
            "product",
            "product_sku",
            "product_name",
            "product_designation",
            "product_range",
            "product_stock",
            "product_pamp_eur",
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
            "effective_margin_rate",
            "effective_mix_pct",
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
            "product_designation",
            "product_range",
            "product_stock",
            "product_pamp_eur",
            "product_snapshot",
            "supplier_snapshot",
            "po_net_origin_currency",
            "po_net_eur",
            "pa_net_eur",
            "pamp_predictive_eur",
            "pr_eur",
            "pv_eur",
            "effective_margin_rate",
            "effective_mix_pct",
            "calculation_breakdown",
            "status",
            "last_calculated_at",
            "created_at",
            "updated_at",
        )


class SimulationListSerializer(serializers.ModelSerializer):
    line_count = serializers.IntegerField(read_only=True)

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
            "sale_incoterm",
            "sale_incoterm_location",
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
            "odoo_snapshot_at",
            "created_at",
            "updated_at",
        )


class SimulationWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Simulation
        exclude = ("created_at", "updated_at", "last_calculated_at", "is_dirty", "status")

    def validate(self, attrs):
        """Enforce the type/context invariants (CDC §6.9.2).

        - A *project* simulation targets exactly one client and requires a
          project name.
        - A *tariff* simulation may start with no clients (the catalog quick-add
          flow creates one before clients are attached).
        """
        # On PATCH, fall back to the instance for fields not in the payload.
        instance = self.instance
        sim_type = attrs.get("simulation_type", getattr(instance, "simulation_type", None))
        client_ids = attrs.get(
            "client_ids",
            list(getattr(instance, "client_ids", []) or []),
        )
        project_name = attrs.get("project_name", getattr(instance, "project_name", "") or "")

        if sim_type == SimulationType.PROJECT:
            if not (project_name and project_name.strip()):
                raise serializers.ValidationError(
                    {"project_name": "Le nom du projet est requis pour une simulation projet."}
                )
            if len(client_ids) != 1:
                raise serializers.ValidationError(
                    {"client_ids": "Une simulation projet doit cibler exactement un client."}
                )

        return attrs


class SimulationRecalculationListSerializer(serializers.ModelSerializer):
    """Light trace for the history list — excludes the heavy per-line snapshot."""

    class Meta:
        model = SimulationRecalculation
        exclude = ("line_snapshots",)


class SimulationRecalculationSerializer(serializers.ModelSerializer):
    """Full trace incl. `line_snapshots` — used by the detail endpoint."""

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
    """Body for `POST /api/simulations/{id}/recalculate` (CDC §6.9.4).

    `scope` is the canonical contract:
      - `params_only`      : recalc with the current params, no Odoo pull.
      - `with_odoo_refresh`: pull fresh stock/PAMP/pending purchases, then recalc.
      - `full_refresh`     : refresh active market params + Odoo, then recalc.

    `market_params`/`note` stay optional (a caller may push edited params with a
    `full_refresh`); `refresh_odoo` is kept for backward compatibility.
    """

    scope = serializers.ChoiceField(
        choices=["params_only", "with_odoo_refresh", "full_refresh"],
        default="params_only",
    )
    refresh_odoo = serializers.BooleanField(default=False)
    market_params = serializers.DictField(required=False)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class DuplicateSerializer(serializers.Serializer):
    """Body for `POST /api/simulations/{id}/duplicate` (CDC §6.9.7)."""

    label = serializers.CharField(required=False, allow_blank=True, max_length=255)


class CompareSerializer(serializers.Serializer):
    """Body for `POST /api/simulations/compare` (CDC §6.9.8, §6.9.12).

    Columns can mix live simulations and frozen recalculation snapshots
    ("comparer avec actuel"). The total number of columns must stay in 2..4.
    """

    simulation_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=4
    )
    recalculation_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=4
    )

    def validate(self, attrs):
        total = len(attrs.get("simulation_ids") or []) + len(attrs.get("recalculation_ids") or [])
        if total < 2:
            raise serializers.ValidationError("Sélectionnez entre 2 et 4 éléments à comparer.")
        if total > 4:
            raise serializers.ValidationError("La comparaison est limitée à 4 éléments.")
        return attrs


def _validate_compare_ids(simulation_ids: list, recalculation_ids: list) -> None:
    """Ensure compare column IDs exist (shared by live compare + saved compare)."""
    sim_ids = [str(x) for x in simulation_ids]
    recalc_ids = [str(x) for x in recalculation_ids]
    if len({*sim_ids}) != len(sim_ids):
        raise serializers.ValidationError("Doublon dans les simulations sélectionnées.")
    if len({*recalc_ids}) != len(recalc_ids):
        raise serializers.ValidationError("Doublon dans les recalculs sélectionnés.")
    if Simulation.objects.filter(id__in=sim_ids).count() != len(set(sim_ids)):
        raise serializers.ValidationError("Certaines simulations sont introuvables.")
    if (
        SimulationRecalculation.objects.filter(id__in=recalc_ids).count()
        != len(set(recalc_ids))
    ):
        raise serializers.ValidationError("Certains recalculs sont introuvables.")


class SavedComparisonColumnSerializer(serializers.Serializer):
    type = serializers.CharField()
    id = serializers.UUIDField()
    label = serializers.CharField()
    simulation_id = serializers.UUIDField(allow_null=True)


class SavedComparisonSerializer(serializers.ModelSerializer):
    column_count = serializers.IntegerField(read_only=True)
    columns = serializers.SerializerMethodField()

    class Meta:
        model = SavedComparison
        fields = [
            "id",
            "label",
            "simulation_ids",
            "recalculation_ids",
            "note",
            "column_count",
            "columns",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_columns(self, obj: SavedComparison) -> list[dict]:
        sims = {
            str(s.id): s
            for s in Simulation.objects.filter(id__in=obj.simulation_ids)
        }
        recalcs = {
            str(r.id): r
            for r in SimulationRecalculation.objects.filter(
                id__in=obj.recalculation_ids
            ).select_related("simulation")
        }
        out: list[dict] = []
        for sid in obj.simulation_ids:
            key = str(sid)
            s = sims.get(key)
            out.append(
                {
                    "type": "simulation",
                    "id": sid,
                    "label": s.label if s else "(simulation supprimée)",
                    "simulation_id": sid,
                }
            )
        for rid in obj.recalculation_ids:
            key = str(rid)
            r = recalcs.get(key)
            label = (
                f"Recalcul du {r.calculated_at:%d/%m/%Y %H:%M}"
                if r
                else "(recalcul supprimé)"
            )
            out.append(
                {
                    "type": "recalculation",
                    "id": rid,
                    "label": label,
                    "simulation_id": r.simulation_id if r else None,
                }
            )
        return out


class SavedComparisonWriteSerializer(serializers.ModelSerializer):
    simulation_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
        allow_empty=True,
        max_length=4,
    )
    recalculation_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
        allow_empty=True,
        max_length=4,
    )

    class Meta:
        model = SavedComparison
        fields = ["label", "simulation_ids", "recalculation_ids", "note"]

    def validate(self, attrs):
        recalc_ids = attrs.get("recalculation_ids")
        if recalc_ids is None:
            recalc_ids = []
        sim_ids = attrs.get("simulation_ids")
        if sim_ids is None:
            sim_ids = []
        total = len(sim_ids) + len(recalc_ids)
        if total < 2:
            raise serializers.ValidationError("Sélectionnez entre 2 et 4 éléments à comparer.")
        if total > 4:
            raise serializers.ValidationError("La comparaison est limitée à 4 éléments.")
        _validate_compare_ids(sim_ids, recalc_ids)
        return attrs


class SavedComparisonPatchSerializer(serializers.ModelSerializer):
    simulation_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        max_length=4,
    )
    recalculation_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        max_length=4,
    )

    class Meta:
        model = SavedComparison
        fields = ["label", "note", "simulation_ids", "recalculation_ids"]

    def validate(self, attrs):
        instance = self.instance
        assert instance is not None
        sim_ids = attrs.get("simulation_ids", instance.simulation_ids)
        recalc_ids = attrs.get("recalculation_ids", instance.recalculation_ids)
        total = len(sim_ids) + len(recalc_ids)
        if total < 2:
            raise serializers.ValidationError("Sélectionnez entre 2 et 4 éléments à comparer.")
        if total > 4:
            raise serializers.ValidationError("La comparaison est limitée à 4 éléments.")
        _validate_compare_ids(sim_ids, recalc_ids)
        return attrs
