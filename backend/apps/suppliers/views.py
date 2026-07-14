"""DRF views for the Fournisseurs module (Épic FEEDBACK 1 — écart CDC §11.3).

Supplier is now a first-class entity: full CRUD, management of the SKU links
from the supplier side, and a batch Excel PO import (async Celery). Deleting a
supplier is a soft-delete and is refused (409) while SKUs are still linked.
"""

from __future__ import annotations

import uuid as _uuid_module

from django.db.models import Count
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.products.models import Product, ProductSupplier

from .filters import SupplierFilter
from .models import Supplier
from .serializers import (
    SupplierBulkLinkSerializer,
    SupplierBulkPoSerializer,
    SupplierDetailSerializer,
    SupplierListSerializer,
    SupplierPriceHistorySerializer,
    SupplierProductLinkSerializer,
    SupplierSkuLinkInputSerializer,
    SupplierWriteSerializer,
)
from .services import apply_bulk_po, bulk_link_skus
from .tasks import IMPORT_DIR, import_po_task

_ALLOWED_UPLOAD_SUFFIXES = (".xlsx", ".xlsm")


class SupplierViewSet(viewsets.ModelViewSet):
    """CRUD over the supplier entity (`/api/suppliers/`).

    - `list`     → `SupplierListSerializer` (compact + `linked_skus_count`)
    - `create` / `update` → `SupplierWriteSerializer`
    - `retrieve` → `SupplierDetailSerializer`
    - `destroy`  → soft-delete (`is_active = false`), 409 if SKUs still linked
    """

    queryset = Supplier.objects.all().annotate(linked_skus_count=Count("product_links"))
    filterset_class = SupplierFilter
    search_fields = ("name", "code", "location")
    ordering_fields = ("name", "code", "linked_skus_count", "updated_at")
    ordering = ("name",)

    def get_object(self):
        """Allow detail endpoints by UUID *or* `code`."""
        pk = self.kwargs["pk"]
        try:
            _uuid_module.UUID(pk)
        except ValueError:
            obj = get_object_or_404(Supplier, code=pk)
            self.kwargs["pk"] = str(obj.pk)
        return super().get_object()

    def get_serializer_class(self):
        if self.action == "list":
            return SupplierListSerializer
        if self.action in {"create", "update", "partial_update"}:
            return SupplierWriteSerializer
        return SupplierDetailSerializer

    def perform_update(self, serializer) -> None:
        instance = serializer.save()
        # Keep the denormalised `supplier_name` on every link in sync with the
        # entity name (used by Odoo sync matching, `?supplier=`, exports).
        ProductSupplier.objects.filter(supplier=instance).exclude(
            supplier_name=instance.name
        ).update(supplier_name=instance.name)

    def destroy(self, request, *args, **kwargs):
        """Soft-delete. Refused (409) while SKUs are still linked (CDC deviation)."""
        supplier = self.get_object()
        if supplier.product_links.exists():
            return Response(
                {
                    "detail": (
                        "Impossible de supprimer ce fournisseur : des SKU y sont encore "
                        "liés. Retirez d'abord les SKU liés."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        supplier.is_active = False
        supplier.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── SKU links (from the supplier side) ────────────────────────────────────

    @action(detail=True, methods=["get", "post"], url_path="skus")
    def skus(self, request, pk=None):
        """List (GET) or link (POST) SKUs for this supplier."""
        supplier = self.get_object()

        if request.method == "GET":
            links = (
                ProductSupplier.objects.filter(supplier=supplier)
                .select_related("product")
                .order_by("product__sku_code")
            )
            return Response(SupplierProductLinkSerializer(links, many=True).data)

        # POST — link an existing SKU (never creates a product).
        ser = SupplierSkuLinkInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        product = self._resolve_product(ser.validated_data)
        if product is None:
            return Response({"detail": "SKU introuvable."}, status=status.HTTP_404_NOT_FOUND)

        existing = ProductSupplier.objects.filter(supplier=supplier, product=product).first()
        if existing is not None:
            return Response(
                {"detail": "Ce SKU est déjà lié à ce fournisseur."},
                status=status.HTTP_409_CONFLICT,
            )

        link = ProductSupplier.objects.create(
            product=product,
            supplier=supplier,
            supplier_name=supplier.name,
            factory_code=supplier.factory_code_default,
            po_currency=supplier.currency_default,
            incoterm=supplier.incoterm_default,
            incoterm_location=supplier.location,
            is_active=False,
        )
        return Response(SupplierProductLinkSerializer(link).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"skus/(?P<link_pk>[^/.]+)")
    def sku_detail(self, request, pk=None, link_pk=None):
        """Unlink a SKU from this supplier (removes the `ProductSupplier` row)."""
        supplier = self.get_object()
        link = get_object_or_404(ProductSupplier, pk=link_pk, supplier=supplier)
        link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="skus/bulk-po")
    def bulk_po(self, request, pk=None):
        """Batch-update PO base prices on selected links (in-app wizard).

        `mode` ∈ {set, pct, abs}. Money stays `Decimal` (AGENTS §5.1). Each change
        writes a `SupplierPriceHistory` entry (source=manual). Links whose price is
        unset are skipped for pct/abs; unchanged values are skipped.
        """
        supplier = self.get_object()
        ser = SupplierBulkPoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        if data.get("product_ids"):
            links = list(
                ProductSupplier.objects.filter(
                    supplier=supplier, product_id__in=data["product_ids"]
                )
            )
        else:
            links = list(ProductSupplier.objects.filter(id__in=data["link_ids"], supplier=supplier))
        updated, skipped = apply_bulk_po(links, mode=data["mode"], value=data["value"])
        return Response({"updated": updated, "skipped": skipped})

    @action(detail=True, methods=["post"], url_path="skus/bulk-link")
    def bulk_link(self, request, pk=None):
        """Link several existing SKUs to this supplier at once (catalog picker)."""
        supplier = self.get_object()
        ser = SupplierBulkLinkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        created, skipped = bulk_link_skus(supplier, ser.validated_data["product_ids"])
        return Response({"created": created, "skipped": skipped}, status=status.HTTP_201_CREATED)

    @staticmethod
    def _resolve_product(data: dict) -> Product | None:
        product_id = data.get("product_id")
        if product_id:
            return Product.objects.filter(pk=product_id).first()
        sku = (data.get("sku") or "").strip()
        if sku:
            return Product.objects.filter(sku_code=sku).first()
        return None

    # ── Price history ─────────────────────────────────────────────────────────

    @action(detail=True, methods=["get"], url_path="price-history")
    def price_history(self, request, pk=None):
        """PO base price change trail across this supplier's links."""
        from apps.products.models import SupplierPriceHistory

        supplier = self.get_object()
        rows = (
            SupplierPriceHistory.objects.filter(product_supplier__supplier=supplier)
            .select_related("product_supplier", "product_supplier__product")
            .order_by("-created_at")
        )
        return Response(SupplierPriceHistorySerializer(rows, many=True).data)

    # ── Batch Excel PO import (async — AGENTS §4) ─────────────────────────────

    @action(
        detail=False,
        methods=["post"],
        url_path="import-po",
        parser_classes=[MultiPartParser, FormParser],
    )
    def import_po(self, request):
        """Upload an Excel (SKU / fournisseur / PO) and dispatch the batch import.

        Returns 202 + `task_id`; the client polls `/api/tasks/{task_id}/` and
        downloads the rejection report from `/api/suppliers/imports/{task_id}/report/`.
        """
        upload = request.FILES.get("file")
        if upload is None:
            return Response(
                {"detail": "Aucun fichier fourni (champ « file »)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        name = (upload.name or "").lower()
        if not name.endswith(_ALLOWED_UPLOAD_SUFFIXES):
            return Response(
                {"detail": "Format attendu : fichier Excel (.xlsx)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        IMPORT_DIR.mkdir(parents=True, exist_ok=True)
        upload_id = _uuid_module.uuid4().hex
        upload_path = IMPORT_DIR / f"upload_{upload_id}.xlsx"
        with upload_path.open("wb") as fh:
            for chunk in upload.chunks():
                fh.write(chunk)

        result = import_po_task.delay(str(upload_path))
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["get"], url_path=r"imports/(?P<task_id>[\w-]+)/report")
    def import_report(self, request, task_id=None):
        """Download the Excel rejection report produced by `import_po_task`."""
        file_path = IMPORT_DIR / f"{task_id}_report.xlsx"
        if not file_path.is_file():
            raise Http404("Rapport introuvable ou expiré.")
        return FileResponse(
            file_path.open("rb"),
            as_attachment=True,
            filename="import_po_rapport.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
