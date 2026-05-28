from __future__ import annotations

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.views import APIView

from .adapters.factory import get_odoo_adapter
from .models import SyncLog, SyncStatus, SyncType
from .serializers import SyncLogSerializer, TriggerSyncSerializer
from .tasks import sync_task


class SyncLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = SyncLog.objects.all().order_by("-started_at")
    serializer_class = SyncLogSerializer
    filterset_fields = ("sync_type", "scope", "status", "odoo_api_version")


class TriggerSyncView(APIView):
    """`POST /api/odoo/sync/trigger` — manual sync (CDC §5.4.2).

    Dispatches the sync to a Celery worker and returns 202 with a `task_id`
    the client can poll via `GET /api/tasks/{task_id}/`.
    """

    def post(self, request):
        ser = TriggerSyncSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        result = sync_task.delay(
            scope=str(ser.validated_data["scope"]),
            sync_type=str(SyncType.MANUAL),
            triggered_by="manual",
            api_version=ser.validated_data.get("api_version"),
        )
        return Response(
            {"task_id": result.id, "status": "PENDING"},
            status=status.HTTP_202_ACCEPTED,
        )


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
