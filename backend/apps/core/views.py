"""Auth proxy endpoints (CDC §9.1.3)."""
from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from .permissions import SESSION_KEY, validate_app_password


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request: Request) -> Response:
    """Validate the MVP1 shared password and flip the session marker."""
    password = (request.data or {}).get("password")
    if not isinstance(password, str) or not validate_app_password(password):
        return Response(
            {"detail": "Invalid password."}, status=status.HTTP_401_UNAUTHORIZED
        )

    request.session[SESSION_KEY] = True
    request.session.set_expiry(60 * 60 * 24 * 7)  # one week, mirrors §9.1.4
    return Response({"detail": "ok"}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([AllowAny])
def logout(request: Request) -> Response:
    request.session.flush()
    return Response({"detail": "ok"}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([AllowAny])
def session(request: Request) -> Response:
    """Tells the frontend whether the current session is authenticated."""
    return Response({"authenticated": bool(request.session.get(SESSION_KEY))})
