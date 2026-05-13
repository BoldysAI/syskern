from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import MigrationUnmatched
from .serializers import MigrationUnmatchedSerializer, ResolveSerializer


class MigrationUnmatchedViewSet(viewsets.ModelViewSet):
    """Quarantine API (CDC §8.7).  Read mostly; resolution is the only
    mutation users perform from the UI."""

    queryset = MigrationUnmatched.objects.all()
    serializer_class = MigrationUnmatchedSerializer
    filterset_fields = ("source_file", "reason", "resolved_at")
    http_method_names = ["get", "patch", "post"]  # PATCH for partial edits, POST for the action

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        row = self.get_object()
        ser = ResolveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        row.resolved_at = timezone.now()
        row.resolved_by = ser.validated_data["resolved_by"]
        row.resolution_notes = ser.validated_data.get("resolution_notes", "")
        row.save(update_fields=["resolved_at", "resolved_by", "resolution_notes", "updated_at"])
        return Response(MigrationUnmatchedSerializer(row).data)
