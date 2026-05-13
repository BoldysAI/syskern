from __future__ import annotations

from rest_framework import serializers

from .models import DocumentLibrary


class DocumentLibrarySerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentLibrary
        fields = "__all__"
        read_only_fields = ("id", "file_size_bytes", "mime_type", "created_at", "updated_at")
