"""DRF views for the Fournisseurs module (Épic FEEDBACK 1 — écart CDC §11.3).

Supplier is now a first-class entity: full CRUD, management of the SKU links
from the supplier side, and a batch Excel PO import (async Celery). Deleting a
supplier is a soft-delete and is refused (409) while SKUs are still linked.
"""

from __future__ import annotations

import uuid as _uuid_module
from pathlib import Path

from django.db.models import Count
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.products.models import Product, ProductSupplier

from .filters import SupplierFilter
from .models import Supplier, SupplierImportMapping
from .serializers import (
    SupplierBulkLinkSerializer,
    SupplierBulkPoSerializer,
    SupplierDetailSerializer,
    SupplierImportInspectSerializer,
    SupplierImportMappingSerializer,
    SupplierImportRunSerializer,
    SupplierListSerializer,
    SupplierPriceHistorySerializer,
    SupplierProductLinkSerializer,
    SupplierSkuLinkInputSerializer,
    SupplierWriteSerializer,
)
from .services import apply_bulk_po, bulk_link_skus, preview_bulk_po
from .services_import import read_excel_headers, validate_column_map
from .tasks import IMPORT_DIR, import_po_apply_task, import_po_preview_task

_ALLOWED_UPLOAD_SUFFIXES = (".xlsx", ".xlsm")


def _parse_header_row(raw: object) -> int:
    """Coerce a request-supplied header row (1-based) to a safe positive int."""
    try:
        value = int(str(raw))
    except (TypeError, ValueError):
        return 1
    return value if value >= 1 else 1


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
                ).select_related("product")
            )
        else:
            links = list(
                ProductSupplier.objects.filter(
                    id__in=data["link_ids"], supplier=supplier
                ).select_related("product")
            )
        updated, skipped = apply_bulk_po(links, mode=data["mode"], value=data["value"])
        return Response({"updated": updated, "skipped": skipped})

    @action(detail=True, methods=["post"], url_path="skus/bulk-po/preview")
    def bulk_po_preview(self, request, pk=None):
        """Dry-run for the batch PO wizard — returns per-SKU old/new prices."""
        supplier = self.get_object()
        ser = SupplierBulkPoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        not_linked = 0
        if data.get("product_ids"):
            product_ids = data["product_ids"]
            links = list(
                ProductSupplier.objects.filter(
                    supplier=supplier, product_id__in=product_ids
                ).select_related("product")
            )
            not_linked = len(product_ids) - len(links)
        else:
            links = list(
                ProductSupplier.objects.filter(
                    id__in=data["link_ids"], supplier=supplier
                ).select_related("product")
            )
        payload = preview_bulk_po(
            links, mode=data["mode"], value=data["value"], not_linked=not_linked
        )
        return Response(payload)

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

    # ── PO import wizard (analyze → preview → apply, async — AGENTS §4) ────────

    @staticmethod
    def _upload_path_for(token: str) -> Path | None:
        """Resolve (and guard) the on-disk path of an uploaded file by token.

        Token is a hex uuid produced by `import_analyze`; reject anything else
        to avoid path traversal.
        """
        try:
            _uuid_module.UUID(token)
        except (ValueError, AttributeError):
            return None
        return IMPORT_DIR / f"upload_{token}.xlsx"

    @action(
        detail=False,
        methods=["post"],
        url_path="import-po/analyze",
        parser_classes=[MultiPartParser, FormParser],
    )
    def import_analyze(self, request):
        """Upload an Excel and return its headers + a bounded sample of rows.

        The mapping step consumes `headers` / `column_count` (every column is
        addressable by index, even unnamed ones); `upload_token` is passed back
        to the inspect / preview / apply endpoints (the file stays on disk until
        applied). `header_row` (1-based, default 1) selects the header line.
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

        header_row = _parse_header_row(request.data.get("header_row"))

        IMPORT_DIR.mkdir(parents=True, exist_ok=True)
        token = _uuid_module.uuid4().hex
        upload_path = IMPORT_DIR / f"upload_{token}.xlsx"
        with upload_path.open("wb") as fh:
            for chunk in upload.chunks():
                fh.write(chunk)

        try:
            headers, sample_rows, column_count = read_excel_headers(
                upload_path, header_row=header_row
            )
        except ValueError as exc:
            upload_path.unlink(missing_ok=True)
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "upload_token": token,
                "header_row": header_row,
                "headers": headers,
                "sample_rows": sample_rows,
                "column_count": column_count,
            }
        )

    @action(detail=False, methods=["post"], url_path="import-po/inspect")
    def import_inspect(self, request):
        """Re-read an already-uploaded file with a different header row.

        Lets the wizard change which row holds the headers without re-uploading.
        """
        ser = SupplierImportInspectSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        path = self._upload_path_for(data["upload_token"])
        if path is None or not path.is_file():
            return Response(
                {"detail": "Fichier d'import introuvable ou expiré. Relancez l'upload."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        header_row = data.get("header_row", 1)
        try:
            headers, sample_rows, column_count = read_excel_headers(path, header_row=header_row)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "header_row": header_row,
                "headers": headers,
                "sample_rows": sample_rows,
                "column_count": column_count,
            }
        )

    @action(detail=False, methods=["post"], url_path="import-po/preview")
    def import_preview(self, request):
        """Dispatch the dry-run resolution (synthesis). Returns 202 + task_id."""
        return self._dispatch_import(request, import_po_preview_task)

    @action(detail=False, methods=["post"], url_path="import-po/apply")
    def import_apply(self, request):
        """Dispatch the apply step. Returns 202 + task_id."""
        return self._dispatch_import(request, import_po_apply_task)

    def _dispatch_import(self, request, task):
        ser = SupplierImportRunSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        path = self._upload_path_for(data["upload_token"])
        if path is None or not path.is_file():
            return Response(
                {"detail": "Fichier d'import introuvable ou expiré. Relancez l'upload."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        column_map = data["column_map"]  # already normalised to int indices
        header_row = data.get("header_row", 1)
        try:
            _, _, column_count = read_excel_headers(path, header_row=header_row)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        errors = validate_column_map(column_map, column_count)
        if errors:
            return Response({"detail": " ".join(errors)}, status=status.HTTP_400_BAD_REQUEST)

        supplier_id = data.get("supplier_id")
        result = task.delay(
            str(path), column_map, str(supplier_id) if supplier_id else None, header_row
        )
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["get"], url_path=r"imports/(?P<task_id>[\w-]+)/report")
    def import_report(self, request, task_id=None):
        """Download the Excel rejection report produced by the apply task."""
        file_path = IMPORT_DIR / f"{task_id}_report.xlsx"
        if not file_path.is_file():
            raise Http404("Rapport introuvable ou expiré.")
        return FileResponse(
            file_path.open("rb"),
            as_attachment=True,
            filename="import_po_rapport.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )


class SupplierImportMappingViewSet(viewsets.ModelViewSet):
    """CRUD over reusable PO-import column-mapping templates.

    Mounted at `/api/suppliers/import-mappings/`. Optional `?supplier=` filter
    (by UUID) so the wizard can surface the mappings scoped to a supplier while
    still allowing global (supplier-less) templates.
    """

    serializer_class = SupplierImportMappingSerializer
    queryset = SupplierImportMapping.objects.select_related("supplier").all()
    ordering_fields = ("name", "updated_at")
    ordering = ("name",)

    def get_queryset(self):
        qs = super().get_queryset()
        supplier = self.request.query_params.get("supplier")
        if supplier:
            qs = qs.filter(supplier_id=supplier)
        return qs
