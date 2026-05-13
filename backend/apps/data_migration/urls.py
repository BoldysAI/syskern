from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "data_migration"

router = DefaultRouter()
router.register(
    r"migration/unmatched",
    views.MigrationUnmatchedViewSet,
    basename="migration-unmatched",
)

urlpatterns = [path("", include(router.urls))]
