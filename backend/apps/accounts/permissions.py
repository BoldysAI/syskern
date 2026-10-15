"""Role-based DRF permissions."""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from .models import Role
from .ui_locale import translate_request


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

    def has_permission(self, request, view) -> bool:
        if _get_role(request) == Role.ADMIN:
            return True
        self.message = translate_request(request, "users.admin_only")
        return False


class IsCommercialOrAbove(BasePermission):
    """Admins and commercials (not viewers)."""

    def has_permission(self, request, view) -> bool:
        if _get_role(request) in (Role.ADMIN, Role.COMMERCIAL):
            return True
        self.message = translate_request(request, "users.commercial_or_admin")
        return False


class IsAnyRole(BasePermission):
    """Any authenticated user with a profile (admin / commercial / viewer)."""

    def has_permission(self, request, view) -> bool:
        if _get_role(request) is not None:
            return True
        self.message = translate_request(request, "auth.authentication_required")
        return False
