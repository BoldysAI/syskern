from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "attributes"

router = DefaultRouter()
router.register(r"attributes", views.AttributeRegistryViewSet, basename="attribute")
router.register(
    r"attribute-values",
    views.ProductAttributeValueViewSet,
    basename="attribute-value",
)

urlpatterns = [path("", include(router.urls))]
