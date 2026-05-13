from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "clients"

router = DefaultRouter()
router.register(r"clients", views.ClientViewSet, basename="client")

urlpatterns = [path("", include(router.urls))]
