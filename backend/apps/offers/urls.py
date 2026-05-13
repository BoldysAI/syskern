from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "offers"

router = DefaultRouter()
router.register(r"offers", views.OfferViewSet, basename="offer")
router.register(r"offer-lines", views.OfferLineViewSet, basename="offer-line")

urlpatterns = [
    path("", include(router.urls)),
    path("offers/dashboard", views.OfferDashboardView.as_view(), name="dashboard"),
    path("offers/expiring-soon", views.OffersExpiringSoonView.as_view(), name="expiring-soon"),
]
