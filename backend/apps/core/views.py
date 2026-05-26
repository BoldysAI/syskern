"""Auth proxy endpoints."""
from __future__ import annotations

from django.contrib.auth import authenticate, login, logout as auth_logout
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.serializers import UserInfoSerializer


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request: Request) -> Response:
    email = (request.data or {}).get("email", "")
    password = (request.data or {}).get("password", "")

    if not email or not password:
        return Response(
            {"detail": "Email et mot de passe requis."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user_obj = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return Response({"detail": "Identifiants incorrects."}, status=status.HTTP_401_UNAUTHORIZED)

    user = authenticate(request, username=user_obj.username, password=password)
    if user is None:
        return Response({"detail": "Identifiants incorrects."}, status=status.HTTP_401_UNAUTHORIZED)

    login(request, user)
    return Response({"user": UserInfoSerializer(user).data}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request: Request) -> Response:
    auth_logout(request)
    return Response({"detail": "ok"}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([AllowAny])
def session_view(request: Request) -> Response:
    if request.user.is_authenticated:
        return Response({
            "authenticated": True,
            "user": UserInfoSerializer(request.user).data,
        })
    return Response({"authenticated": False, "user": None})
