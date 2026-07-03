"""Serializers for the translation endpoint (CDC §10.4.2)."""

from __future__ import annotations

from rest_framework import serializers

from apps.core.models import Language
from apps.offers.services.translation import MAX_TEXT_LENGTH

_LANG_CHOICES = [lang.value for lang in Language]
# Guard the synchronous endpoint against oversized batches (each item is a
# separate DeepL segment — heavy work belongs to the bulk Celery job instead).
MAX_BATCH_SIZE = 50


class TranslateRequestSerializer(serializers.Serializer):
    """Accepts either ``text`` (single) or ``texts`` (batch)."""

    text = serializers.CharField(required=False, allow_blank=True, max_length=MAX_TEXT_LENGTH)
    texts = serializers.ListField(
        child=serializers.CharField(allow_blank=True, max_length=MAX_TEXT_LENGTH),
        required=False,
        max_length=MAX_BATCH_SIZE,
    )
    source_lang = serializers.ChoiceField(choices=_LANG_CHOICES, default="fr")
    target_lang = serializers.ChoiceField(choices=_LANG_CHOICES)

    def validate(self, attrs: dict) -> dict:
        has_text = "text" in attrs
        has_texts = "texts" in attrs
        if has_text == has_texts:
            raise serializers.ValidationError(
                "Fournir soit « text » (chaîne unique) soit « texts » (liste)."
            )
        if attrs.get("source_lang") == attrs["target_lang"]:
            raise serializers.ValidationError(
                "La langue source et la langue cible doivent être différentes."
            )
        return attrs
