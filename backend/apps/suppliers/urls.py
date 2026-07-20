from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "suppliers"

router = DefaultRouter()
router.register(
    r"suppliers/import-mappings",
    views.SupplierImportMappingViewSet,
    basename="supplier-import-mapping",
)
router.register(r"suppliers", views.SupplierViewSet, basename="supplier")

urlpatterns = [
    path("", include(router.urls)),
]
