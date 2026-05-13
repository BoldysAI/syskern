"""Authentication / authorization primitives.

MVP1 uses a single shared password rather than per-user accounts (cf. CDC
§9.1.2 and Annexe Technique §8.3).  The frontend submits the password to the
proxy login endpoint, receives a short-lived session token, and forwards it
in subsequent requests.

In production the same code path delegates to Supabase Auth: the JWT issued
by Supabase replaces the local session, and `SupabaseJWTAuthentication`
verifies it against `settings.SUPABASE_JWT_SECRET`.  The plumbing is left
as a stub here — the gate that actually matters in MVP1 is the shared
password.
"""
from __future__ import annotations

from typing import Any

from django.conf import settings
from rest_framework import authentication, exceptions, permissions

SESSION_KEY = "syskern_authenticated"


class AppPasswordAuthentication(authentication.BaseAuthentication):
    """Read-only authentication that flips a session flag once the shared
    password has been validated (see `views.login`).  Returns a sentinel
    "user" object (`AnonymousUser`) when the session marker is present —
    DRF only checks `is_authenticated`."""

    def authenticate(self, request: Any):
        if request.session.get(SESSION_KEY):
            # Return a tuple (user, auth) — we don't have real users, so we
            # use a lightweight stand-in object.
            return _SharedUser(), None
        return None


class _SharedUser:
    """Stand-in 'user' for the MVP1 shared-password flow."""

    is_authenticated = True
    is_anonymous = False
    is_active = True

    def __str__(self) -> str:  # pragma: no cover
        return "shared-mvp1"


def validate_app_password(submitted: str) -> bool:
    """Validate the shared password against `APP_PASSWORD`.

    Falls back to refusing all attempts if `APP_PASSWORD` is unset (the
    fail-closed behaviour matches production where Supabase Auth is the
    real gate)."""

    expected = settings.APP_PASSWORD
    if not expected:
        return False
    # No timing-attack hardening in MVP1 (single password, low value) —
    # constant-time comparison can be added later if needed.
    return submitted == expected


class SharedPasswordRequired(permissions.BasePermission):
    """Require an authenticated session via the shared password."""

    message = "Authentication required."

    def has_permission(self, request, view) -> bool:
        return bool(getattr(request, "user", None) and request.user.is_authenticated)
