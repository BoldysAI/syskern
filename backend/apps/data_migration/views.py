from __future__ import annotations

from django.db.models import Count
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .filters import MigrationUnmatchedFilter
from .models import MigrationUnmatched
from .serializers import MigrationUnmatchedSerializer, ResolveSerializer


class MigrationUnmatchedViewSet(viewsets.ModelViewSet):
    """Quarantine API (CDC §8.7).  Read mostly; resolution is the only
    mutation users perform from the UI.  No auto-reinjection action exists by
    design — Olivier creates the product manually then marks the row resolved."""

    queryset = MigrationUnmatched.objects.all()
    serializer_class = MigrationUnmatchedSerializer
    filterset_class = MigrationUnmatchedFilter
    ordering_fields = ("created_at", "source_file", "source_row_number", "reason", "resolved_at")
    ordering = ("source_file", "source_row_number")
    http_method_names = ["get", "patch", "post"]  # PATCH partial edits, POST for the action

    @action(detail=True, methods=["post", "patch"])
    def resolve(self, request, pk=None):
        """Mark a quarantine row resolved with a resolver email + free note."""
        row = self.get_object()
        ser = ResolveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        row.resolved_at = timezone.now()
        row.resolved_by = ser.validated_data["resolved_by"]
        row.resolution_notes = ser.validated_data.get("resolution_notes", "")
        row.save(update_fields=["resolved_at", "resolved_by", "resolution_notes", "updated_at"])
        return Response(MigrationUnmatchedSerializer(row).data)

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
