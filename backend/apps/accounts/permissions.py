"""Role-based DRF permissions."""
from __future__ import annotations

from rest_framework.permissions import BasePermission

from .models import Role


def _get_role(request) -> str | None:
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return None
    try:
        return user.profile.role
    except Exception:
        return None


class IsAdmin(BasePermission):
    """Only admins."""
    message = "Accès réservé aux administrateurs."

    def has_permission(self, request, view) -> bool:
        return _get_role(request) == Role.ADMIN


class IsCommercialOrAbove(BasePermission):
    """Admins and commercials (not viewers)."""
    message = "Accès réservé aux commerciaux et administrateurs."

    def has_permission(self, request, view) -> bool:
        return _get_role(request) in (Role.ADMIN, Role.COMMERCIAL)


class IsAnyRole(BasePermission):
    """Any authenticated user with a profile (admin / commercial / viewer)."""
    message = "Authentification requise."

    def has_permission(self, request, view) -> bool:
        return _get_role(request) is not None
