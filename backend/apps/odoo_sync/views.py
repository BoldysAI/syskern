from __future__ import annotations

from rest_framework import mixins, viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.views import APIView

from .adapters.factory import get_odoo_adapter
from .models import SyncLog, SyncStatus, SyncType
from .serializers import SyncLogSerializer, TriggerSyncSerializer
from .services.runner import sync


class SyncLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = SyncLog.objects.all().order_by("-started_at")
    serializer_class = SyncLogSerializer
    filterset_fields = ("sync_type", "scope", "status", "odoo_api_version")


class TriggerSyncView(APIView):
    """`POST /api/odoo/sync/trigger` — manual sync (CDC §5.4.2)."""

    def post(self, request):
        ser = TriggerSyncSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        log = sync(
            scope=ser.validated_data["scope"],
            sync_type=SyncType.MANUAL,
            triggered_by="manual",
        )
        return Response(SyncLogSerializer(log).data)


class SyncStatusView(APIView):
    def get(self, request):
        last = SyncLog.objects.order_by("-started_at").first()
        running = SyncLog.objects.filter(status=SyncStatus.RUNNING).order_by("-started_at").first()
        return Response(
            {
                "last": SyncLogSerializer(last).data if last else None,
                "running": SyncLogSerializer(running).data if running else None,
            }
        )


@api_view(["GET"])
def odoo_health(_request):
    adapter = get_odoo_adapter()
    return Response({"ok": adapter.health_check()})
