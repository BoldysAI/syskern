"""Production settings — targets Supabase Postgres + Auth on a VPS."""
from __future__ import annotations

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")

# ─── Security headers ─────────────────────────────────────────────────────────

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000  # 1 year, mirrors §9.3.4 of the CDC
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

# ─── CORS / CSRF ──────────────────────────────────────────────────────────────

CORS_ALLOWED_ORIGINS = env.list("DJANGO_CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=CORS_ALLOWED_ORIGINS)

# ─── Auth ─────────────────────────────────────────────────────────────────────
# In production, the Next.js frontend logs in via Supabase Auth and forwards a
# JWT.  The DRF authentication class verifies it against SUPABASE_JWT_SECRET.
# Swap the default authentication classes here once the verifier ships
# (apps.core.auth.SupabaseJWTAuthentication).

# ─── Database SSL ─────────────────────────────────────────────────────────────

DATABASES["default"]["OPTIONS"] = {"sslmode": "require"}  # noqa: F405
