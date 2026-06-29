"""Liveness / health endpoint (CDC §9.6).

Public and unauthenticated. Returns ``200`` when the process is up and the
database answers a trivial ``SELECT 1``; ``503`` (with the error detail)
otherwise. It deliberately does **not** probe external services (Odoo, Gamma,
DeepL): the goal is to tell whether the platform itself is up, not its
dependencies. Kept as a plain Django view (no DRF stack) so it stays fast
(< 100 ms) and authentication-free.
"""

from __future__ import annotations

from django.db import connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.cache import never_cache


@never_cache
def health_view(_request: HttpRequest) -> JsonResponse:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # noqa: BLE001 — any DB failure must surface as 503
        return JsonResponse(
            {"status": "error", "database": "error", "detail": str(exc)},
            status=503,
        )
    return JsonResponse({"status": "ok", "database": "ok"})
