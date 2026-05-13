from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "market"

router = DefaultRouter()
router.register(r"transport-modes", views.TransportModeViewSet, basename="transport-mode")
router.register(r"market-parameters", views.MarketParameterViewSet, basename="market-parameter")

urlpatterns = [
    path("", include(router.urls)),
    path("incoterms", views.list_incoterms, name="incoterms"),
]
