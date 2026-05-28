"""DRF views for the PIM (CDC §4.4)."""
from __future__ import annotations

import uuid as _uuid_module
from datetime import timedelta

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attributes.models import AttributeRegistry, ProductAttributeValue
from apps.attributes.serializers import ProductAttributeValueSerializer
from apps.odoo_sync.adapters.factory import get_odoo_adapter
from apps.offers.services.translation import DeepLClient, TranslationError
from apps.simulations.models import SimulationLine, SimulationStatus

from .exports import build_products_xlsx
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

    def perform_destroy(self, instance: Product) -> None:
        """Soft-delete (CDC §4.6) — keeps historical simulations valid."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

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

    # ── /api/products/{id}/refresh-pamp ──────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="refresh-pamp")
    def refresh_pamp(self, request, pk=None):
        """Re-pull this product's PAMP + stock from Odoo (read-only on Odoo).

        PAMP (`pamp_eur`) is Odoo's `standard_price`. This reads the latest
        value for the single product and updates the *local* DB only — it
        never writes back to Odoo.
        """
        product = self.get_object()

        if not product.odoo_id:
            return Response(
                {"detail": "Produit non lié à Odoo — PAMP non recalculable."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            adapter = get_odoo_adapter()
            adapter.authenticate()
            stock_map = adapter.get_stock_quantities([product.odoo_id])
        except Exception as exc:  # noqa: BLE001 — surface any Odoo failure cleanly
            return Response(
                {"detail": f"Odoo indisponible : {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        stock = stock_map.get(product.odoo_id)
        if stock is None:
            return Response(
                {"detail": "Produit introuvable dans Odoo."},
                status=status.HTTP_404_NOT_FOUND,
            )

        now = timezone.now()
        update_fields = {
            "stock_quantity": stock.quantity,
            "odoo_last_sync_at": now,
        }
        if stock.standard_price_eur is not None:
            update_fields["pamp_eur"] = stock.standard_price_eur
            update_fields["pamp_synced_at"] = now

        Product.objects.filter(pk=product.pk).update(**update_fields)
        product.refresh_from_db()
        return Response(ProductDetailSerializer(product).data)

    # ── /api/products/{id}/translate (CDC §10.4) ─────────────────────────────

    @action(detail=True, methods=["post"], url_path="translate")
    def translate(self, request, pk=None):
        """Translate the FR descriptions to a target language via DeepL.

        Stores the result in the `description_marketing[lang]` /
        `description_technical[lang]` JSONB cache so it is reused next time.
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

        client = DeepLClient()
        try:
            marketing_tr = (
                client.translate(source_text=marketing_fr, source_lang="fr", target_lang=target)
                if marketing_fr else ""
            )
            technical_tr = (
                client.translate(source_text=technical_fr, source_lang="fr", target_lang=target)
                if technical_fr else ""
            )
        except TranslationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        marketing = dict(product.description_marketing or {})
        technical = dict(product.description_technical or {})
        if marketing_tr:
            marketing[target] = marketing_tr
        if technical_tr:
            technical[target] = technical_tr
        product.description_marketing = marketing
        product.description_technical = technical
        product.save(
            update_fields=["description_marketing", "description_technical", "updated_at"]
        )
        return Response(ProductDetailSerializer(product).data)

    # ── 1.C — /api/products/{id}/attributes (CDC §4.4) ───────────────────────

    @action(detail=True, methods=["get"], url_path="attributes")
    def list_attributes(self, request, pk=None):
        """List all attribute values set on a product."""
        product = self.get_object()
        values = (
            ProductAttributeValue.objects.filter(product=product)
            .select_related("attribute")
        )
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
        pav, _ = ProductAttributeValue.objects.get_or_create(
            product=product, attribute=attribute
        )
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
        """Activate this supplier and deactivate all others for the same product."""
        product = self.get_object()
        supplier = self._get_supplier(product, supplier_pk)

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
        """Export the filtered product list as an Excel workbook.

        Honors the exact same query-parameters as `GET /api/products`
        (universe, search, ordering, hierarchy cascade, …) so the export
        always matches what the user sees in the catalog.
        """
        qs = self.filter_queryset(self.get_queryset())

        xlsx_bytes = build_products_xlsx(qs)
        response = HttpResponse(
            xlsx_bytes,
            content_type=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
        )
        response["Content-Disposition"] = 'attachment; filename="catalog_export.xlsx"'
        return response


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
