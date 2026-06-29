"""Tests for sensitive-data redaction in logs (CDC §9.6)."""

from __future__ import annotations

import logging

import pytest

from apps.core.logging import REDACTED, SensitiveDataFilter, redact


@pytest.mark.parametrize(
    "raw, secret",
    [
        # Fake credentials below — fixtures for the redaction logic, not real secrets.
        (
            "Authorization: Bearer eyJhbGciOiJIUzI1Niso.payload.sig",
            "eyJhbGci",
        ),  # pragma: allowlist secret
        ("'Authorization': 'Bearer abc.def.ghi'", "abc.def.ghi"),  # pragma: allowlist secret
        ("Cookie: sessionid=abc123; csrftoken=def456", "abc123"),  # pragma: allowlist secret
        ('{"password": "S3cr3t!Pass"}', "S3cr3t!Pass"),  # pragma: allowlist secret
        ("login attempt password=hunter2 user=bob", "hunter2"),  # pragma: allowlist secret
        ("GET /api/x?api_key=AKIA1234567890&page=2", "AKIA1234567890"),  # pragma: allowlist secret
        ('{"token": "ghp_9999abcd", "ok": true}', "ghp_9999abcd"),  # pragma: allowlist secret
        ("client_secret=zzz-very-secret-zzz", "zzz-very-secret-zzz"),  # pragma: allowlist secret
        (
            "calling openai with key sk-proj-ABCDEFGHIJKLMNOP",
            "sk-proj-ABCDEFG",
        ),  # pragma: allowlist secret
    ],
)
def test_redact_removes_secret(raw: str, secret: str):
    out = redact(raw)
    assert secret not in out, f"secret leaked in: {out!r}"
    assert REDACTED in out


def test_redact_preserves_field_name():
    """Only the value is masked — the key stays for debuggability."""
    out = redact('{"password": "hunter2"}')  # pragma: allowlist secret
    assert "password" in out
    assert "hunter2" not in out


def test_redact_leaves_innocent_text_untouched():
    raw = "GET /api/products?page=2 status=200 took=12ms"
    assert redact(raw) == raw


def test_filter_mutates_record_message():
    record = logging.LogRecord(
        name="apps.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="auth header password=%s",
        args=("topsecret",),
        exc_info=None,
    )
    assert SensitiveDataFilter().filter(record) is True
    rendered = record.getMessage()
    assert "topsecret" not in rendered
    assert REDACTED in rendered
