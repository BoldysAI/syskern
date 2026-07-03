from __future__ import annotations

from django.apps import AppConfig


class I18nConfig(AppConfig):
    name = "apps.i18n"
    label = "app_i18n"
    verbose_name = "Translation / i18n"
    default_auto_field = "django.db.models.BigAutoField"
