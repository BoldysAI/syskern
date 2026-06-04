"""
Base Django settings shared by local and production environments.

Per-environment settings live in `config.settings.local` and
`config.settings.production`.  They import everything from this module and
override what they need.
"""
from __future__ import annotations

from pathlib import Path

import environ

# ─── Paths & env ──────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    ODOO_SYNC_ENABLED=(bool, False),
    ODOO_TIMEOUT_SECONDS=(int, 60),
    ODOO_SYNC_HOUR_UTC=(int, 3),
    ODOO_VERIFY_TLS=(bool, True),
    ODOO_V16_VERIFY_TLS=(bool, True),
    ODOO_V19_VERIFY_TLS=(bool, True),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="insecure-dev-secret")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["*"])

# ─── Applications ─────────────────────────────────────────────────────────────

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "django_celery_beat",
]

LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.attributes",
    "apps.products",
    "apps.clients",
    "apps.market",
    "apps.simulations",
    "apps.offers",
    "apps.documents",
    "apps.odoo_sync",
    "apps.data_migration",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ─── Middleware ───────────────────────────────────────────────────────────────

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# ─── Database ─────────────────────────────────────────────────────────────────

DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://syskern:syskern@localhost:5432/syskern"),
}
# Use psycopg 3
DATABASES["default"]["ENGINE"] = "django.db.backends.postgresql"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ─── Password validation ──────────────────────────────────────────────────────

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ─── i18n ─────────────────────────────────────────────────────────────────────

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Languages supported for product content (UI itself is FR-only in MVP1).
SUPPORTED_CONTENT_LANGUAGES = ["fr", "en", "es"]
DEFAULT_CONTENT_LANGUAGE = "fr"

# ─── Static / Media ───────────────────────────────────────────────────────────

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "mediafiles"

# ─── DRF ──────────────────────────────────────────────────────────────────────

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.core.authentication.CsrfExemptSessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Syskern Pricing API",
    "DESCRIPTION": "Backend API for the Syskern pricing platform (MVP1).",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# ─── Session ──────────────────────────────────────────────────────────────────

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 1 week

# ─── CORS ─────────────────────────────────────────────────────────────────────

CORS_ALLOWED_ORIGINS = env.list("DJANGO_CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True  # required for cross-origin session cookies

# Django checks Origin header against this list for CSRF validation.
# Must include the frontend origin (Next.js dev server or production domain).
CSRF_TRUSTED_ORIGINS = env.list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default=["http://localhost:3000"],
)

# ─── External services ───────────────────────────────────────────────────────

ODOO = {
    "API_VERSION": env("ODOO_API_VERSION", default="v19"),
    "BASE_URL": env("ODOO_BASE_URL", default=""),
    "DB_NAME": env("ODOO_DB_NAME", default=""),
    "API_USER": env("ODOO_API_USER", default=""),
    "API_PASSWORD": env("ODOO_API_PASSWORD", default=""),
    "TIMEOUT_SECONDS": env("ODOO_TIMEOUT_SECONDS"),
    "SYNC_HOUR_UTC": env("ODOO_SYNC_HOUR_UTC"),
    "SYNC_ENABLED": env("ODOO_SYNC_ENABLED"),
    # TLS verification — set to False only on dev/staging instances with mismatched certs.
    # Production v19 MUST present a valid cert.
    "VERIFY_TLS": env("ODOO_VERIFY_TLS"),
    # ─── v16 instance (investigation / dual-sync) ────────────────────────
    "V16_BASE_URL": env("ODOO_V16_BASE_URL", default=""),
    "V16_DB_NAME": env("ODOO_V16_DB_NAME", default=""),
    "V16_API_USER": env("ODOO_V16_API_USER", default=""),
    "V16_API_PASSWORD": env("ODOO_V16_API_PASSWORD", default=""),
    "V16_VERIFY_TLS": env("ODOO_V16_VERIFY_TLS"),
    # ─── v19 instance ─────────────────────────────────────────────────────
    "V19_BASE_URL": env("ODOO_V19_BASE_URL", default=""),
    "V19_DB_NAME": env("ODOO_V19_DB_NAME", default=""),
    "V19_API_USER": env("ODOO_V19_API_USER", default=""),
    "V19_API_PASSWORD": env("ODOO_V19_API_PASSWORD", default=""),
    "V19_VERIFY_TLS": env("ODOO_V19_VERIFY_TLS"),
}

GAMMA = {
    "API_KEY": env("GAMMA_API_KEY", default=""),
    "TEMPLATE_ID_DEVIS_PROJET": env("GAMMA_TEMPLATE_ID_DEVIS_PROJET", default=""),
    "TEMPLATE_ID_CATALOGUE_TARIFE": env("GAMMA_TEMPLATE_ID_CATALOGUE_TARIFE", default=""),
}

DEEPL_API_KEY = env("DEEPL_API_KEY", default="")
OPENAI_API_KEY = env("OPENAI_API_KEY", default="")

# Supabase (production only)
SUPABASE_URL = env("SUPABASE_URL", default="")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", default="")
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", default="")

# ─── Celery ───────────────────────────────────────────────────────────────────

CELERY_BROKER_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"

# ─── Pricing engine ───────────────────────────────────────────────────────────

# Internal pivot currency.  All margins, transports and prices are normalised
# to EUR before being persisted; conversions to USD/RMB happen at display or
# offer generation time using rates frozen on the simulation.
PIVOT_CURRENCY = "EUR"

# Defaults used when a simulation is created without explicit values.
DEFAULT_SYMEA_MARGIN_RATE = "0.06"
DEFAULT_SYSKERN_MARGIN_RATE = "0.20"

# ─── Logging ──────────────────────────────────────────────────────────────────

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{asctime} {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "apps": {"handlers": ["console"], "level": "DEBUG", "propagate": False},
    },
}
