"""UI locale resolution and per-label French fallback (story 7.1)."""

from __future__ import annotations

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from apps.accounts.models import Profile, Role
from apps.accounts.ui_locale import resolve_ui_locale, translate


def test_anonymous_uses_deployment_locale(settings):
    settings.DEFAULT_UI_LOCALE = "en"
    assert resolve_ui_locale(None) == "en"


def test_anonymous_ignores_unsupported_deployment_locale(settings):
    settings.DEFAULT_UI_LOCALE = "zh"
    assert resolve_ui_locale(None) == "fr"


def test_anonymous_falls_back_to_french_when_setting_missing(settings):
    settings.DEFAULT_UI_LOCALE = ""
    assert resolve_ui_locale(None) == "fr"


@pytest.mark.django_db
def test_user_locale_wins_over_deployment_setting(settings):
    settings.DEFAULT_UI_LOCALE = "fr"
    user = User.objects.create_user(username="en@test.com", email="en@test.com", password="x")
    Profile.objects.update_or_create(user=user, defaults={"role": Role.VIEWER, "locale": "en"})
    user = User.objects.select_related("profile").get(pk=user.pk)
    assert resolve_ui_locale(user) == "en"


@pytest.mark.django_db
def test_empty_user_locale_uses_deployment_setting(settings):
    settings.DEFAULT_UI_LOCALE = "en"
    user = User.objects.create_user(username="empty@test.com", email="empty@test.com", password="x")
    Profile.objects.update_or_create(user=user, defaults={"role": Role.VIEWER, "locale": ""})
    user = User.objects.select_related("profile").get(pk=user.pk)
    assert resolve_ui_locale(user) == "en"


def test_missing_english_label_falls_back_to_french_only():
    assert translate("login.title", "en") == "Sign in"
    assert translate("_proof.only_fr", "en") == "Libellé français"


@pytest.mark.django_db
def test_login_error_follows_the_account_locale(settings):
    settings.DEFAULT_UI_LOCALE = "fr"
    user = User.objects.create_user(
        username="shanghai@test.com",
        email="shanghai@test.com",
        password="GoodSecret123!",
    )
    Profile.objects.update_or_create(user=user, defaults={"role": Role.VIEWER, "locale": "en"})
    client = APIClient()
    resp = client.post(
        "/api/auth/login",
        {"email": "shanghai@test.com", "password": "WRONG"},
        format="json",
    )
    assert resp.status_code == 401
    assert resp.data["detail"] == "Incorrect email or password."


@pytest.mark.django_db
def test_anonymous_session_exposes_deployment_language(settings):
    settings.DEFAULT_UI_LOCALE = "en"
    client = APIClient()
    resp = client.get("/api/auth/session")
    assert resp.status_code == 200
    assert resp.data["authenticated"] is False
    assert resp.data["display_language"] == "en"


@pytest.mark.django_db
def test_create_user_locale_optional(settings):
    settings.DEFAULT_UI_LOCALE = "fr"
    admin = User.objects.create_user(
        username="admin@test.com",
        email="admin@test.com",
        password="GoodSecret123!",
    )
    Profile.objects.update_or_create(user=admin, defaults={"role": Role.ADMIN, "locale": ""})
    client = APIClient()
    client.force_login(admin)

    created = client.post(
        "/api/users/create/",
        {
            "email": "shanghai@test.com",
            "password": "GoodSecret123!",
            "role": "viewer",
            "locale": "en",
        },
        format="json",
    )
    assert created.status_code == 201
    assert created.data["locale"] == "en"
    assert created.data["display_language"] == "en"

    bare = client.post(
        "/api/users/create/",
        {
            "email": "paris@test.com",
            "password": "GoodSecret123!",
            "role": "viewer",
            "locale": "",
        },
        format="json",
    )
    assert bare.status_code == 201
    assert bare.data["locale"] == ""
    assert bare.data["display_language"] == "fr"
