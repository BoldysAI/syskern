"""Cached translation service (CDC §10.4).

Wraps ``DeepLClient`` with a read-through cache backed by ``TranslationCache``.
Callers get ``(translated_text, from_cache)`` so the API can report whether a
result was served fresh or from cache.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.offers.services.translation import DeepLClient, apply_source_casing

from .models import TranslationCache, make_cache_key


def _ttl() -> timedelta:
    return timedelta(days=int(getattr(settings, "TRANSLATION_CACHE_TTL_DAYS", 90)))


def _read_cache(cache_key: str) -> str | None:
    """Return a live (non-expired) cached translation, bumping its hit counter."""
    now = timezone.now()
    updated = TranslationCache.objects.filter(
        source_text_hash=cache_key, expires_at__gt=now
    ).update(hit_count=F("hit_count") + 1)
    if not updated:
        return None
    entry = TranslationCache.objects.filter(source_text_hash=cache_key).first()
    return entry.translated_text if entry else None


def _write_cache(
    cache_key: str, source_text: str, source_lang: str, target_lang: str, translated: str
) -> None:
    """Upsert a cache entry, refreshing the TTL window."""
    TranslationCache.objects.update_or_create(
        source_text_hash=cache_key,
        defaults={
            "source_lang": source_lang.lower(),
            "target_lang": target_lang.lower(),
            "source_text": source_text,
            "translated_text": translated,
            "expires_at": timezone.now() + _ttl(),
        },
    )


def translate_cached(
    text: str, source_lang: str, target_lang: str, *, client: DeepLClient | None = None
) -> tuple[str, bool]:
    """Translate one string, using the cache first.

    Returns ``(translated_text, from_cache)``. Empty input short-circuits to
    ``("", False)`` without touching cache or DeepL.
    """
    if not text or not text.strip():
        return "", False

    cache_key = make_cache_key(text, source_lang, target_lang)
    cached = _read_cache(cache_key)
    if cached is not None:
        return apply_source_casing(text, cached), True

    client = client or DeepLClient()
    translated = client.translate(
        source_text=text, source_lang=source_lang, target_lang=target_lang
    )
    with transaction.atomic():
        _write_cache(cache_key, text, source_lang, target_lang, translated)
    return translated, False


def translate_many_cached(
    texts: list[str], source_lang: str, target_lang: str, *, client: DeepLClient | None = None
) -> list[tuple[str, bool]]:
    """Translate several strings, batching cache misses into one DeepL call.

    Returns a list of ``(translated_text, from_cache)`` the same length/order as
    ``texts``.
    """
    results: list[tuple[str, bool]] = [("", False)] * len(texts)
    miss_indices: list[int] = []
    miss_texts: list[str] = []

    for i, text in enumerate(texts):
        if not text or not text.strip():
            results[i] = ("", False)
            continue
        cached = _read_cache(make_cache_key(text, source_lang, target_lang))
        if cached is not None:
            results[i] = (apply_source_casing(text, cached), True)
        else:
            miss_indices.append(i)
            miss_texts.append(text)

    if miss_texts:
        client = client or DeepLClient()
        translated = client.translate_batch(miss_texts, source_lang, target_lang)
        for idx, src, value in zip(miss_indices, miss_texts, translated, strict=False):
            with transaction.atomic():
                _write_cache(
                    make_cache_key(src, source_lang, target_lang),
                    src,
                    source_lang,
                    target_lang,
                    value,
                )
            results[idx] = (value, False)

    return results
