"""Gamma API client — generates pricing catalogs and project quotes.

Stub for MVP1: the HTTP plumbing is sketched so the rest of the code can
call `GammaClient.generate_quote(...)`, but the actual request body
mapping is left to a follow-up task once Gamma's API contract is pinned
down for the project (CDC §7.7).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from django.conf import settings


class GammaError(RuntimeError):
    pass


@dataclass
class GammaResponse:
    document_id: str
    download_url: str
    raw: dict[str, Any]


class GammaClient:
    BASE_URL = "https://api.gamma.app"

    def __init__(self, api_key: str | None = None, timeout: float = 30.0):
        self.api_key = api_key or settings.GAMMA.get("API_KEY", "")
        self.timeout = timeout

    def _client(self) -> httpx.Client:
        if not self.api_key:
            raise GammaError("GAMMA_API_KEY is not configured.")
        return httpx.Client(
            base_url=self.BASE_URL,
            timeout=self.timeout,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

    def generate_quote(
        self,
        *,
        template_id: str,
        language: str,
        project_info: dict,
        line_items: list[dict],
        ai_instructions: str = "",
    ) -> GammaResponse:
        """Generate a project quote document.

        Stub — once Gamma's API surface is final, populate the body
        accordingly.  For now this raises explicitly to make the missing
        integration visible during testing.
        """
        raise NotImplementedError(
            "Gamma integration is a stub in MVP1 — implement once the API contract is final."
        )

    def generate_tariff_catalog(
        self,
        *,
        template_id: str,
        language: str,
        line_items: list[dict],
        ai_instructions: str = "",
    ) -> GammaResponse:
        raise NotImplementedError("Gamma tariff catalog generation is a stub in MVP1.")
