from __future__ import annotations

from django.db.models import Count
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.products.models import Product
from apps.products.services.sku_parser import parse_sku

from .filters import MigrationUnmatchedFilter
from .models import MigrationUnmatched, ResolutionAction
from .serializers import MigrationUnmatchedSerializer, ResolveSerializer


class MigrationUnmatchedViewSet(viewsets.ModelViewSet):
    """Quarantine API (CDC §8.7).  Read + resolve.

    Resolution now **executes** the chosen arbitrage instead of just logging a
    note: ``create`` builds the product from the row, ``delete``/``ignore``
    flag the row resolved (kept for audit — no hard-delete, §8.7)."""

    queryset = MigrationUnmatched.objects.all()
    serializer_class = MigrationUnmatchedSerializer
    filterset_class = MigrationUnmatchedFilter
    ordering_fields = ("created_at", "source_file", "source_row_number", "reason", "resolved_at")
    ordering = ("source_file", "source_row_number")
    http_method_names = ["get", "patch", "post"]  # PATCH partial edits, POST for the action

    @action(detail=True, methods=["post", "patch"])
    def resolve(self, request, pk=None):
        """Resolve a row with an executed action (ignore / create / delete)."""
        row = self.get_object()
        ser = ResolveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        action_type = data["action"]
        resolved_by = data.get("resolved_by") or getattr(request.user, "email", "") or "système"
        notes = data.get("resolution_notes", "")

        if action_type == ResolutionAction.CREATE:
            product, created = self._create_or_get_product_from_row(data["product"])
            note_line = (
                f"Produit créé : {product.sku_code}"
                if created
                else f"Produit déjà présent au catalogue : {product.sku_code}"
            )
            notes = f"{notes}\n{note_line}".strip() if notes else note_line

        row.resolution_action = action_type
        row.resolved_at = timezone.now()
        row.resolved_by = resolved_by
        row.resolution_notes = notes
        row.save(
            update_fields=[
                "resolution_action",
                "resolved_at",
                "resolved_by",
                "resolution_notes",
                "updated_at",
            ]
        )
        return Response(MigrationUnmatchedSerializer(row).data)

    @staticmethod
    def _create_or_get_product_from_row(product_data: dict) -> tuple[Product, bool]:
        """Create the product from a quarantine row, or return it if it exists.

        Idempotent: when the SKU already matches a catalog product (e.g. it was
        created by the initial Odoo sync or the create-missing bootstrap), we do
        **not** fail — the row is resolved against the existing product. Returns
        ``(product, created)``. Derives ``factory_code`` / ``parent_reference``
        from the SKU (shared parser) so a newly-created product matches the wizard.
        """
        sku = product_data["sku_code"].upper().strip()
        existing = Product.objects.filter(sku_code=sku).first()
        if existing is not None:
            return existing, False
        parsed = parse_sku(sku)
        description = product_data.get("description_marketing_fr") or ""
        product = Product.objects.create(
            sku_code=sku,
            name=product_data.get("name") or sku,
            description_marketing={"fr": description} if description else {},
            factory_code=parsed.get("factory_code") or "",
            parent_reference=parsed.get("parent_reference") or "",
        )
        return product, True

    @action(detail=False, methods=["get"])
    def facets(self, request):
        """Counts powering the quarantine filter UI: totals, reasons, sources."""
        qs = MigrationUnmatched.objects.all()
        total = qs.count()
        resolved = qs.filter(resolved_at__isnull=False).count()
        by_reason = {
            r["reason"]: r["count"]
            for r in qs.values("reason").annotate(count=Count("id")).order_by("reason")
        }
        source_files = list(
            qs.values_list("source_file", flat=True).distinct().order_by("source_file")
        )
        return Response(
            {
                "total": total,
                "resolved": resolved,
                "unresolved": total - resolved,
                "by_reason": by_reason,
                "source_files": source_files,
            }
        )
