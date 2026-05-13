"""DRF views for the PIM (CDC §4.4)."""
from __future__ import annotations

from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.simulations.models import (
    Simulation,
    SimulationLine,
    SimulationStatus,
)

from .filters import ProductFilter
from .models import Product, ProductSupplier
from .serializers import (
    ProductDetailSerializer,
    ProductListSerializer,
    ProductSupplierSerializer,
    ProductWriteSerializer,
)


class ProductViewSet(viewsets.ModelViewSet):
    """CRUD over the catalog.

    - `list`   uses `ProductListSerializer` (compact)
    - `retrieve` uses `ProductDetailSerializer` (full payload + suppliers)
    - `create` / `update` use `ProductWriteSerializer` with validations
    - `destroy` is a soft-delete (`is_active = false`)
    """

    queryset = Product.objects.all().prefetch_related("suppliers")
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
    ordering_fields = ("sku_code", "name", "pamp_eur", "stock_quantity", "updated_at")
    ordering = ("sku_code",)

    def get_serializer_class(self):
        if self.action == "list":
            return ProductListSerializer
        if self.action in {"create", "update", "partial_update"}:
            return ProductWriteSerializer
        return ProductDetailSerializer

    def perform_destroy(self, instance: Product) -> None:
        """Soft-delete (CDC §4.6) — keeps historical simulations valid."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    # ─── /api/products/{id}/price-history ─────────────────────────────────
    @action(detail=True, methods=["get"], url_path="price-history")
    def price_history(self, request, pk=None):
        """Trailing PA/PR/PV chart on the product detail page (CDC §4.1.6).

        Returns one point per `simulation_line` belonging to a *finalized*
        simulation within the requested window.  No caching; the volume
        stays modest even with hundreds of simulations.
        """
        product = self.get_object()
        period = request.query_params.get("period", "6m")
        days_map = {"3m": 90, "6m": 180, "12m": 365}
        days = days_map.get(period, 180)

        from django.utils import timezone
        from datetime import timedelta

        cutoff = timezone.now() - timedelta(days=days)

        lines = (
            SimulationLine.objects.filter(
                product=product,
                simulation__status=SimulationStatus.FINALIZED,
                simulation__last_calculated_at__gte=cutoff,
            )
            .select_related("simulation")
            .order_by("-simulation__last_calculated_at")
        )

        points = [
            {
                "date": line.simulation.last_calculated_at,
                "pa_eur": line.pa_net_eur,
                "pr_eur": line.pr_eur,
                "pv_eur": line.pv_eur,
                "simulation_id": str(line.simulation_id),
                "simulation_label": line.simulation.label,
            }
            for line in lines
            if line.simulation.last_calculated_at is not None
        ]
        return Response({"period": period, "points": points})

    # ─── /api/products/{id}/suppliers ────────────────────────────────────
    @action(detail=True, methods=["get"], url_path="suppliers")
    def list_suppliers(self, request, pk=None):
        product = self.get_object()
        ser = ProductSupplierSerializer(product.suppliers.all(), many=True)
        return Response(ser.data)


class ProductSupplierViewSet(viewsets.ModelViewSet):
    """CRUD over product sources.  Activation is mutually exclusive per
    product — see the dedicated `activate` action."""

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
        ProductSupplier.objects.filter(product_id=supplier.product_id).exclude(
            pk=supplier.pk
        ).update(is_active=False)
        supplier.is_active = True
        supplier.save(update_fields=["is_active", "updated_at"])
        return Response(ProductSupplierSerializer(supplier).data)


# ─── Reference lookups for filter cascades (CDC §4.4) ────────────────────


from rest_framework.views import APIView


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
                qs = qs.filter(**{parent: val})
            if parent == level:
                break

        values = (
            qs.exclude(**{f"{level}": ""})
            .order_by(level)
            .values_list(level, flat=True)
            .distinct()
        )
        return Response({"level": level, "values": list(values)})


class DistinctBrandsView(APIView):
    def get(self, request):
        values = (
            Product.objects.filter(is_active=True)
            .exclude(brand="")
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
