"""Management command to create a platform user.

Usage:
    python manage.py create_platform_user --email karim@boldys.ai --role admin --password secret
"""
from __future__ import annotations

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Profile, Role


class Command(BaseCommand):
    help = "Create or update a platform user with a role."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=True)
        parser.add_argument("--role", choices=[r.value for r in Role], default=Role.ADMIN.value)
        parser.add_argument("--first-name", default="")
        parser.add_argument("--last-name", default="")

    def handle(self, *args, **options):
        email = options["email"].lower()
        role = options["role"]
        password = options["password"]

        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "username": email,
                "first_name": options["first_name"],
                "last_name": options["last_name"],
            },
        )
        if not created:
            user.username = email
        user.set_password(password)
        user.is_active = True
        user.save()

        Profile.objects.update_or_create(user=user, defaults={"role": role})

        action = "Créé" if created else "Mis à jour"
        self.stdout.write(
            self.style.SUCCESS(f"{action} : {email} (rôle : {role})")
        )
