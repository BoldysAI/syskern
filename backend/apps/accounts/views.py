"""User management endpoints (admin only)."""

from __future__ import annotations

from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .permissions import IsAdmin
from .serializers import UserListSerializer, UserWriteSerializer


@api_view(["GET"])
def list_users(request: Request) -> Response:
    IsAdmin().has_permission(request, None) or _deny()
    users = User.objects.select_related("profile").order_by("email")
    return Response(UserListSerializer(users, many=True).data)


@api_view(["POST"])
def create_user(request: Request) -> Response:
    IsAdmin().has_permission(request, None) or _deny()
    ser = UserWriteSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = ser.save()
    user = User.objects.select_related("profile").get(pk=user.pk)
    return Response(UserListSerializer(user).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
def user_detail(request: Request, user_id: int) -> Response:
    IsAdmin().has_permission(request, None) or _deny()
    try:
        user = User.objects.select_related("profile").get(pk=user_id)
    except User.DoesNotExist:
        return Response({"detail": "Introuvable."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        if user == request.user:
            return Response(
                {"detail": "Vous ne pouvez pas supprimer votre propre compte."}, status=400
            )
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = UserWriteSerializer(user, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    user = ser.save()
    user = User.objects.select_related("profile").get(pk=user.pk)
    return Response(UserListSerializer(user).data)


def _deny():
    from rest_framework.exceptions import PermissionDenied

    raise PermissionDenied("Accès réservé aux administrateurs.")
