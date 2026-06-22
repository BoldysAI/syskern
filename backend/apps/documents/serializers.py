from __future__ import annotations

from rest_framework import serializers

from .models import DocumentLibrary


class DocumentLibrarySerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    product_sku = serializers.CharField(source="product.sku_code", read_only=True, default=None)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = DocumentLibrary
        fields = "__all__"
        # File fields are set only by /upload; PATCH edits metadata only.
        read_only_fields = (
            "id",
            "file_url",
            "file_name",
            "file_size_bytes",
            "mime_type",
            "version",
            "uploaded_by",
            "deleted_at",
            "created_at",
            "updated_at",
        )

    def get_download_url(self, obj: DocumentLibrary) -> str:
        return f"/api/document-library/{obj.id}/download/"
