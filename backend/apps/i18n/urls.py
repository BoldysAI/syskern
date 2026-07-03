"""URL routing for the translation endpoint (CDC §10.4.2)."""

from __future__ import annotations

from django.urls import path

from .views import TranslateView

urlpatterns = [
    path("translate", TranslateView.as_view(), name="translate"),
]
