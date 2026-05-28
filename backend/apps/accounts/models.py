from __future__ import annotations

from django.contrib.auth.models import User
from django.db import models


class Role(models.TextChoices):
    ADMIN = "admin", "Administrateur"
    COMMERCIAL = "commercial", "Commercial"
    VIEWER = "viewer", "Lecteur"


class Profile(models.Model):
    """One-to-one extension of Django's built-in User that carries the platform role."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)

    class Meta:
        verbose_name = "Profil"
        verbose_name_plural = "Profils"

    def __str__(self) -> str:
        return f"{self.user.email} ({self.role})"
