"""Auth proxy endpoints + generic Celery task polling."""

from __future__ import annotations

from celery.result import AsyncResult
from django.contrib.auth import authenticate, login
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.models import User
from django.middleware.csrf import get_token
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Profile
from apps.accounts.serializers import UserInfoSerializer
from apps.accounts.ui_locale import UI_LOCALES, resolve_ui_locale, translate, translate_request
from apps.core import rate_limit
from apps.core.dashboard import build_dashboard_summary


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request: Request) -> Response:
    # ─── Rate limit (CDC §9.2) ───────────────────────────────────────────
    # 5 failed attempts per IP within 15 minutes → 429 + Retry-After.
    decision = rate_limit.check(request)
    if not decision.allowed:
        minutes = max(decision.retry_after_seconds // 60, 1)
        detail = translate("auth.rate_limited", resolve_ui_locale(None)).format(minutes=minutes)
        return Response(
            {"detail": detail},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": str(decision.retry_after_seconds)},
        )

    email = (request.data or {}).get("email", "")
    password = (request.data or {}).get("password", "")
    locale = _locale_for_email(email)

    if not email or not password:
        return Response(
            {"detail": translate("auth.missing_credentials", locale)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user_obj = User.objects.select_related("profile").get(email__iexact=email)
    except User.DoesNotExist:
        rate_limit.register_failure(request)
        return Response(
            {"detail": translate("auth.invalid_credentials", locale)},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    locale = resolve_ui_locale(user_obj)
    user = authenticate(request, username=user_obj.username, password=password)
    if user is None:
        rate_limit.register_failure(request)
        return Response(
            {"detail": translate("auth.invalid_credentials", locale)},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    rate_limit.clear(request)
    login(request, user)
    # Force Django to emit the csrftoken cookie in this response.
    # Without this, @api_view (csrf_exempt) never triggers get_token() and the
    # browser has no cookie to send as X-CSRFToken on subsequent mutations.
    get_token(request)
    return Response({"user": UserInfoSerializer(user).data}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request: Request) -> Response:
    auth_logout(request)
    return Response({"detail": "ok"}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([AllowAny])
def task_status(_request: Request, task_id: str) -> Response:
    """Generic Celery task polling.

    Returns the current state of the task and, when terminal, the result
    (on SUCCESS) or the error message (on FAILURE). Front-end clients can
    poll this endpoint until status is in {SUCCESS, FAILURE, REVOKED}.
    """
    r = AsyncResult(task_id)
    body: dict = {"task_id": task_id, "status": r.status}
    if r.successful():
        body["result"] = r.result
    elif r.failed():
        info = r.info
        body["error"] = (
            str(info) if info is not None else translate_request(_request, "tasks.failed")
        )
    elif isinstance(r.info, dict):
        # Non-terminal states (STARTED, custom PROGRESS) carry {current, total}.
        body["progress"] = r.info
    return Response(body)


@api_view(["GET"])
@permission_classes([AllowAny])
def session_view(request: Request) -> Response:
    # Always ensure the csrftoken cookie is present so the frontend can read it.
    get_token(request)
    if request.user.is_authenticated:
        user_data = UserInfoSerializer(request.user).data
        return Response(
            {
                "authenticated": True,
                "user": user_data,
                "display_language": user_data["display_language"],
            }
        )
    language = resolve_ui_locale(None)
    return Response({"authenticated": False, "user": None, "display_language": language})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_locale_view(request: Request) -> Response:
    """Store the signed-in user's interface language on their profile (story 7.8)."""
    raw = (request.data or {}).get("locale", "")
    value = raw.strip() if isinstance(raw, str) else ""
    if value not in ("", *UI_LOCALES):
        raise ValidationError(
            {"locale": translate("users.locale_invalid", resolve_ui_locale(request.user))}
        )
    profile, _created = Profile.objects.get_or_create(user=request.user)
    profile.locale = value
    profile.save(update_fields=["locale"])
    user = User.objects.select_related("profile").get(pk=request.user.pk)
    return Response({"user": UserInfoSerializer(user).data})


def _locale_for_email(email: str) -> str:
    if not email:
        return resolve_ui_locale(None)
    try:
        user = User.objects.select_related("profile").get(email__iexact=email)
    except User.DoesNotExist:
        return resolve_ui_locale(None)
    return resolve_ui_locale(user)


class DashboardSummaryView(APIView):
    """Aggregated home dashboard metrics (read-only)."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(build_dashboard_summary())
