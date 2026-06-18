from __future__ import annotations

import mimetypes

from django.core.files.storage import default_storage
from rest_framework import parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import DocumentLibrary
from .serializers import DocumentLibrarySerializer


class DocumentLibraryViewSet(viewsets.ModelViewSet):
    """Document library (CDC §7.4).  Soft-disable via `is_active=False`."""

    queryset = DocumentLibrary.objects.all()
    serializer_class = DocumentLibrarySerializer
    filterset_fields = ("category", "language", "is_active")
    ordering = ("category", "display_order")

    # ─── /upload (multipart file upload) ──────────────────────────────
    @action(
        detail=False,
        methods=["post"],
        parser_classes=[parsers.MultiPartParser, parsers.FormParser],
        url_path="upload",
    )
    def upload(self, request):
        """Upload a file and create the matching library entry.

        Local dev: file lands under `MEDIA_ROOT/documents/`.
        Production: swap `default_storage` for Supabase Storage backend.
        """
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)

        category = request.data.get("category") or "other"
        language = request.data.get("language") or ""
        name = request.data.get("name") or f'{{"fr": "{file.name}"}}'
        description = request.data.get("description") or ""

        target_path = f"documents/{file.name}"
        stored_path = default_storage.save(target_path, file)
        url = default_storage.url(stored_path) if hasattr(default_storage, "url") else stored_path

        doc = DocumentLibrary.objects.create(
            name=_safe_json(name, fallback={"fr": file.name}),
            category=category,
            file_url=url,
            file_size_bytes=file.size,
            mime_type=file.content_type or mimetypes.guess_type(file.name)[0] or "",
            language=language,
            description=description,
        )
        return Response(DocumentLibrarySerializer(doc).data, status=status.HTTP_201_CREATED)


def _safe_json(maybe_json, *, fallback: dict) -> dict:
    """Parse a JSON string if possible, else wrap as {fr: <raw>}."""
    import json

    if isinstance(maybe_json, dict):
        return maybe_json
    try:
        parsed = json.loads(maybe_json)
        if isinstance(parsed, dict):
            return parsed
    except (TypeError, ValueError):
        pass
    return {"fr": str(maybe_json)} if maybe_json else fallback
