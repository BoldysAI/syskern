from __future__ import annotations

from django.contrib import admin

from .models import TranslationCache


@admin.register(TranslationCache)
class TranslationCacheAdmin(admin.ModelAdmin):
    list_display = ("source_lang", "target_lang", "hit_count", "expires_at", "created_at")
    list_filter = ("source_lang", "target_lang")
    search_fields = ("source_text", "translated_text", "source_text_hash")
    readonly_fields = ("source_text_hash", "created_at", "updated_at")
