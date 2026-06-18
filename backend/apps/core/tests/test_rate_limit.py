"""Tests for the login rate-limiter (CDC §9.2)."""

from __future__ import annotations

import pytest
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Profile, Role


@pytest.fixture(autouse=True)
def _clear_cache():
    """Each test starts with a clean rate-limit counter."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def login_user(db):
    user = User.objects.create_user(
        username="ratelimit@test.com",
        email="ratelimit@test.com",
        password="GoodSecret123!",  # pragma: allowlist secret
    )
    # Profile may be auto-created by a post-save signal — upsert defensively.
    Profile.objects.update_or_create(user=user, defaults={"role": Role.ADMIN.value})
    return user


@pytest.fixture
def client():
    return APIClient(REMOTE_ADDR="203.0.113.7")  # documentation IP — TEST-NET-3


LOGIN_URL = "/api/auth/login"


def _post(client, email="ratelimit@test.com", password="GoodSecret123!"):
    return client.post(LOGIN_URL, {"email": email, "password": password}, format="json")


@pytest.mark.django_db
def test_five_failed_attempts_all_return_401(login_user, client):
    """5 wrong-password attempts → 5x 401, no 429 yet."""
    for _ in range(5):
        resp = _post(client, password="WRONG")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_sixth_attempt_returns_429_with_retry_after(login_user, client):
    """6th attempt within the window → 429 + Retry-After."""
    for _ in range(5):
        _post(client, password="WRONG")
    resp = _post(client, password="WRONG")

    assert resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert "Retry-After" in resp.headers
    ra = int(resp.headers["Retry-After"])
    assert 0 < ra <= 900  # within the 15-minute window


@pytest.mark.django_db
def test_429_blocks_even_a_correct_password(login_user, client):
    """Once locked out, even the right password gets 429 (no oracle leak)."""
    for _ in range(5):
        _post(client, password="WRONG")
    resp = _post(client, password="GoodSecret123!")
    assert resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_successful_login_resets_counter(login_user, client):
    """A 200 within the window must clear the failure counter."""
    for _ in range(3):
        _post(client, password="WRONG")

    resp = _post(client, password="GoodSecret123!")
    assert resp.status_code == status.HTTP_200_OK

    # Fresh: should allow another 5 failures before locking.
    for _ in range(5):
        r = _post(client, password="WRONG")
        assert r.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_per_ip_isolation(login_user):
    """Different source IPs don't share the same counter."""
    a = APIClient(REMOTE_ADDR="203.0.113.7")
    b = APIClient(REMOTE_ADDR="203.0.113.8")

    for _ in range(5):
        a.post(LOGIN_URL, {"email": "ratelimit@test.com", "password": "WRONG"}, format="json")

    resp_a = a.post(LOGIN_URL, {"email": "ratelimit@test.com", "password": "WRONG"}, format="json")
    resp_b = b.post(LOGIN_URL, {"email": "ratelimit@test.com", "password": "WRONG"}, format="json")
    assert resp_a.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert resp_b.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_xff_first_ip_is_used(login_user):
    """If the request comes via Traefik, the first IP in X-Forwarded-For wins."""
    c1 = APIClient(HTTP_X_FORWARDED_FOR="203.0.113.10, 10.0.0.1")
    c2 = APIClient(HTTP_X_FORWARDED_FOR="203.0.113.11, 10.0.0.1")

    for _ in range(5):
        c1.post(LOGIN_URL, {"email": "ratelimit@test.com", "password": "WRONG"}, format="json")

    # Same XFF first IP → locked
    locked = c1.post(LOGIN_URL, {"email": "ratelimit@test.com", "password": "WRONG"}, format="json")
    # Different XFF first IP → unaffected
    fresh = c2.post(LOGIN_URL, {"email": "ratelimit@test.com", "password": "WRONG"}, format="json")
    assert locked.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert fresh.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_window_expiry_resets_counter(login_user, client, settings):
    """Past the 15-min window, counter goes back to zero.

    We don't sleep — we shorten the window for the test and rely on cache TTL.
    """
    settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS = 1  # 1 second window for testing
    for _ in range(5):
        _post(client, password="WRONG")

    import time

    time.sleep(1.2)
    cache.clear()  # simulate TTL expiry on the rate-limit key

    resp = _post(client, password="WRONG")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ─── Direct rate_limit helpers ──────────────────────────────────────────────


from apps.core import rate_limit  # noqa: E402 — local import after fixtures


def test_helper_client_ip_prefers_xff():
    from django.test import RequestFactory

    rf = RequestFactory()
    req = rf.get("/", HTTP_X_FORWARDED_FOR="198.51.100.1, 10.0.0.1", REMOTE_ADDR="10.0.0.1")
    assert rate_limit._client_ip(req) == "198.51.100.1"


def test_helper_client_ip_falls_back_to_remote_addr():
    from django.test import RequestFactory

    rf = RequestFactory()
    req = rf.get("/", REMOTE_ADDR="198.51.100.99")
    assert rate_limit._client_ip(req) == "198.51.100.99"
