"""Sensitive-data redaction for application logs (CDC §9.6).

A logging filter that scrubs credentials before a record is emitted, so tokens,
passwords, cookies and API keys never land in ``/var/log/syskern-pricing/`` (or
the console in dev). Wired as a filter on the handlers in ``settings.LOGGING``.

Two redaction layers, applied in order on the fully-rendered message:

1. **Header values** (``Authorization``, ``Cookie``, …): masked to end-of-line /
   closing quote, because their values legitimately contain spaces
   (``Bearer <jwt>``, ``sessionid=…; csrftoken=…``).
2. **key=value / "key": "value"** pairs for spaceless secrets
   (``password``, ``token``, ``api_key``, …).
3. **Raw token shapes** (``Bearer <x>``, ``sk-…``) even without a key in front.

Extending the redaction
-----------------------
* New sensitive **field name** → append to :data:`SENSITIVE_KEYS`.
* New sensitive **header** → append to :data:`SENSITIVE_HEADERS`.
* New raw **token shape** (a vendor key format) → append a compiled regex to
  :data:`SENSITIVE_PATTERNS`.
"""

from __future__ import annotations

import logging
import re

REDACTED = "***REDACTED***"

# Header names whose entire value is masked (values may contain spaces / ``;``).
SENSITIVE_HEADERS = (
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
)

# Field names whose (spaceless) value is masked wherever it appears.
SENSITIVE_KEYS = (
    "password",
    "passwd",
    "secret",
    "client_secret",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "x-api-key",
)

_HEADERS_GROUP = "|".join(re.escape(h) for h in SENSITIVE_HEADERS)
_KEYS_GROUP = "|".join(re.escape(k) for k in SENSITIVE_KEYS)

# `Authorization: <anything to EOL>` / `'Cookie': '<...>'` → mask the value.
_HEADER_RE = re.compile(
    rf"(?P<key>[\"']?(?:{_HEADERS_GROUP})[\"']?\s*[:=]\s*)"
    r"(?P<quote>[\"']?)[^\"'\r\n]+(?P=quote)",
    re.IGNORECASE,
)

# `password=<v>` / `"token": "<v>"` → mask spaceless value (stops at delimiters).
_KV_RE = re.compile(
    rf"(?P<key>[\"']?(?:{_KEYS_GROUP})[\"']?\s*[:=]\s*)"
    r"(?P<quote>[\"']?)[^\"',;&\s}]+(?P=quote)",
    re.IGNORECASE,
)

# Raw token shapes, masked even without a recognisable key in front.
SENSITIVE_PATTERNS = (
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]+", re.IGNORECASE),
    re.compile(r"Basic\s+[A-Za-z0-9+/=]+", re.IGNORECASE),
    re.compile(r"sk-[A-Za-z0-9._\-]{12,}"),  # OpenAI-style API keys
)


def _mask_kv(match: re.Match[str]) -> str:
    quote = match.group("quote")
    return f"{match.group('key')}{quote}{REDACTED}{quote}"


def redact(text: str) -> str:
    """Return ``text`` with every recognised secret replaced by ``***REDACTED***``."""
    if not text:
        return text
    text = _HEADER_RE.sub(_mask_kv, text)
    text = _KV_RE.sub(_mask_kv, text)
    for pattern in SENSITIVE_PATTERNS:
        text = pattern.sub(REDACTED, text)
    return text


class SensitiveDataFilter(logging.Filter):
    """Scrub secrets from the rendered log message before it is formatted."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover — logging must never crash the app
            return True
        redacted = redact(message)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True
