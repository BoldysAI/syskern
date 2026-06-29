"""DRF endpoints for simulations (CDC §6.9.9)."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Avg, Count, Max, Min
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.filters import OrderingFilter
from rest_framework.response import Response

from apps.offers.models import Offer
from apps.offers.serializers import (
    GenerateProjectOfferSerializer,
    GenerateTariffOffersSerializer,
)
from apps.offers.tasks import generate_project_offer_task, generate_tariff_offers_task
from apps.products.models import Product

from .filters import SimulationFilter
from .models import (
    SavedComparison,
    Simulation,
    SimulationLine,
    SimulationRecalculation,
    SimulationStatus,
    SimulationType,
)
from .serializers import (
    AddLinesSerializer,
    BulkEditSerializer,
    CompareSerializer,
    DuplicateSerializer,
    RecalculateSerializer,
    SavedComparisonPatchSerializer,
    SavedComparisonSerializer,
    SavedComparisonWriteSerializer,
    SimulationDetailSerializer,
    SimulationLineSerializer,
    SimulationListSerializer,
    SimulationRecalculationListSerializer,
    SimulationRecalculationSerializer,
    SimulationWriteSerializer,
)
from .services.runner import (
    PRICING_AFFECTING_FIELDS,
    mark_lines_dirty_after_pricing_change,
    recalculate_single_line,
    snapshot_finalize_trace,
    sync_simulation_dirty_flag,
)
from .tasks import EXPORT_DIR, export_simulation_task, recalculate_task


def _filter_simulation_lines(simulation: Simulation, flt: dict):
    """Build the bulk-edit line queryset from a cumulative filter (CDC §6.9.5).

    Supports product hierarchy (universe/family/range), brand, supplier
    `factory_code`, and the calculation status flags `has_warning`/`has_error`.
    Dynamic attributes are intentionally out of scope (see decisions.md).
    """
    qs = simulation.lines.all()
    if flt.get("brand"):
        qs = qs.filter(product__brand=flt["brand"])
    if flt.get("range"):
        qs = qs.filter(product__range=flt["range"])
    if flt.get("universe"):
        qs = qs.filter(product__universe=flt["universe"])
    if flt.get("family"):
        qs = qs.filter(product__family=flt["family"])
    if flt.get("factory_code"):
        qs = qs.filter(product__factory_code=flt["factory_code"])
    line_ids = flt.get("line_ids")
    if line_ids:
        if isinstance(line_ids, (list, tuple)):
            qs = qs.filter(id__in=line_ids)
        elif isinstance(line_ids, str):
            qs = qs.filter(id__in=[part.strip() for part in line_ids.split(",") if part.strip()])
    status_in = _parse_status_in(flt)
    if status_in:
        qs = qs.filter(status__in=status_in)
    else:
        if flt.get("has_warning"):
            qs = qs.filter(status="warning")
        if flt.get("has_error"):
            qs = qs.filter(status="error")
    return qs


def _parse_status_in(flt: dict) -> list[str] | None:
    """Parse `status_in` from a filter dict (comma-separated or list)."""
    raw = flt.get("status_in")
    if not raw:
        return None
    if isinstance(raw, str):
        values = [part.strip() for part in raw.split(",") if part.strip()]
    elif isinstance(raw, (list, tuple)):
        values = [str(part).strip() for part in raw if str(part).strip()]
    else:
        return None
    allowed = {"ok", "warning", "error", "pending", "dirty"}
    selected = [value for value in values if value in allowed]
    return selected or None


class SimulationViewSet(viewsets.ModelViewSet):
    queryset = Simulation.objects.all()
    filterset_class = SimulationFilter
    ordering_fields = (
        "label",
        "simulation_type",
        "status",
        "updated_at",
        "created_at",
        "last_calculated_at",
        "line_count",
    )
    ordering = ("-updated_at",)

    # ─── Queryset ─────────────────────────────────────────────────────
    def get_queryset(self):
        """List endpoint annotates line counts; detail routes prefetch lines."""
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.annotate(line_count=Count("lines", distinct=True))
        else:
            qs = qs.prefetch_related("lines")
        return qs

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
            raise PermissionDenied("Une simulation finalisée est en lecture seule.")
        if simulation.status == SimulationStatus.ARCHIVED:
            raise PermissionDenied("Une simulation archivée est en lecture seule.")

    def update(self, request, *args, **kwargs):
        self._ensure_writable(self.get_object())
        # Any structural edit makes the simulation dirty.
        request.data.setdefault("is_dirty", True)  # type: ignore[union-attr]
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        instance = serializer.instance
        before = {f: getattr(instance, f) for f in PRICING_AFFECTING_FIELDS}
        simulation = serializer.save()
        after = {f: getattr(simulation, f) for f in PRICING_AFFECTING_FIELDS}
        if before != after:
            mark_lines_dirty_after_pricing_change(simulation)
        sync_simulation_dirty_flag(simulation.pk)

    def destroy(self, request, *args, **kwargs):
        simulation = self.get_object()
        if simulation.status == SimulationStatus.FINALIZED:
            raise PermissionDenied(
                "Une simulation finalisée ne peut pas être supprimée ; archivez-la."
            )
        if Offer.objects.filter(simulation=simulation).exists():
            return Response(
                {
                    "detail": "Des offres sont rattachées à cette simulation ; archivez-la.",
                    "offers": list(
                        Offer.objects.filter(simulation=simulation).values("id", "label")
                    ),
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    # ─── /finalize (CDC §6.9.6) ───────────────────────────────────────
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def finalize(self, request, pk=None):
        """Lock a simulation (irreversible) after pre-flight checks (CDC §6.9.6).

        Pre-flight: it must have been calculated at least once, carry no
        error line, and not be dirty. On success a `finalize` audit trace is
        frozen (while still writable) before flipping the status.
        """
        simulation = self.get_object()
        if simulation.status == SimulationStatus.FINALIZED:
            return Response(
                {"detail": "Simulation déjà finalisée."}, status=status.HTTP_400_BAD_REQUEST
            )
        if simulation.status == SimulationStatus.ARCHIVED:
            return Response(
                {"detail": "Une simulation archivée ne peut pas être finalisée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if simulation.last_calculated_at is None:
            return Response(
                {
                    "detail": "Impossible de finaliser une simulation jamais calculée — "
                    "lancez un recalcul d'abord."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        error_skus = list(
            simulation.lines.filter(status="error").values_list("product__sku_code", flat=True)
        )
        if error_skus:
            return Response(
                {
                    "detail": "Des lignes sont en erreur — corrigez-les avant de finaliser.",
                    "errors": error_skus,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        sync_simulation_dirty_flag(simulation.pk)
        simulation.refresh_from_db(fields=["is_dirty", "updated_at"])
        if simulation.is_dirty:
            return Response(
                {"detail": "Recalculez la simulation avant de finaliser."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Freeze the finalize trace while the simulation is still writable.
        snapshot_finalize_trace(simulation)
        simulation.status = SimulationStatus.FINALIZED
        simulation.save(update_fields=["status", "updated_at"])
        return Response(SimulationDetailSerializer(simulation).data)

    # ─── /generate-tariff-offers (CDC §7.2) ───────────────────────────
    @action(detail=True, methods=["post"], url_path="generate-tariff-offers")
    def generate_tariff_offers(self, request, pk=None):
        """Generate one tariff Excel offer per client (async, CDC §7.2).

        Requires a finalized, tariff-type simulation. Returns 202 + task_id;
        the client polls /api/tasks/{task_id}/ for the per-client results.
        """
        simulation = self.get_object()
        if simulation.status != SimulationStatus.FINALIZED:
            raise ValidationError("La simulation doit être finalisée.")
        if simulation.simulation_type != SimulationType.TARIFF:
            raise ValidationError("Génération tarifaire réservée aux simulations de type tarif.")

        ser = GenerateTariffOffersSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        # Make the payload JSON-serializable for Celery.
        payload = {
            "client_ids": [str(c) for c in data["client_ids"]],
            "columns": data.get("columns") or [],
            "target_currency": data["target_currency"],
            "language": data["language"],
            "expiration_date": (
                data["expiration_date"].isoformat() if data.get("expiration_date") else None
            ),
            "incoterm": data.get("incoterm") or "EXW",
            "label": data.get("label") or "",
        }
        task = generate_tariff_offers_task.delay(str(simulation.id), payload)
        return Response(
            {"task_id": task.id, "status": "PENDING", "client_count": len(payload["client_ids"])},
            status=status.HTTP_202_ACCEPTED,
        )

    # ─── /generate-project-offer (CDC §7.3) ───────────────────────────
    @action(detail=True, methods=["post"], url_path="generate-project-offer")
    def generate_project_offer(self, request, pk=None):
        """Generate a Gamma project quote (async, CDC §7.3).

        Requires a finalized, project-type simulation. Returns 202 + task_id;
        the client polls /api/tasks/{task_id}/ for the offer + generation status.
        """
        simulation = self.get_object()
        if simulation.status != SimulationStatus.FINALIZED:
            raise ValidationError("La simulation doit être finalisée.")
        if simulation.simulation_type != SimulationType.PROJECT:
            raise ValidationError("Génération projet réservée aux simulations de type projet.")

        ser = GenerateProjectOfferSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        payload = {
            "client_id": str(data["client_id"]),
            "project_name": data["project_name"],
            "quantities": data["quantities"],
            "language": data["language"],
            "expiration_date": (
                data["expiration_date"].isoformat() if data.get("expiration_date") else None
            ),
            "ai_instructions": data.get("ai_instructions") or "",
            "sections_config": data.get("sections_config"),
        }
        task = generate_project_offer_task.delay(str(simulation.id), payload)
        return Response(
            {"task_id": task.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    # ─── /archive  /unarchive  (CDC §6.9.11) ──────────────────────────
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        simulation = self.get_object()
        if simulation.status != SimulationStatus.FINALIZED:
            raise ValidationError("Seules les simulations finalisées peuvent être archivées.")
        simulation.status = SimulationStatus.ARCHIVED
        simulation.save(update_fields=["status", "updated_at"])
        return Response(SimulationDetailSerializer(simulation).data)

    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        simulation = self.get_object()
        if simulation.status != SimulationStatus.ARCHIVED:
            raise ValidationError("Cette simulation n'est pas archivée.")
        simulation.status = SimulationStatus.FINALIZED
        simulation.save(update_fields=["status", "updated_at"])
        return Response(SimulationDetailSerializer(simulation).data)

    # ─── /duplicate (CDC §6.9.7) ──────────────────────────────────────
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        """Full copy of a simulation (draft or finalized) into a new draft.

        Copies the header, every line (overrides + frozen results, incl. the
        effective margin/mix), and inherits `last_calculated_at`. Attached
        offers and the recalculation history are intentionally NOT copied.
        """
        src = self.get_object()
        ser = DuplicateSerializer(data=request.data or {})
        ser.is_valid(raise_exception=True)
        label = ser.validated_data.get("label") or f"{src.label} (copie)"

        copy = Simulation.objects.create(
            label=label,
            simulation_type=src.simulation_type,
            client_ids=list(src.client_ids or []),
            project_name=src.project_name,
            market_params=src.market_params,
            calculation_chain=src.calculation_chain,
            stock_purchase_mix_pct=src.stock_purchase_mix_pct,
            symea_margin_rate=src.symea_margin_rate,
            syskern_margin_rate=src.syskern_margin_rate,
            sale_incoterm=src.sale_incoterm,
            sale_incoterm_location=src.sale_incoterm_location,
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
                effective_margin_rate=line.effective_margin_rate,
                effective_mix_pct=line.effective_mix_pct,
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
        sync_simulation_dirty_flag(simulation.pk)
        return Response({"added": len(new_lines)}, status=status.HTTP_201_CREATED)

    # ─── /lines/bulk (bulk-edit overrides) ────────────────────────────
    @action(detail=True, methods=["post"], url_path="lines/bulk")
    def bulk_edit_lines(self, request, pk=None):
        simulation = self.get_object()
        self._ensure_writable(simulation)
        ser = BulkEditSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        qs = _filter_simulation_lines(simulation, data.get("filter") or {})

        if data.get("reset"):
            updated = qs.update(
                margin_override=None, stock_purchase_mix_pct_override=None, status="dirty"
            )
        else:
            payload = {}
            if "margin_override" in data:
                payload["margin_override"] = data["margin_override"]
            if "stock_purchase_mix_pct_override" in data:
                payload["stock_purchase_mix_pct_override"] = data["stock_purchase_mix_pct_override"]
            # Affected lines become dirty — PV is not recalculated automatically.
            updated = qs.update(status="dirty", **payload) if payload else 0

        if updated:
            sync_simulation_dirty_flag(simulation.pk)
        return Response({"updated": updated})

    # ─── /lines/bulk-delete (remove lines from simulation) ────────────
    @action(detail=True, methods=["post"], url_path="lines/bulk-delete")
    def bulk_delete_lines(self, request, pk=None):
        simulation = self.get_object()
        self._ensure_writable(simulation)
        data = request.data or {}
        line_ids = data.get("line_ids")
        if line_ids:
            qs = simulation.lines.filter(id__in=line_ids)
        else:
            qs = _filter_simulation_lines(simulation, data.get("filter") or {})
        deleted, _ = qs.delete()
        if deleted:
            sync_simulation_dirty_flag(simulation.pk)
        return Response({"deleted": deleted})

    # ─── /lines/bulk/preview (impacted-row count, CDC §6.9.5) ─────────
    @action(detail=True, methods=["post"], url_path="lines/bulk/preview")
    def bulk_edit_preview(self, request, pk=None):
        """Return how many lines the given filter would touch — no mutation."""
        simulation = self.get_object()
        flt = (request.data or {}).get("filter") or {}
        return Response({"count": _filter_simulation_lines(simulation, flt).count()})

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

        # Back-compat: a bare `refresh_odoo=True` (no scope) maps to a full refresh.
        scope = data.get("scope", "params_only")
        if scope == "params_only" and data.get("refresh_odoo"):
            scope = "with_odoo_refresh"

        result = recalculate_task.delay(
            str(simulation.pk),
            scope=scope,
            market_params=data.get("market_params") or None,
            note=data.get("note", ""),
        )
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    # ─── /recalculations (list, paginated DESC) ───────────────────────
    @action(detail=True, methods=["get"])
    def recalculations(self, request, pk=None):
        """Paginated recalc history (CDC §6.9.12), newest first.

        Uses the project's LimitOffset pagination (`?limit=&offset=`); the
        light list serializer omits `line_snapshots` (fetched on detail).
        """
        sim = self.get_object()
        traces = sim.recalculations.all().order_by("-calculated_at")
        page = self.paginate_queryset(traces)
        if page is not None:
            ser = SimulationRecalculationListSerializer(page, many=True)
            return self.get_paginated_response(ser.data)
        return Response(SimulationRecalculationListSerializer(traces, many=True).data)

    # ─── /recalculations/{recalc_id} (detail incl. line snapshots) ────
    @action(
        detail=True,
        methods=["get"],
        url_path=r"recalculations/(?P<recalc_id>[0-9a-fA-F-]{36})",
    )
    def recalculation_detail(self, request, pk=None, recalc_id=None):
        sim = self.get_object()
        trace = get_object_or_404(sim.recalculations, pk=recalc_id)
        return Response(SimulationRecalculationSerializer(trace).data)

    # ─── /export — async Excel build (CDC §6.9) ──────────────────────
    @action(detail=True, methods=["post"])
    def export(self, request, pk=None):
        """Dispatch a Celery task to build the Excel workbook.

        Returns 202 with `task_id`; the client polls `/api/tasks/{id}/` and
        then downloads the file via `/api/simulations/exports/{task_id}/`.
        """
        simulation = self.get_object()
        result = export_simulation_task.delay(str(simulation.pk))
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    # ─── /exports/{task_id} — file download ───────────────────────────
    @action(detail=False, methods=["get"], url_path=r"exports/(?P<task_id>[\w-]+)")
    def export_file(self, request, task_id=None):
        """Stream the Excel produced by `export_simulation_task` (by task_id)."""
        file_path = EXPORT_DIR / f"{task_id}.xlsx"
        if not file_path.is_file():
            raise Http404("Export introuvable ou expiré.")
        return FileResponse(
            file_path.open("rb"),
            as_attachment=True,
            filename="simulation_syskern.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )


class SimulationLineViewSet(viewsets.ModelViewSet):
    """Nested-style endpoint for per-line edits — accepts `?simulation=<id>`
    as a scope filter."""

    queryset = SimulationLine.objects.select_related("product", "simulation").all()
    serializer_class = SimulationLineSerializer
    # creation goes through /lines action; POST only for the /recalculate sub-route
    http_method_names = ["get", "patch", "delete", "post"]
    filter_backends = [OrderingFilter]
    ordering_fields = (
        "pv_eur",
        "pa_net_eur",
        "pr_eur",
        "status",
        "product__sku_code",
        "product__range",
    )
    ordering = ("product__sku_code",)

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        sim = params.get("simulation")
        if sim:
            qs = qs.filter(simulation_id=sim)
        # CDC §6.9.9 — filter lines by their calculation status.
        status_in = _parse_status_in({"status_in": params.get("status_in")})
        if status_in:
            qs = qs.filter(status__in=status_in)
        else:
            if params.get("has_warning") in {"true", "1"}:
                qs = qs.filter(status="warning")
            if params.get("has_error") in {"true", "1"}:
                qs = qs.filter(status="error")
        return qs

    def perform_update(self, serializer):
        line: SimulationLine = serializer.instance
        if line.simulation.status in {SimulationStatus.FINALIZED, SimulationStatus.ARCHIVED}:
            raise PermissionDenied("Simulation non modifiable — édition des lignes interdite.")
        super().perform_update(serializer)
        line.status = "dirty"
        line.save(update_fields=["status", "updated_at"])
        sync_simulation_dirty_flag(line.simulation_id)

    def perform_destroy(self, instance):
        if instance.simulation.status in {SimulationStatus.FINALIZED, SimulationStatus.ARCHIVED}:
            raise PermissionDenied("Simulation non modifiable — suppression de ligne interdite.")
        sim_id = instance.simulation_id
        super().perform_destroy(instance)
        sync_simulation_dirty_flag(sim_id)

    # ─── /recalculate (single line, CDC §6.9.5) ──────────────────────
    @action(detail=True, methods=["post"])
    def recalculate(self, request, pk=None):
        """Recalculate one line synchronously, without an audit trace.

        Reuses the simulation's current params/chain. Fast enough to run in
        the request thread (one SKU).
        """
        line = self.get_object()
        if line.simulation.status in {SimulationStatus.FINALIZED, SimulationStatus.ARCHIVED}:
            raise PermissionDenied("Simulation non modifiable — recalcul de ligne interdit.")
        recalculate_single_line(line)
        line.refresh_from_db()
        return Response(SimulationLineSerializer(line).data)


def _simulation_aggregates(simulation: Simulation) -> dict:
    """Per-column aggregates for the compare matrix (CDC §6.9.8)."""
    agg = simulation.lines.aggregate(
        avg_pa=Avg("pa_net_eur"),
        avg_pr=Avg("pr_eur"),
        avg_pv=Avg("pv_eur"),
        avg_margin=Avg("effective_margin_rate"),
        min_pv=Min("pv_eur"),
        max_pv=Max("pv_eur"),
    )

    def _s(value):
        return str(value) if value is not None else None

    return {
        "line_count": simulation.lines.count(),
        "avg_pa_eur": _s(agg["avg_pa"]),
        "avg_pr_eur": _s(agg["avg_pr"]),
        "avg_pv_eur": _s(agg["avg_pv"]),
        "avg_margin": _s(agg["avg_margin"]),
        "min_pv_eur": _s(agg["min_pv"]),
        "max_pv_eur": _s(agg["max_pv"]),
        "warnings_count": simulation.lines.filter(status="warning").count(),
        "errors_count": simulation.lines.filter(status="error").count(),
    }


def _symea_position(chain: dict | None) -> str:
    purchase = (chain or {}).get("purchase_chain") or {}
    margin = purchase.get("symea_margin") or {}
    return margin.get("position", "after_transports")


def _chain_module_count(chain: dict | None) -> int:
    if not chain:
        return 0
    n = 0
    for side in ("purchase_chain", "sale_chain"):
        cfg = chain.get(side) or {}
        for key in ("transports", "customs"):
            arr = cfg.get(key)
            if isinstance(arr, list):
                n += len(arr)
        if cfg.get("symea_margin") or cfg.get("syskern_margin"):
            n += 1
    return n


def _simulation_column_context(s: Simulation) -> dict:
    chain = s.calculation_chain or {}
    return {
        "market_params": s.market_params or {},
        "stock_purchase_mix_pct": s.stock_purchase_mix_pct,
        "symea_margin_rate": str(s.symea_margin_rate),
        "syskern_margin_rate": str(s.syskern_margin_rate),
        "symea_margin_position": _symea_position(chain),
        "sale_incoterm": s.sale_incoterm,
        "sale_incoterm_location": s.sale_incoterm_location or "",
        "simulation_type": s.simulation_type,
        "calculated_at": s.last_calculated_at.isoformat() if s.last_calculated_at else None,
        "odoo_snapshot_at": s.odoo_snapshot_at.isoformat() if s.odoo_snapshot_at else None,
        "trigger_type": None,
        "chain_module_count": _chain_module_count(chain),
        "note": None,
    }


def _recalc_column_context(r: SimulationRecalculation) -> dict:
    chain = r.calculation_chain or {}
    return {
        "market_params": r.market_params or {},
        "stock_purchase_mix_pct": r.stock_purchase_mix_pct,
        "symea_margin_rate": str(r.symea_margin_rate),
        "syskern_margin_rate": str(r.syskern_margin_rate),
        "symea_margin_position": _symea_position(chain),
        "sale_incoterm": r.sale_incoterm,
        "sale_incoterm_location": r.sale_incoterm_location or "",
        "simulation_type": None,
        "calculated_at": r.calculated_at.isoformat(),
        "odoo_snapshot_at": r.odoo_snapshot_at.isoformat() if r.odoo_snapshot_at else None,
        "trigger_type": r.trigger_type,
        "chain_module_count": _chain_module_count(chain),
        "note": r.note or None,
    }


class CompareSimulationsView(viewsets.ViewSet):
    """`POST /api/simulations/compare` (CDC §6.9.8, §6.9.12).

    Body: `{"simulation_ids": [...], "recalculation_ids": [...]}` (2..4 columns
    total). Returns ordered `columns` (live simulations first, then frozen
    recalculation snapshots) and a `products` matrix (SKU × column) carrying
    PV/PR/PA, effective margin and mix per cell. Deltas/colour coding are
    computed client-side against the first column.
    """

    def create(self, request):
        ser = CompareSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        sim_ids = [str(x) for x in ser.validated_data.get("simulation_ids") or []]
        recalc_ids = [str(x) for x in ser.validated_data.get("recalculation_ids") or []]

        sims = {str(s.id): s for s in Simulation.objects.filter(id__in=sim_ids)}
        if len(sims) != len(set(sim_ids)):
            raise ValidationError("Certaines simulations sont introuvables.")
        recalcs = {
            str(r.id): r
            for r in SimulationRecalculation.objects.filter(id__in=recalc_ids).select_related(
                "simulation"
            )
        }
        if len(recalcs) != len(set(recalc_ids)):
            raise ValidationError("Certains recalculs sont introuvables.")

        columns: list[dict] = []
        matrix: dict = {}

        def _entry(product_id, sku, name):
            return matrix.setdefault(
                str(product_id),
                {"product_id": str(product_id), "product_sku": sku, "product_name": name,
                 "values": {}},
            )

        # ── Live simulation columns (baseline first) ──────────────────
        for sid in sim_ids:
            s = sims[sid]
            key = f"simulation:{sid}"
            columns.append(
                {
                    "key": key,
                    "type": "simulation",
                    "id": sid,
                    "simulation_id": sid,
                    "label": s.label,
                    "status": s.status,
                    "aggregates": _simulation_aggregates(s),
                    "context": _simulation_column_context(s),
                }
            )
            for line in s.lines.select_related("product").all():
                entry = _entry(line.product_id, line.product.sku_code, line.product.designation)
                entry["values"][key] = {
                    "pa_net_eur": str(line.pa_net_eur) if line.pa_net_eur is not None else None,
                    "pr_eur": str(line.pr_eur) if line.pr_eur is not None else None,
                    "pv_eur": str(line.pv_eur) if line.pv_eur is not None else None,
                    "effective_margin_rate": (
                        str(line.effective_margin_rate)
                        if line.effective_margin_rate is not None
                        else None
                    ),
                    "effective_mix_pct": line.effective_mix_pct,
                }

        # ── Frozen recalculation-snapshot columns (CDC §6.9.12) ───────
        for rid in recalc_ids:
            r = recalcs[rid]
            key = f"recalculation:{rid}"
            columns.append(
                {
                    "key": key,
                    "type": "recalculation",
                    "id": rid,
                    "simulation_id": str(r.simulation_id),
                    "label": f"Recalcul du {r.calculated_at:%d/%m/%Y %H:%M}",
                    "status": None,
                    "aggregates": r.aggregates,
                    "context": _recalc_column_context(r),
                }
            )
            for snap in r.line_snapshots or []:
                entry = _entry(snap.get("product_id"), snap.get("sku"), snap.get("designation"))
                entry["values"][key] = {
                    "pa_net_eur": snap.get("pa_net_eur"),
                    "pr_eur": snap.get("pr_eur"),
                    "pv_eur": snap.get("pv_eur"),
                    "effective_margin_rate": snap.get("effective_margin_rate"),
                    "effective_mix_pct": snap.get("effective_mix_pct"),
                }

        return Response({"columns": columns, "products": list(matrix.values())})


class SavedComparisonViewSet(viewsets.ModelViewSet):
    """CRUD for persisted compare configurations."""

    queryset = SavedComparison.objects.all()
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return SavedComparisonWriteSerializer
        return SavedComparisonSerializer

    def perform_create(self, serializer):
        serializer.save()

    def create(self, request, *args, **kwargs):
        write = SavedComparisonWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        obj = SavedComparison.objects.create(**write.validated_data)
        return Response(
            SavedComparisonSerializer(obj).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        obj = self.get_object()
        ser = SavedComparisonPatchSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(SavedComparisonSerializer(obj).data)
