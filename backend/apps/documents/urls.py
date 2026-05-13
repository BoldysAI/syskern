from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "documents"

router = DefaultRouter()
router.register(r"document-library", views.DocumentLibraryViewSet, basename="document")

urlpatterns = [path("", include(router.urls))]
