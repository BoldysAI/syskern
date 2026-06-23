"""IP-based rate limiting for the login endpoint (CDC §9.2).

5 failed attempts within a 15-minute sliding window per source IP
trigger a 429 with a `Retry-After` header. A successful login clears
the counter. Cache lives in Redis so it is shared across gunicorn,
worker and beat processes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest

logger = logging.getLogger(__name__)


_CACHE_PREFIX = "login_rate_limit:"


def _client_ip(request: HttpRequest) -> str:
    """Best-effort source IP. Honours X-Forwarded-For (Coolify/Traefik) but
    only the *first* address — never trusts user-supplied headers downstream
    of the proxy.
    """
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "0.0.0.0") or "0.0.0.0"


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    attempts: int  # how many failures within the current window
    retry_after_seconds: int  # advisory delay before the next attempt is allowed


def check(request: HttpRequest) -> RateLimitDecision:
    """Inspect — DO NOT increment — the counter for this IP.

    Returns a decision the caller can use to short-circuit with 429 before
    even calling `authenticate()`.
    """
    ip = _client_ip(request)
    key = _CACHE_PREFIX + ip
    max_attempts = settings.LOGIN_RATE_LIMIT_MAX_ATTEMPTS
    window = settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS

    attempts = cache.get(key, 0)
    if attempts >= max_attempts:
        ttl = cache.ttl(key) if hasattr(cache, "ttl") else window
        return RateLimitDecision(
            allowed=False, attempts=attempts, retry_after_seconds=int(ttl or window)
        )
    return RateLimitDecision(allowed=True, attempts=attempts, retry_after_seconds=0)


def register_failure(request: HttpRequest) -> int:
    """Increment the failure counter and return the new count.

    Uses `add` + `incr` for atomicity: the first failure within a fresh
    window seeds the key with TTL=window, subsequent ones just bump it.
    """
    ip = _client_ip(request)
    key = _CACHE_PREFIX + ip
    window = settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS

    # add() returns True only when the key didn't already exist — that's
    # how we seed it with the full TTL on the very first failure.
    seeded = cache.add(key, 1, timeout=window)
    if seeded:
        logger.info("login rate-limit: new window opened for ip=%s", ip)
        return 1
    try:
        return cache.incr(key)
    except ValueError:
        # Window expired between `add` and `incr` — reseed.
        cache.set(key, 1, timeout=window)
        return 1


def clear(request: HttpRequest) -> None:
    """Reset the counter for this IP — call after a successful login."""
    ip = _client_ip(request)
    cache.delete(_CACHE_PREFIX + ip)
