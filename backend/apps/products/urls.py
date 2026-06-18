from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "products"

router = DefaultRouter()
router.register(r"products", views.ProductViewSet, basename="product")
router.register(r"product-suppliers", views.ProductSupplierViewSet, basename="product-supplier")

urlpatterns = [
    path("", include(router.urls)),
    path("hierarchy/distinct", views.DistinctHierarchyView.as_view(), name="hierarchy-distinct"),
    path("brands", views.DistinctBrandsView.as_view(), name="brands"),
    path("factory-codes", views.DistinctFactoryCodesView.as_view(), name="factory-codes"),
    path("supplier-names", views.DistinctSupplierNamesView.as_view(), name="supplier-names"),
    path(
        "supplier-names/template",
        views.SupplierNameTemplateView.as_view(),
        name="supplier-name-template",
    ),
]
