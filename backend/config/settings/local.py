"""Local development settings."""

from __future__ import annotations

from .base import *  # noqa: F401,F403
from .base import INSTALLED_APPS

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Permissive CORS for the Next.js dev server.
CORS_ALLOW_ALL_ORIGINS = True

# Disable static manifest in dev so collectstatic isn't required.
STATICFILES_STORAGE = "django.contrib.staticfiles.storage.StaticFilesStorage"

# Open APIs by default in dev to keep early integration friction-free.
# Production tightens this in `config.settings.production`.
REST_FRAMEWORK_DEFAULT_PERMISSIONS = ("rest_framework.permissions.AllowAny",)
from .base import REST_FRAMEWORK  # noqa: E402

REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] = REST_FRAMEWORK_DEFAULT_PERMISSIONS

INTERNAL_IPS = ["127.0.0.1"]

# Optional dev-only apps.
try:
    import django_extensions  # noqa: F401

    INSTALLED_APPS = INSTALLED_APPS + ["django_extensions"]
except ImportError:
    pass
