from __future__ import annotations

from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Profile, Role


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ("role",)


class UserInfoSerializer(serializers.ModelSerializer):
    """Returned by /api/auth/session and /api/auth/login."""

    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "role")

    def get_role(self, obj: User) -> str:
        try:
            return obj.profile.role
        except Profile.DoesNotExist:
            return Role.VIEWER


class UserListSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    is_active = serializers.BooleanField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "role",
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


class UserWriteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150, default="")
    last_name = serializers.CharField(max_length=150, default="")
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=Role.choices, default=Role.VIEWER)

    def validate_email(self, value: str) -> str:
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Un compte existe déjà avec cette adresse e-mail.")
        return value.lower()

    def create(self, validated_data: dict) -> User:
        role = validated_data.pop("role")
        email = validated_data["email"]
        user = User.objects.create_user(
            username=email,
            email=email,
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        Profile.objects.update_or_create(user=user, defaults={"role": role})
        return user

    def update(self, instance: User, validated_data: dict) -> User:
        role = validated_data.pop("role", None)
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
        if role:
            Profile.objects.update_or_create(user=instance, defaults={"role": role})
        return instance
