"""Cache service behaviour (CDC §10.4.3): hit/miss, hit_count, expiry, purge."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.i18n import services
from apps.i18n.models import TranslationCache, make_cache_key
from apps.i18n.tasks import purge_translation_cache

pytestmark = pytest.mark.django_db


class _CountingClient:
    """DeepLClient stand-in counting calls and echoing a marker translation."""

    def __init__(self):
        self.translate_calls = 0
        self.batch_calls = 0

    def translate(self, *, source_text: str, source_lang: str, target_lang: str) -> str:
        self.translate_calls += 1
        return f"[{target_lang}]{source_text}"

    def translate_batch(self, texts, source_lang, target_lang):
        self.batch_calls += 1
        return [f"[{target_lang}]{t}" for t in texts]


def test_miss_then_hit_increments_hit_count():
    fake = _CountingClient()
    text, from_cache = services.translate_cached("Bonjour", "fr", "en", client=fake)
    assert (text, from_cache) == ("[en]Bonjour", False)
    assert fake.translate_calls == 1

    text2, from_cache2 = services.translate_cached("Bonjour", "fr", "en", client=fake)
    assert (text2, from_cache2) == ("[en]Bonjour", True)
    assert fake.translate_calls == 1  # DeepL not called again

    entry = TranslationCache.objects.get(source_text_hash=make_cache_key("Bonjour", "fr", "en"))
    assert entry.hit_count == 1


def test_empty_short_circuits():
    fake = _CountingClient()
    assert services.translate_cached("  ", "fr", "en", client=fake) == ("", False)
    assert fake.translate_calls == 0
    assert TranslationCache.objects.count() == 0


def test_expired_entry_is_refreshed():
    key = make_cache_key("Bonjour", "fr", "en")
    TranslationCache.objects.create(
        source_text_hash=key,
        source_lang="fr",
        target_lang="en",
        source_text="Bonjour",
        translated_text="STALE",
        expires_at=timezone.now() - timedelta(days=1),
    )
    fake = _CountingClient()
    text, from_cache = services.translate_cached("Bonjour", "fr", "en", client=fake)
    assert from_cache is False  # expired → not served from cache
    assert text == "[en]Bonjour"
    assert fake.translate_calls == 1


def test_translate_many_mixes_hits_and_misses():
    fake = _CountingClient()
    # Pre-warm "A".
    services.translate_cached("A", "fr", "en", client=fake)
    assert fake.translate_calls == 1

    results = services.translate_many_cached(["A", "B", ""], "fr", "en", client=fake)
    assert results[0] == ("[en]A", True)
    assert results[1] == ("[en]B", False)
    assert results[2] == ("", False)
    assert fake.batch_calls == 1  # only the miss ("B") went through the batch


def test_purge_deletes_expired_rows():
    now = timezone.now()
    TranslationCache.objects.create(
        source_text_hash="live",
        source_lang="fr",
        target_lang="en",
        source_text="x",
        translated_text="y",
        expires_at=now + timedelta(days=1),
    )
    TranslationCache.objects.create(
        source_text_hash="dead",
        source_lang="fr",
        target_lang="en",
        source_text="x",
        translated_text="y",
        expires_at=now - timedelta(days=1),
    )
    result = purge_translation_cache()
    assert result == {"deleted": 1}
    assert list(TranslationCache.objects.values_list("source_text_hash", flat=True)) == ["live"]
