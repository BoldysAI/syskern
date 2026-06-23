"""OpenAI client — used to generate contextual copy for project offers
(executive summary, requirements reformulation, alternatives, etc.).

Stub for MVP1: ships a `generate_copy(prompt) -> str` interface that
raises if no API key is configured.  The actual model + system prompt
tuning is left to a follow-up once the offer-generation flow is wired.
"""

from __future__ import annotations

import json

import httpx
from django.conf import settings


class OpenAIError(RuntimeError):
    pass


class OpenAIClient:
    BASE_URL = "https://api.openai.com/v1"
    DEFAULT_MODEL = "gpt-4o-mini"

    def __init__(self, api_key: str | None = None, model: str | None = None, timeout: float = 60.0):
        self.api_key = api_key or settings.OPENAI_API_KEY
        self.model = model or getattr(settings, "OPENAI_MODEL", "") or self.DEFAULT_MODEL
        self.timeout = timeout

    def generate_copy(self, *, system: str, user: str, temperature: float = 0.3) -> str:
        if not self.api_key:
            raise OpenAIError("OPENAI_API_KEY is not configured.")
        with httpx.Client(
            base_url=self.BASE_URL,
            timeout=self.timeout,
            headers={"Authorization": f"Bearer {self.api_key}"},
        ) as client:
            response = client.post(
                "/chat/completions",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": temperature,
                },
            )
            if response.status_code != 200:
                raise OpenAIError(f"OpenAI returned {response.status_code}: {response.text[:200]}")
            payload = response.json()
            return payload["choices"][0]["message"]["content"].strip()

    def generate_json(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.7,
        max_tokens: int = 800,
    ) -> dict:
        """Chat completion forced to a JSON object (response_format json_object).

        Returns the parsed dict. Raises OpenAIError on HTTP failure or unparsable
        JSON so callers can fall back gracefully.
        """
        if not self.api_key:
            raise OpenAIError("OPENAI_API_KEY is not configured.")
        with httpx.Client(
            base_url=self.BASE_URL,
            timeout=self.timeout,
            headers={"Authorization": f"Bearer {self.api_key}"},
        ) as client:
            response = client.post(
                "/chat/completions",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "response_format": {"type": "json_object"},
                },
            )
            if response.status_code != 200:
                raise OpenAIError(f"OpenAI returned {response.status_code}: {response.text[:200]}")
            content = response.json()["choices"][0]["message"]["content"]
            try:
                return json.loads(content)
            except (json.JSONDecodeError, TypeError) as exc:
                raise OpenAIError(f"OpenAI returned non-JSON content: {exc}") from exc
