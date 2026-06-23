"""Gamma Generate API client (CDC §7.3 / §7.7).

Contract (https://public-api.gamma.app, verified 2026-06):
  - Auth header: ``X-API-KEY: <key>`` (NOT Bearer).
  - ``POST /v1.0/generations`` → ``{"generationId": "...", "warnings": "..."}``.
  - ``GET  /v1.0/generations/{id}`` → ``{"status": "pending|completed|failed",
    "gammaUrl": "...", "exportUrl": "...", "error": {...}, "credits": {...}}``.
  - Generation is async (1-3 min); poll every ~5s. Billable (Pro+ plan).

There is no native HTML-export endpoint; ``exportAs`` supports pdf/pptx/png. We
request a PDF (``exportUrl``) and, for the "cached snapshot" (CDC §7.3), fetch
the public ``gammaUrl`` HTML best-effort (see :meth:`fetch_public_html`).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from django.conf import settings

logger = logging.getLogger("apps.offers.gamma")


class GammaError(RuntimeError):
    """Non-retryable Gamma failure (4xx, bad payload, or generation failed)."""


@dataclass
class GammaGeneration:
    generation_id: str
    status: str  # "pending" | "completed" | "failed"
    gamma_url: str = ""
    export_url: str = ""
    error: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def completed(self) -> bool:
        return self.status == "completed"


class GammaClient:
    BASE_URL = "https://public-api.gamma.app"
    API_PREFIX = "/v1.0"

    def __init__(
        self,
        api_key: str | None = None,
        *,
        timeout: float = 60.0,
        max_retries: int = 3,
    ) -> None:
        self.api_key = api_key or settings.GAMMA.get("API_KEY", "")
        self.timeout = timeout
        self.max_retries = max_retries

    # ── HTTP plumbing ───────────────────────────────────────────────────────

    def _client(self) -> httpx.Client:
        if not self.api_key:
            raise GammaError("GAMMA_API_KEY is not configured.")
        return httpx.Client(
            base_url=self.BASE_URL,
            timeout=self.timeout,
            headers={"X-API-KEY": self.api_key, "Content-Type": "application/json"},
        )

    def _request(self, method: str, path: str, *, json: dict | None = None) -> dict:
        """Retry on 5xx / network errors (exp backoff); never retry 4xx."""
        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with self._client() as client:
                    resp = client.request(method, f"{self.API_PREFIX}{path}", json=json)
            except httpx.RequestError as exc:
                last_exc = exc
                logger.warning("Gamma %s %s network error (try %d): %s", method, path, attempt, exc)
            else:
                if resp.status_code < 400:
                    return resp.json()
                if 400 <= resp.status_code < 500:
                    raise GammaError(f"Gamma {resp.status_code}: {resp.text[:300]}")
                last_exc = GammaError(f"Gamma {resp.status_code}: {resp.text[:300]}")
                logger.warning("Gamma %s %s 5xx (try %d)", method, path, attempt)
            if attempt < self.max_retries:
                time.sleep(2**attempt)  # 2s, 4s, 8s
        raise GammaError(f"Gamma request failed after {self.max_retries} tries: {last_exc}")

    # ── Public API ──────────────────────────────────────────────────────────

    def create_generation(self, payload: dict) -> str:
        """Create a generation; returns the ``generationId``."""
        data = self._request("POST", "/generations", json=payload)
        gen_id = data.get("generationId")
        if not gen_id:
            raise GammaError(f"Gamma create returned no generationId: {data}")
        if data.get("warnings"):
            logger.info("Gamma create warnings: %s", data["warnings"])
        return gen_id

    def get_generation(self, generation_id: str) -> GammaGeneration:
        data = self._request("GET", f"/generations/{generation_id}")
        err = data.get("error") or {}
        return GammaGeneration(
            generation_id=generation_id,
            status=data.get("status", "pending"),
            gamma_url=data.get("gammaUrl", "") or "",
            export_url=data.get("exportUrl", "") or "",
            error=(err.get("message", "") if isinstance(err, dict) else str(err)),
            raw=data,
        )

    def generate_and_wait(
        self,
        payload: dict,
        *,
        poll_interval: float = 5.0,
        max_wait: float = 300.0,
    ) -> GammaGeneration:
        """Create a generation and poll until completed/failed (CDC §7.8).

        Raises :class:`GammaError` on a failed generation or timeout.
        """
        generation_id = self.create_generation(payload)
        logger.info("Gamma generation %s started", generation_id)
        waited = 0.0
        while waited < max_wait:
            result = self.get_generation(generation_id)
            if result.status == "completed":
                logger.info("Gamma generation %s completed: %s", generation_id, result.gamma_url)
                return result
            if result.status == "failed":
                raise GammaError(f"Gamma generation failed: {result.error or 'unknown error'}")
            time.sleep(poll_interval)
            waited += poll_interval
        raise GammaError(f"Gamma generation {generation_id} timed out after {max_wait}s")

    def fetch_public_html(self, gamma_url: str) -> str | None:
        """Best-effort fetch of the public Gamma page HTML for caching.

        Returns None on any failure — the snapshot is a convenience, not a
        hard requirement (no native HTML export exists, CDC §7.3 note).
        """
        if not gamma_url:
            return None
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                resp = client.get(gamma_url)
            return resp.text if resp.status_code == 200 else None
        except httpx.RequestError as exc:
            logger.info("Gamma HTML snapshot fetch failed for %s: %s", gamma_url, exc)
            return None
