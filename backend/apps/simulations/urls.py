from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "simulations"

router = DefaultRouter()
router.register(r"simulations", views.SimulationViewSet, basename="simulation")
router.register(r"simulation-lines", views.SimulationLineViewSet, basename="simulation-line")
router.register(r"saved-comparisons", views.SavedComparisonViewSet, basename="saved-comparison")

urlpatterns = [
    path("", include(router.urls)),
    path(
        "simulations/compare",
        views.CompareSimulationsView.as_view({"post": "create"}),
        name="simulations-compare",
    ),
]
