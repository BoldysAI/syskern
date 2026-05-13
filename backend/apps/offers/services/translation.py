"""DeepL translation client (CDC §10.4).

Stub for MVP1: the HTTP plumbing is sketched but the body / response
handling needs to be wired against DeepL's API documentation.  The cache
behaviour relies on storing the translated string in `Product.description_*`
JSONB fields, so there's no Redis layer here.
"""
from __future__ import annotations

import httpx
from django.conf import settings


class TranslationError(RuntimeError):
    pass


class DeepLClient:
    BASE_URL = "https://api.deepl.com/v2"

    def __init__(self, api_key: str | None = None, timeout: float = 10.0):
        self.api_key = api_key or settings.DEEPL_API_KEY
        self.timeout = timeout

    def translate(
        self,
        *,
        source_text: str,
        source_lang: str,
        target_lang: str,
    ) -> str:
        """Translate `source_text` from `source_lang` to `target_lang`.

        Returns the translated string.  Empty inputs short-circuit to empty
        outputs to avoid quota waste.
        """
        if not source_text or not source_text.strip():
            return ""
        if not self.api_key:
            raise TranslationError("DEEPL_API_KEY is not configured.")

        with httpx.Client(base_url=self.BASE_URL, timeout=self.timeout) as client:
            response = client.post(
                "/translate",
                data={
                    "auth_key": self.api_key,
                    "text": source_text,
                    "source_lang": source_lang.upper(),
                    "target_lang": target_lang.upper(),
                    "formality": "more",
                    "preserve_formatting": "1",
                },
            )
            if response.status_code == 456:
                raise TranslationError("DeepL quota exceeded.")
            if response.status_code != 200:
                raise TranslationError(
                    f"DeepL returned {response.status_code}: {response.text[:200]}"
                )
            payload = response.json()
            return payload["translations"][0]["text"]
