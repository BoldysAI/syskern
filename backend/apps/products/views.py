"""DRF views for the PIM (CDC §4.4)."""

from __future__ import annotations

import uuid as _uuid_module
from datetime import timedelta

from django.db import transaction
from django.db.models import Prefetch, Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attributes.models import AttributeRegistry, ProductAttributeValue
from apps.attributes.serializers import ProductAttributeValueSerializer
from apps.simulations.models import SimulationLine, SimulationStatus

from .filters import ProductFilter
from .models import Product, ProductSupplier
from .ordering import ProductOrderingFilter
from .serializers import (
    BulkLookupSerializer,
    BulkTranslateSerializer,
    ProductDetailSerializer,
    ProductListSerializer,
    ProductSupplierSerializer,
    ProductWriteSerializer,
)
from .services.catalog_pv import build_catalog_pv_map, catalog_pv_payload
from .services.completeness import build_attribute_completeness, build_product_completeness_map
from .services.sku_parser import parse_sku
from .tasks import (
    EXPORT_DIR,
    bulk_translate_products_task,
    export_products_task,
    refresh_pamp_task,
    translate_product_task,
)


class ProductViewSet(viewsets.ModelViewSet):
    """CRUD over the catalog.

    - `list`   uses `ProductListSerializer` (compact)
    - `retrieve` uses `ProductDetailSerializer` (full payload + suppliers)
    - `create` / `update` use `ProductWriteSerializer` with validations
    - `destroy` is a soft-delete (`is_active = false`)
    """

    queryset = Product.objects.all().prefetch_related("suppliers")
    filter_backends = [DjangoFilterBackend, SearchFilter, ProductOrderingFilter]
    filterset_class = ProductFilter
    search_fields = (
        "sku_code",
        "name",
        "parent_reference",
        "factory_code",
        "gtin",
        # JSON search: PostgreSQL falls back to text comparison on these.
        "description_marketing",
        "description_technical",
    )
    ordering_fields = (
        "sku_code",
        "name",
        "universe",
        "family",
        "range",
        "sub_range",
        "brand",
        "active_supplier",
        "pamp_eur",
        "stock_quantity",
        "is_copper_indexed",
        "is_active",
        "updated_at",
    )
    ordering = ("sku_code",)

    _MAX_ATTR_COLUMNS = 10

    # ── 1.A — Lookup by UUID or SKU (CDC §4.4) ───────────────────────────────

    def get_object(self):
        """Allow detail endpoints to be accessed by UUID *or* sku_code.

        If the `pk` URL segment is not a valid UUID, it is treated as a
        sku_code lookup.  Returns 404 when neither matches.
        """
        pk = self.kwargs["pk"]
        try:
            _uuid_module.UUID(pk)
        except ValueError:
            obj = get_object_or_404(Product, sku_code=pk)
            self.kwargs["pk"] = str(obj.pk)
        return super().get_object()

    def get_serializer_class(self):
        if self.action == "list":
            return ProductListSerializer
        if self.action in {"create", "update", "partial_update"}:
            return ProductWriteSerializer
        return ProductDetailSerializer

    def _parse_attr_columns(self) -> list[str]:
        raw = self.request.query_params.get("attr_columns", "")
        if not raw:
            return []
        codes = [c.strip() for c in raw.split(",") if c.strip()]
        return codes[: self._MAX_ATTR_COLUMNS]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            attr_columns = self._parse_attr_columns()
            if attr_columns:
                qs = qs.prefetch_related(
                    Prefetch(
                        "attribute_values",
                        queryset=ProductAttributeValue.objects.filter(
                            attribute__code__in=attr_columns
                        ).select_related("attribute"),
                    )
                )
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.action == "list":
            ctx["attr_columns"] = self._parse_attr_columns()
        return ctx

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        items = page if page is not None else list(queryset)
        product_ids = [str(p.id) for p in items]
        simulation_id = (request.query_params.get("simulation_id") or "").strip() or None
        pv_map = build_catalog_pv_map(product_ids, simulation_id=simulation_id)
        completeness_map = build_product_completeness_map(items)

        serializer = self.get_serializer(
            items,
            many=True,
            context={
                **self.get_serializer_context(),
                "catalog_pv_map": pv_map,
                "completeness_map": completeness_map,
            },
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def perform_destroy(self, instance: Product) -> None:
        """Soft-delete (CDC §4.6) — keeps historical simulations valid."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        self._push_to_odoo_async(instance)

    def perform_create(self, serializer) -> None:
        instance = serializer.save()
        from apps.attributes.services.backfill import apply_registry_defaults_to_product

        apply_registry_defaults_to_product(instance)
        self._push_to_odoo_async(instance)

    def perform_update(self, serializer) -> None:
        instance = serializer.save()
        self._push_to_odoo_async(instance)

    @staticmethod
    def _push_to_odoo_async(product: Product) -> None:
        """Push this product to Odoo (CDC §5.3, §5.4.3).

        Delegates to the shared ``push_product_async`` service so the wizard
        and the quarantine resolution close the exact same loop.
        """
        from apps.odoo_sync.services.push import push_product_async

        push_product_async(product)

    # ── /api/products/parse-sku (CDC §4.1.3) ─────────────────────────────────

    @action(detail=False, methods=["post"], url_path="parse-sku")
    def parse_sku(self, request):
        """Derive `parent_reference` and `factory_code` from a raw SKU.

        Utility endpoint used by the creation wizard to pre-fill its fields
        (the user can override). Body: `{"sku": "KCFF6A4PZHDBL5-21"}`.
        """
        raw = request.data.get("sku") if isinstance(request.data, dict) else None
        if not raw or not str(raw).strip():
            return Response(
                {"detail": "Le champ « sku » est requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(parse_sku(str(raw)))

    # ── /api/products/attribute-completeness ─────────────────────────────────

    @action(detail=False, methods=["get"], url_path="attribute-completeness")
    def attribute_completeness(self, request):
        """Per-field fill rate across the active catalog (FEEDBACK 1).

        Returns ``{total_products, average_percent, fields[]}`` (core columns +
        dynamic attributes), sorted least-complete first. Powers the completeness
        table on ``/settings/attributes`` and the dashboard widget.
        """
        return Response(build_attribute_completeness())

    # ── /api/products/{id}/price-history ─────────────────────────────────────

    @action(detail=True, methods=["get"], url_path="price-history")
    def price_history(self, request, pk=None):
        """Trailing PA/PR/PV chart on the product detail page (CDC §4.1.6).

        Returns one point per `simulation_line` belonging to a *finalized*
        simulation within the requested window.
        """
        product = self.get_object()
        period = request.query_params.get("period", "6m")
        days_map = {"3m": 90, "6m": 180, "12m": 365}
        days = days_map.get(period, 180)

        cutoff = timezone.now() - timedelta(days=days)

        lines = (
            SimulationLine.objects.filter(
                product=product,
                simulation__status=SimulationStatus.FINALIZED,
                simulation__last_calculated_at__gte=cutoff,
            )
            .select_related("simulation")
            .order_by("simulation__last_calculated_at")
        )

        points = []
        for line in lines:
            if line.simulation.last_calculated_at is None:
                continue
            point = {
                "date": line.simulation.last_calculated_at,
                "pa_eur": line.pa_net_eur,
                "pr_eur": line.pr_eur,
                "pv_eur": line.pv_eur,
                "simulation_id": str(line.simulation_id),
                "simulation_label": line.simulation.label,
            }
            if line.pv_eur is not None:
                point.update(
                    catalog_pv_payload(
                        line.pv_eur,
                        simulation_id=line.simulation_id,
                        market_params=line.simulation.market_params or {},
                    )
                )
            points.append(point)
        return Response({"period": period, "points": points})

    # ── /api/products/{id}/refresh-pamp ──────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="refresh-pamp")
    def refresh_pamp(self, request, pk=None):
        """Dispatch a Celery task to refresh PAMP+stock from Odoo.

        Returns 202 with `task_id`; client polls `/api/tasks/{task_id}/`.
        """
        product = self.get_object()
        if not product.odoo_id:
            return Response(
                {"detail": "Produit non lié à Odoo — PAMP non recalculable."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = refresh_pamp_task.delay(str(product.pk))
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    # ── /api/products/{id}/translate (CDC §10.4) ─────────────────────────────

    @action(detail=True, methods=["post"], url_path="translate")
    def translate(self, request, pk=None):
        """Dispatch a Celery task to translate the FR descriptions via DeepL.

        Returns 202 with `task_id`; client polls `/api/tasks/{task_id}/`.
        """
        product = self.get_object()
        target = str((request.data or {}).get("target_lang", "")).lower()
        if target not in {"en", "es"}:
            return Response(
                {"detail": "Langue cible invalide (attendu : en ou es)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        marketing_fr = (product.description_marketing or {}).get("fr", "")
        technical_fr = (product.description_technical or {}).get("fr", "")
        if not marketing_fr and not technical_fr:
            return Response(
                {"detail": "Aucune description française à traduire."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = translate_product_task.delay(str(product.pk), target)
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    # ── /api/products/bulk-translate (CDC §10.3.2) ───────────────────────────

    @action(detail=False, methods=["post"], url_path="bulk-translate")
    def bulk_translate(self, request):
        """Translate several products' descriptions via DeepL (async, CDC §10.3.2).

        Returns 202 with `task_id`; client polls `/api/tasks/{task_id}/` and reads
        `progress` ({current, total}) to render a progress bar.
        """
        ser = BulkTranslateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        task = bulk_translate_products_task.delay(
            [str(i) for i in data["ids"]],
            data["source_lang"],
            data["target_langs"],
            data.get("content_fields") or ["marketing", "technical"],
        )
        return Response(
            {"task_id": task.id, "status": "PENDING", "product_count": len(data["ids"])},
            status=status.HTTP_202_ACCEPTED,
        )

    # ── 1.C — /api/products/{id}/attributes (CDC §4.4) ───────────────────────

    @action(detail=True, methods=["get"], url_path="attributes")
    def list_attributes(self, request, pk=None):
        """List all attribute values set on a product."""
        product = self.get_object()
        values = ProductAttributeValue.objects.filter(product=product).select_related("attribute")
        ser = ProductAttributeValueSerializer(values, many=True)
        return Response(ser.data)

    @action(
        detail=True,
        methods=["put", "delete"],
        url_path=r"attributes/(?P<attribute_id>[^/.]+)",
    )
    def attribute_detail(self, request, pk=None, attribute_id=None):
        """Upsert (PUT) or remove (DELETE) a single attribute value on a product.

        PUT body: `{"value": <typed value>}`.  Value is validated against
        the attribute's data_type (CDC §4.5).
        """
        product = self.get_object()

        if request.method == "DELETE":
            pav = get_object_or_404(
                ProductAttributeValue, product=product, attribute_id=attribute_id
            )
            pav.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PUT — upsert
        attribute = get_object_or_404(AttributeRegistry, pk=attribute_id)
        pav, _ = ProductAttributeValue.objects.get_or_create(product=product, attribute=attribute)
        data = {
            "product": str(product.pk),
            "attribute": str(attribute.pk),
            "value": request.data.get("value"),
        }
        ser = ProductAttributeValueSerializer(pav, data=data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=status.HTTP_200_OK)

    # ── 1.D — /api/products/{id}/suppliers (CDC §4.4) ────────────────────────

    @action(detail=True, methods=["get", "post"], url_path="suppliers")
    def suppliers(self, request, pk=None):
        """List (GET) or create (POST) a supplier for this product."""
        product = self.get_object()

        if request.method == "GET":
            ser = ProductSupplierSerializer(product.suppliers.all(), many=True)
            return Response(ser.data)

        # POST — create new supplier scoped to this product
        data = {**request.data, "product": str(product.pk)}
        ser = ProductSupplierSerializer(data=data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"suppliers/(?P<supplier_pk>[^/.]+)",
    )
    def supplier_detail(self, request, pk=None, supplier_pk=None):
        """Partial-update (PATCH) or delete (DELETE) a supplier by its UUID."""
        product = self.get_object()
        supplier = self._get_supplier(product, supplier_pk)

        if request.method == "DELETE":
            supplier.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH
        ser = ProductSupplierSerializer(supplier, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    @action(
        detail=True,
        methods=["post"],
        url_path=r"suppliers/(?P<supplier_pk>[^/.]+)/activate",
    )
    def activate_supplier(self, request, pk=None, supplier_pk=None):
        """Activate this supplier and deactivate all others for the same product.

        The two writes run in a single transaction so the partial unique index
        `one_active_supplier_per_product` is never violated mid-update.
        """
        product = self.get_object()
        supplier = self._get_supplier(product, supplier_pk)

        with transaction.atomic():
            ProductSupplier.objects.filter(product=product).exclude(pk=supplier.pk).update(
                is_active=False
            )
            supplier.is_active = True
            supplier.save(update_fields=["is_active", "updated_at"])
        return Response(ProductSupplierSerializer(supplier).data)

    @staticmethod
    def _get_supplier(product: Product, supplier_pk: str) -> ProductSupplier:
        return get_object_or_404(ProductSupplier, pk=supplier_pk, product=product)

    # ── 1.E — /api/products/export (CDC §4.1.1) ──────────────────────────────

    @action(detail=False, methods=["get", "post"], url_path="export")
    def export(self, request):
        """Dispatch a Celery task to build the catalog Excel (CDC §4.1.1).

        POST body (preferred):
          - `filters`: same shape as `GET /api/products` query params
          - `columns`: ordered list of column keys to include (optional)
          - `ids`: explicit product ids to export (selection — optional)

        For backwards compatibility, query-parameters are also accepted as
        filters. Returns 202 + `task_id`; the client polls
        `/api/tasks/{task_id}/` then downloads from the returned `file_url`.
        """
        body = request.data if isinstance(request.data, dict) else {}
        filters = body.get("filters")
        if not isinstance(filters, dict):
            filters = request.query_params.dict()
        columns = body.get("columns") if isinstance(body.get("columns"), list) else None
        ids = body.get("ids") if isinstance(body.get("ids"), list) else None

        result = export_products_task.delay(filters=filters, columns=columns, ids=ids)
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    # ── /api/products/exports/{task_id} — file download ────────────────────────
    @action(detail=False, methods=["get"], url_path=r"exports/(?P<task_id>[\w-]+)")
    def export_file(self, request, task_id=None):
        """Stream the Excel produced by `export_products_task` (by task_id)."""
        file_path = EXPORT_DIR / f"{task_id}.xlsx"
        if not file_path.is_file():
            raise Http404("Export introuvable ou expiré.")
        return FileResponse(
            file_path.open("rb"),
            as_attachment=True,
            filename="catalogue_syskern.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )


class ProductSupplierViewSet(viewsets.ModelViewSet):
    """CRUD over product sources.  Activation is mutually exclusive per
    product — see the dedicated `activate` action.

    The flat `/api/product-suppliers/` route is kept for backwards-compatibility.
    Prefer the nested `/api/products/{id}/suppliers/` endpoints for new clients.
    """

    queryset = ProductSupplier.objects.select_related("product").all()
    serializer_class = ProductSupplierSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        product_id = self.request.query_params.get("product")
        if product_id:
            qs = qs.filter(product_id=product_id)
        return qs

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        """Activate this source and deactivate any other for the same product."""
        supplier = self.get_object()
        with transaction.atomic():
            ProductSupplier.objects.filter(product_id=supplier.product_id).exclude(
                pk=supplier.pk
            ).update(is_active=False)
            supplier.is_active = True
            supplier.save(update_fields=["is_active", "updated_at"])
        return Response(ProductSupplierSerializer(supplier).data)


# ─── Reference lookups for filter cascades (CDC §4.4) ────────────────────────


class DistinctHierarchyView(APIView):
    """GET /api/hierarchy/distinct?level=universe[&universe=Tube&family=...]"""

    def get(self, request):
        level = request.query_params.get("level", "universe")
        if level not in {"universe", "family", "range", "sub_range"}:
            return Response({"detail": "invalid level"}, status=status.HTTP_400_BAD_REQUEST)

        qs = Product.objects.filter(is_active=True)
        for parent in ("universe", "family", "range"):
            val = request.query_params.get(parent)
            if val:
                qs = self._filter_csv_iexact(qs, parent, val)
            if parent == level:
                break

        values = (
            qs.exclude(**{f"{level}": ""}).order_by(level).values_list(level, flat=True).distinct()
        )
        return Response({"level": level, "values": list(values)})

    @staticmethod
    def _filter_csv_iexact(queryset, field: str, value: str):
        """Match one or several comma-separated values (case-insensitive)."""
        values = [v.strip() for v in value.split(",") if v.strip()]
        if not values:
            return queryset
        q = Q()
        for v in values:
            q |= Q(**{f"{field}__iexact": v})
        return queryset.filter(q)


class CatalogFilterBoundsView(APIView):
    """GET /api/products/filter-bounds — min/max for numeric catalog filters.

    Accepts the same query params as the product list, except range sliders
    (pamp_min, pamp_max, stock_min) which are ignored so bounds reflect the
    current facet context, not the active range selection.
    """

    _IGNORED_PARAMS = frozenset(
        {
            "pamp_min",
            "pamp_max",
            "stock_min",
            "page",
            "limit",
            "offset",
            "ordering",
            "i18n_incomplete",
            "lang_fr_in",
            "lang_fr_out",
            "lang_en_in",
            "lang_en_out",
            "lang_es_in",
            "lang_es_out",
        }
    )

    def get(self, request):
        from django.db.models import Max, Min

        data = {
            k: v
            for k, v in request.query_params.items()
            if k not in self._IGNORED_PARAMS and not k.startswith("attr_")
        }
        qs = ProductFilter(data=data, queryset=Product.objects.all()).qs

        aggs = qs.aggregate(
            pamp_min=Min("pamp_eur"),
            pamp_max=Max("pamp_eur"),
            stock_min=Min("stock_quantity"),
            stock_max=Max("stock_quantity"),
        )

        def _num(v):
            if v is None:
                return None
            return float(v)

        attributes: dict[str, dict[str, float]] = {}
        number_attrs = AttributeRegistry.objects.filter(is_filterable=True, data_type="number")
        for attr in number_attrs:
            nums: list[float] = []
            for raw in (
                ProductAttributeValue.objects.filter(attribute=attr, product__in=qs)
                .exclude(value__isnull=True)
                .values_list("value", flat=True)
            ):
                try:
                    nums.append(float(raw))
                except (TypeError, ValueError):
                    continue
            if nums:
                attributes[attr.code] = {"min": min(nums), "max": max(nums)}

        return Response(
            {
                "pamp_eur": {
                    "min": _num(aggs["pamp_min"]),
                    "max": _num(aggs["pamp_max"]),
                },
                "stock_quantity": {
                    "min": _num(aggs["stock_min"]),
                    "max": _num(aggs["stock_max"]),
                },
                "attributes": attributes,
            }
        )


class DistinctBrandsView(APIView):
    def get(self, request):
        values = (
            Product.objects.all()
            .exclude(brand="")
            .exclude(brand__iexact="unnikern")  # legacy typo
            .order_by("brand")
            .values_list("brand", flat=True)
            .distinct()
        )
        return Response({"values": list(values)})


class DistinctFactoryCodesView(APIView):
    def get(self, request):
        values = (
            Product.objects.filter(is_active=True)
            .exclude(factory_code="")
            .order_by("factory_code")
            .values_list("factory_code", flat=True)
            .distinct()
        )
        return Response({"values": list(values)})


class DistinctSupplierNamesView(APIView):
    """GET /api/supplier-names — distinct supplier names across the catalog."""

    def get(self, request):
        values = (
            ProductSupplier.objects.order_by("supplier_name")
            .values_list("supplier_name", flat=True)
            .distinct()
        )
        return Response({"values": list(values)})


class BulkLookupView(APIView):
    """POST /api/products/lookup-bulk — resolve a list of SKU codes (CDC §6.9.2).

    Used by the simulation creation wizard's "import file" path: the client
    parses an Excel/CSV column `sku_code` and posts the raw values here.

    Body: `{"skus": ["SKU-1", "SKU-2", ...]}`.
    Response: `{"found": [{"id", "sku_code", "name"}], "not_found": ["..."]}`.

    Performance: a single `sku_code__in` query resolves the whole batch, so
    1000 SKU stay well under a second. Input order and exact casing are
    preserved; duplicates collapse to a single entry.
    """

    def post(self, request):
        ser = BulkLookupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        raw_skus: list[str] = ser.validated_data["skus"]

        # De-duplicate while preserving first-seen order.
        seen: set[str] = set()
        ordered_skus: list[str] = []
        for sku in raw_skus:
            cleaned = sku.strip()
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                ordered_skus.append(cleaned)

        matches = {
            row["sku_code"]: row
            for row in Product.objects.filter(sku_code__in=ordered_skus, is_active=True).values(
                "id", "sku_code", "name"
            )
        }

        found = [matches[sku] for sku in ordered_skus if sku in matches]
        not_found = [sku for sku in ordered_skus if sku not in matches]
        return Response({"found": found, "not_found": not_found})


class SupplierNameTemplateView(APIView):
    """GET /api/supplier-names/template?name=... — defaults from the latest row."""

    def get(self, request):
        name = (request.query_params.get("name") or "").strip()
        if not name:
            return Response(
                {"detail": "Le paramètre « name » est requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        supplier = (
            ProductSupplier.objects.filter(supplier_name=name).order_by("-updated_at").first()
        )
        if supplier is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(ProductSupplierSerializer(supplier).data)
