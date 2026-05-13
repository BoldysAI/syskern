from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "odoo_sync"

router = DefaultRouter()
router.register(r"odoo/sync/logs", views.SyncLogViewSet, basename="odoo-sync-log")

urlpatterns = [
    path("", include(router.urls)),
    path("odoo/sync/trigger", views.TriggerSyncView.as_view(), name="trigger"),
    path("odoo/sync/status", views.SyncStatusView.as_view(), name="status"),
    path("odoo/health", views.odoo_health, name="health"),
]
