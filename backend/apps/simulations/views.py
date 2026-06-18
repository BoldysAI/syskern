"""DRF endpoints for simulations (CDC §6.9.9)."""

from __future__ import annotations

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.offers.models import Offer
from apps.products.models import Product

from .models import (
    Simulation,
    SimulationLine,
    SimulationStatus,
)
from .serializers import (
    AddLinesSerializer,
    BulkEditSerializer,
    CompareSerializer,
    RecalculateSerializer,
    SimulationDetailSerializer,
    SimulationLineSerializer,
    SimulationListSerializer,
    SimulationRecalculationSerializer,
    SimulationWriteSerializer,
)
from .tasks import recalculate_task


class SimulationViewSet(viewsets.ModelViewSet):
    queryset = Simulation.objects.all().prefetch_related("lines")
    filterset_fields = ("simulation_type", "status", "is_dirty")
    search_fields = ("label", "project_name")
    ordering = ("-created_at",)

    # ─── Serializer routing ───────────────────────────────────────────
    def get_serializer_class(self):
        if self.action == "list":
            return SimulationListSerializer
        if self.action in {"create", "update", "partial_update"}:
            return SimulationWriteSerializer
        return SimulationDetailSerializer

    # ─── Mutation guards (CDC §6.9.10) ────────────────────────────────
    def _ensure_writable(self, simulation: Simulation) -> None:
        if simulation.status == SimulationStatus.FINALIZED:
            raise PermissionDenied("Finalized simulations are read-only.")

    def update(self, request, *args, **kwargs):
        self._ensure_writable(self.get_object())
        # Any structural edit makes the simulation dirty.
        request.data.setdefault("is_dirty", True)  # type: ignore[union-attr]
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        # Re-mark as dirty whenever a structural field changed.
        simulation = serializer.save()
        Simulation.objects.filter(pk=simulation.pk).update(is_dirty=True)

    def destroy(self, request, *args, **kwargs):
        simulation = self.get_object()
        if simulation.status == SimulationStatus.FINALIZED:
            raise PermissionDenied("Finalized simulations cannot be deleted; archive instead.")
        if Offer.objects.filter(simulation=simulation).exists():
            return Response(
                {
                    "detail": "Simulation has attached offers; archive it instead.",
                    "offers": list(
                        Offer.objects.filter(simulation=simulation).values("id", "label")
                    ),
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    # ─── /finalize ────────────────────────────────────────────────────
    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        simulation = self.get_object()
        if simulation.status == SimulationStatus.FINALIZED:
            return Response({"detail": "Already finalized."}, status=status.HTTP_400_BAD_REQUEST)
        if simulation.is_dirty:
            return Response(
                {"detail": "Recalculate the simulation before finalizing."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        simulation.status = SimulationStatus.FINALIZED
        simulation.save(update_fields=["status", "updated_at"])
        return Response(SimulationDetailSerializer(simulation).data)

    # ─── /archive  /unarchive  (CDC §6.9.11) ──────────────────────────
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        simulation = self.get_object()
        if simulation.status != SimulationStatus.FINALIZED:
            raise ValidationError("Only finalized simulations can be archived.")
        simulation.status = SimulationStatus.ARCHIVED
        simulation.save(update_fields=["status", "updated_at"])
        return Response(SimulationDetailSerializer(simulation).data)

    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        simulation = self.get_object()
        if simulation.status != SimulationStatus.ARCHIVED:
            raise ValidationError("Simulation is not archived.")
        simulation.status = SimulationStatus.FINALIZED
        simulation.save(update_fields=["status", "updated_at"])
        return Response(SimulationDetailSerializer(simulation).data)

    # ─── /duplicate ───────────────────────────────────────────────────
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        src = self.get_object()
        copy = Simulation.objects.create(
            label=f"{src.label} (copy)",
            simulation_type=src.simulation_type,
            client_ids=list(src.client_ids or []),
            project_name=src.project_name,
            market_params=src.market_params,
            calculation_chain=src.calculation_chain,
            stock_purchase_mix_pct=src.stock_purchase_mix_pct,
            symea_margin_rate=src.symea_margin_rate,
            syskern_margin_rate=src.syskern_margin_rate,
            status=SimulationStatus.DRAFT,
            is_dirty=False,
            last_calculated_at=src.last_calculated_at,
        )
        for line in src.lines.all():
            SimulationLine.objects.create(
                simulation=copy,
                product=line.product,
                product_snapshot=line.product_snapshot,
                supplier_snapshot=line.supplier_snapshot,
                margin_override=line.margin_override,
                stock_purchase_mix_pct_override=line.stock_purchase_mix_pct_override,
                po_net_origin_currency=line.po_net_origin_currency,
                po_net_eur=line.po_net_eur,
                pa_net_eur=line.pa_net_eur,
                pamp_predictive_eur=line.pamp_predictive_eur,
                pr_eur=line.pr_eur,
                pv_eur=line.pv_eur,
                calculation_breakdown=line.calculation_breakdown,
                status=line.status,
                last_calculated_at=line.last_calculated_at,
            )
        return Response(SimulationDetailSerializer(copy).data, status=status.HTTP_201_CREATED)

    # ─── /lines (add) ─────────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="lines")
    @transaction.atomic
    def add_lines(self, request, pk=None):
        simulation = self.get_object()
        self._ensure_writable(simulation)
        ser = AddLinesSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        product_ids = ser.validated_data["product_ids"]

        existing = set(
            simulation.lines.filter(product_id__in=product_ids).values_list("product_id", flat=True)
        )
        new_lines = []
        for product in Product.objects.filter(id__in=product_ids):
            if product.id in existing:
                continue
            new_lines.append(
                SimulationLine(simulation=simulation, product=product, status="pending")
            )
        SimulationLine.objects.bulk_create(new_lines)
        Simulation.objects.filter(pk=simulation.pk).update(is_dirty=True)
        return Response({"added": len(new_lines)}, status=status.HTTP_201_CREATED)

    # ─── /lines/bulk (bulk-edit overrides) ────────────────────────────
    @action(detail=True, methods=["post"], url_path="lines/bulk")
    def bulk_edit_lines(self, request, pk=None):
        simulation = self.get_object()
        self._ensure_writable(simulation)
        ser = BulkEditSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        flt = data.get("filter") or {}

        qs = simulation.lines.all()
        if "brand" in flt:
            qs = qs.filter(product__brand=flt["brand"])
        if "range" in flt:
            qs = qs.filter(product__range=flt["range"])
        if "universe" in flt:
            qs = qs.filter(product__universe=flt["universe"])
        if "family" in flt:
            qs = qs.filter(product__family=flt["family"])
        if "factory_code" in flt:
            qs = qs.filter(product__factory_code=flt["factory_code"])

        if data.get("reset"):
            updated = qs.update(margin_override=None, stock_purchase_mix_pct_override=None)
        else:
            payload = {}
            if "margin_override" in data:
                payload["margin_override"] = data["margin_override"]
            if "stock_purchase_mix_pct_override" in data:
                payload["stock_purchase_mix_pct_override"] = data["stock_purchase_mix_pct_override"]
            updated = qs.update(**payload) if payload else 0

        if updated:
            Simulation.objects.filter(pk=simulation.pk).update(is_dirty=True)
        return Response({"updated": updated})

    # ─── /recalculate ─────────────────────────────────────────────────
    @action(detail=True, methods=["post"])
    def recalculate(self, request, pk=None):
        """Dispatch a Celery task to run the pricing engine.

        Returns 202 with `task_id`; client polls `/api/tasks/{task_id}/`.
        """
        simulation = self.get_object()
        self._ensure_writable(simulation)
        ser = RecalculateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        result = recalculate_task.delay(
            str(simulation.pk),
            market_params=data.get("market_params") or None,
            refresh_odoo=bool(data.get("refresh_odoo")),
            note=data.get("note", ""),
        )
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    # ─── /recalculations (list) ───────────────────────────────────────
    @action(detail=True, methods=["get"])
    def recalculations(self, request, pk=None):
        sim = self.get_object()
        traces = sim.recalculations.all().order_by("-calculated_at")
        return Response(SimulationRecalculationSerializer(traces, many=True).data)


class SimulationLineViewSet(viewsets.ModelViewSet):
    """Nested-style endpoint for per-line edits — accepts `?simulation=<id>`
    as a scope filter."""

    queryset = SimulationLine.objects.select_related("product", "simulation").all()
    serializer_class = SimulationLineSerializer
    http_method_names = ["get", "patch", "delete"]  # creation goes through /lines action

    def get_queryset(self):
        qs = super().get_queryset()
        sim = self.request.query_params.get("simulation")
        if sim:
            qs = qs.filter(simulation_id=sim)
        return qs

    def perform_update(self, serializer):
        line: SimulationLine = serializer.instance
        if line.simulation.status == SimulationStatus.FINALIZED:
            raise PermissionDenied("Finalized simulation — cannot edit lines.")
        super().perform_update(serializer)
        line.status = "dirty"
        line.save(update_fields=["status", "updated_at"])
        Simulation.objects.filter(pk=line.simulation_id).update(is_dirty=True)


class CompareSimulationsView(viewsets.ViewSet):
    """`POST /api/simulations/compare` body: `{"simulation_ids": [...]}`."""

    def create(self, request):
        ser = CompareSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ids = ser.validated_data["simulation_ids"]
        sims = list(Simulation.objects.filter(id__in=ids))

        if len(sims) != len(ids):
            raise ValidationError("Some simulation IDs were not found.")

        # Aggregate lines into a {product_id: {simulation_id: line}} map.
        lines = SimulationLine.objects.filter(simulation_id__in=ids).select_related("product")
        matrix: dict = {}
        for line in lines:
            entry = matrix.setdefault(
                str(line.product_id),
                {
                    "product_sku": line.product.sku_code,
                    "product_name": line.product.name,
                    "values": {},
                },
            )
            entry["values"][str(line.simulation_id)] = {
                "pa_net_eur": str(line.pa_net_eur) if line.pa_net_eur else None,
                "pr_eur": str(line.pr_eur) if line.pr_eur else None,
                "pv_eur": str(line.pv_eur) if line.pv_eur else None,
            }

        return Response(
            {
                "simulations": [
                    {"id": str(s.id), "label": s.label, "status": s.status} for s in sims
                ],
                "products": list(matrix.values()),
            }
        )
