"""Translation cache (CDC §10.4.3, deviation documented in decisions.md).

The CDC carries the product-content cache in the JSONB description fields; this
dedicated table backs the generic ``POST /api/translate`` endpoint so *any*
content (attribute labels, ad-hoc strings) is cached and repeat calls avoid
burning DeepL quota. Keyed by a hash of ``source_text | source_lang |
target_lang`` with a configurable TTL (default 90 days).
"""

from __future__ import annotations

import hashlib

from django.db import models

from apps.core.models import BaseModel, Language


def make_cache_key(source_text: str, source_lang: str, target_lang: str) -> str:
    """Deterministic sha256 hash of the (text, source, target) triple."""
    raw = f"{source_lang.lower()}|{target_lang.lower()}|{source_text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class TranslationCache(BaseModel):
    source_text_hash = models.CharField(max_length=64, unique=True)
    source_lang = models.CharField(max_length=2, choices=Language.choices)
    target_lang = models.CharField(max_length=2, choices=Language.choices)
    source_text = models.TextField()
    translated_text = models.TextField()
    expires_at = models.DateTimeField()
    hit_count = models.IntegerField(default=0)

    class Meta:
        db_table = "translation_cache"
        indexes = [
            models.Index(fields=["expires_at"], name="idx_transcache_expires"),
        ]

    def __str__(self) -> str:
        return f"{self.source_lang}→{self.target_lang} {self.source_text_hash[:12]}"
