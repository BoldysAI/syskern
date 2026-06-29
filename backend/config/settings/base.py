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
    "DEFAULT_AUTHENTICATION_CLASSES": ("apps.core.authentication.CsrfExemptSessionAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
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
# Model for offer copy generation (CDC §7.6.1) — overridable per the evolving
# model landscape (Annexe Technique §3.6).
OPENAI_MODEL = env("OPENAI_MODEL", default="gpt-4o-mini")

# ─── Email (offer expiration alerts, technical alerts — CDC §7.5.4) ───────────
# Dev: console backend (mails printed to logs). Prod: configure SMTP via env.
EMAIL_BACKEND = env(
    "DJANGO_EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend"
)
DEFAULT_FROM_EMAIL = env("DJANGO_DEFAULT_FROM_EMAIL", default="noreply@syskern.com")
# Address used for server-error / technical alert mails (uptime, cron failures).
SERVER_EMAIL = env("DJANGO_SERVER_EMAIL", default=DEFAULT_FROM_EMAIL)
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)

# ─── Offer lifecycle (CDC §7.5 / §7.6) ────────────────────────────────────────
# Alert recipients are configured from the UI (DB: OfferAlertConfig), not env.
OFFERS = {
    # Killswitch for the daily expiration cron (auto-expire + J-7 alert).
    "EXPIRATION_CRON_ENABLED": env.bool("EXPIRATION_CRON_ENABLED", default=True),
    # Base URL for clickable offer links in the alert email.
    "FRONTEND_BASE_URL": env("OFFER_FRONTEND_BASE_URL", default="http://localhost:3000"),
}

# ─── Initial data migration (one-shot — CDC §8) ───────────────────────────────
# The migration is operated by Boldys at deployment. `LOCKED` is the guard-rail
# (CDC §8.9): once true (post go-live) `run_migration` and `migration_reset`
# refuse to run so an accidental re-run cannot clobber data Olivier enriched.
# `STATE_FILE` holds the resume checkpoint (survives a DB reset — it is on disk,
# not in Postgres). `SOURCES_DIR` defaults to the repo-root `migration/sources/`
# (mounted at /migration/sources inside the backend container).
MIGRATION = {
    "LOCKED": env.bool("MIGRATION_LOCKED", default=False),
    "STATE_FILE": env("MIGRATION_STATE_FILE", default=str(BASE_DIR / ".migration_state.json")),
    "SOURCES_DIR": env(
        "MIGRATION_SOURCES_DIR", default=str(BASE_DIR.parent / "migration" / "sources")
    ),
    # Optional path to a JSON manifest listing the Excel sources to load
    # (see docs/runbooks/migration.md). Empty → step 2 auto-discovers nothing.
    "MANIFEST": env("MIGRATION_MANIFEST", default=""),
    # Final report (CDC §8.8): where migration_report_<date>.xlsx is written,
    # and the cross-validation recipients for `migration_report --email`.
    "REPORT_DIR": env(
        "MIGRATION_REPORT_DIR", default=str(BASE_DIR.parent / "migration" / "reports")
    ),
    "REPORT_RECIPIENTS": env.list("MIGRATION_REPORT_RECIPIENTS", default=[]),
}

# Supabase (production only)
SUPABASE_URL = env("SUPABASE_URL", default="")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", default="")
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", default="")

# ─── Cache (Redis) ────────────────────────────────────────────────────────────
# Shared between gunicorn / worker / beat so primitives like the login
# rate limiter see the same counters regardless of which process serves
# the request. Falls back to LocMemCache (per-process) only in test contexts
# where REDIS_URL isn't reachable.

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://localhost:6379/0"),
        "KEY_PREFIX": "syskern",
        "TIMEOUT": 300,  # 5 min default for ad-hoc keys; rate-limiter sets its own
    }
}

# ─── Login rate limit (CDC §9.2) ──────────────────────────────────────────────
LOGIN_RATE_LIMIT_MAX_ATTEMPTS = int(env("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", default=5))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(env("LOGIN_RATE_LIMIT_WINDOW_SECONDS", default=900))  # 15 min

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
    "filters": {
        # Redact credentials (Authorization, Cookie, password, api_key, token,
        # secret, Bearer/sk- shapes) before any record is written — CDC §9.6.
        "redact_secrets": {
            "()": "apps.core.logging.SensitiveDataFilter",
        },
    },
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
            "filters": ["redact_secrets"],
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "apps": {"handlers": ["console"], "level": "DEBUG", "propagate": False},
    },
}
