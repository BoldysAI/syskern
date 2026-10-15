from __future__ import annotations

from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Profile, Role
from .ui_locale import UI_LOCALES, resolve_ui_locale, translate


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ("role",)


class UserInfoSerializer(serializers.ModelSerializer):
    """Returned by /api/auth/session and /api/auth/login."""

    role = serializers.SerializerMethodField()
    locale = serializers.SerializerMethodField()
    display_language = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "role", "locale", "display_language")

    def get_role(self, obj: User) -> str:
        try:
            return obj.profile.role
        except Profile.DoesNotExist:
            return Role.VIEWER

    def get_locale(self, obj: User) -> str:
        return _profile_locale(obj)

    def get_display_language(self, obj: User) -> str:
        return resolve_ui_locale(obj)


class UserListSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    locale = serializers.SerializerMethodField()
    display_language = serializers.SerializerMethodField()
    is_active = serializers.BooleanField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "role",
            "locale",
            "display_language",
            "is_active",
            "date_joined",
            "last_login",
        )
        read_only_fields = fields

    def get_role(self, obj: User) -> str:
        try:
            return obj.profile.role
        except Profile.DoesNotExist:
            return Role.VIEWER

    def get_locale(self, obj: User) -> str:
        return _profile_locale(obj)

    def get_display_language(self, obj: User) -> str:
        return resolve_ui_locale(obj)


class UserWriteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150, default="")
    last_name = serializers.CharField(max_length=150, default="")
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=Role.choices, default=Role.VIEWER)
    locale = serializers.CharField(required=False, allow_blank=True, default="")

    def _locale(self) -> str:
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        return resolve_ui_locale(user)

    def validate_locale(self, value: str) -> str:
        value = (value or "").strip()
        if value and value not in UI_LOCALES:
            raise serializers.ValidationError(translate("users.locale_invalid", self._locale()))
        return value

    def validate_email(self, value: str) -> str:
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(translate("users.email_taken", self._locale()))
        return value.lower()

    def create(self, validated_data: dict) -> User:
        role = validated_data.pop("role")
        locale = validated_data.pop("locale", "")
        email = validated_data["email"]
        user = User.objects.create_user(
            username=email,
            email=email,
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        Profile.objects.update_or_create(user=user, defaults={"role": role, "locale": locale})
        return user

    def update(self, instance: User, validated_data: dict) -> User:
        role = validated_data.pop("role", None)
        locale = validated_data.pop("locale", None)
        if "email" in validated_data:
            instance.username = validated_data["email"]
            instance.email = validated_data["email"]
        if "first_name" in validated_data:
            instance.first_name = validated_data["first_name"]
        if "last_name" in validated_data:
            instance.last_name = validated_data["last_name"]
        if "password" in validated_data:
            instance.set_password(validated_data["password"])
        instance.save()
        defaults: dict[str, str] = {}
        if role:
            defaults["role"] = role
        if locale is not None:
            defaults["locale"] = locale
        if defaults:
            Profile.objects.update_or_create(user=instance, defaults=defaults)
        return instance


def _profile_locale(user: User) -> str:
    try:
        return user.profile.locale or ""
    except Profile.DoesNotExist:
        return ""
