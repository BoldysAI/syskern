"""Root URL configuration — every app mounts its router under `/api/`."""

from __future__ import annotations

from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.health import health_view

api_patterns = [
    # Auth + user management.
    path("", include("apps.core.urls")),
    path("", include("apps.accounts.urls")),
    # PIM (Brique 1).
    path("", include("apps.products.urls")),
    path("", include("apps.attributes.urls")),
    # Clients.
    path("", include("apps.clients.urls")),
    # Market reference data + incoterms / FX / copper.
    path("", include("apps.market.urls")),
    # Pricing engine + simulations.
    path("", include("apps.simulations.urls")),
    # Offers + dashboard.
    path("", include("apps.offers.urls")),
    # Document library (attachments for project offers).
    path("", include("apps.documents.urls")),
    # Translation service (DeepL) + cache.
    path("", include("apps.i18n.urls")),
    # Odoo sync (Brique 2).
    path("", include("apps.odoo_sync.urls")),
    # Initial data migration quarantine.
    path("", include("apps.data_migration.urls")),
]


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health", health_view, name="health"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    path("api/", include(api_patterns)),
]
