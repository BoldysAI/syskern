"""Document library API (CDC §7.4).

Upload / list / download / soft-delete / version chain for the reusable
attachments of project offers. Files are stored via Django's ``default_storage``
(local disk under ``MEDIA_ROOT/documents/`` in dev; swap the storage backend for
Supabase Storage in production). Deletes are soft (``is_active=False`` +
``deleted_at``); a daily Celery Beat task hard-purges files after 30 days.
"""

from __future__ import annotations

import json
import mimetypes
import os
import uuid

from django.core.files.storage import default_storage
from django.db.models import Max
from django.http import FileResponse, Http404
from django.utils import timezone
from django.views.decorators.clickjacking import xframe_options_sameorigin
from rest_framework import parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .filters import DocumentLibraryFilter
from .models import DocumentLibrary
from .serializers import DocumentLibrarySerializer

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB (CDC §7.4)
ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
}
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx"}


class DocumentLibraryViewSet(viewsets.ModelViewSet):
    """Document library. Metadata via PATCH; file fields are upload-only."""

    serializer_class = DocumentLibrarySerializer
    filterset_class = DocumentLibraryFilter
    ordering_fields = ("file_name", "version", "file_size_bytes", "category", "created_at")
    ordering = ("category", "display_order")
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        qs = DocumentLibrary.objects.select_related("product").all()
        # The list defaults to active (non-soft-deleted) rows unless the caller
        # explicitly filters on is_active.
        if self.action == "list" and self.request.query_params.get("is_active") is None:
            qs = qs.filter(is_active=True)
        return qs

    # ─── DELETE → soft delete (CDC §7.4) ──────────────────────────────
    def destroy(self, request, *args, **kwargs):
        doc = self.get_object()
        doc.is_active = False
        doc.deleted_at = timezone.now()
        doc.save(update_fields=["is_active", "deleted_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ─── /upload (multipart) ──────────────────────────────────────────
    @action(
        detail=False,
        methods=["post"],
        parser_classes=[parsers.MultiPartParser, parsers.FormParser],
        url_path="upload",
    )
    def upload(self, request):
        """Validate + store a file, with auto-versioning by (product, language, name)."""
        file = request.FILES.get("file")
        if not file:
            return Response(
                {"detail": "Un fichier est requis."}, status=status.HTTP_400_BAD_REQUEST
            )
        if file.size > MAX_UPLOAD_BYTES:
            return Response(
                {"detail": "Fichier trop volumineux (max 20 Mo)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mime = file.content_type or mimetypes.guess_type(file.name)[0] or ""
        ext = os.path.splitext(file.name)[1].lower()
        if mime not in ALLOWED_MIME and ext not in ALLOWED_EXT:
            return Response(
                {"detail": "Format non accepté (PDF, JPG, PNG, DOCX, XLSX)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        category = request.data.get("category") or "other"
        language = request.data.get("language") or ""
        description = request.data.get("description") or ""
        product_id = request.data.get("product") or None
        name = _safe_json(request.data.get("name"), fallback={"fr": file.name})

        # Versioning: same (product, language, file_name) → bump version.
        siblings = DocumentLibrary.objects.filter(
            file_name=file.name, language=language, is_active=True
        )
        siblings = (
            siblings.filter(product_id=product_id)
            if product_id
            else siblings.filter(product__isnull=True)
        )
        top = siblings.aggregate(m=Max("version"))["m"]
        version = (top + 1) if top else 1

        stored_path = default_storage.save(f"documents/{uuid.uuid4()}/{file.name}", file)

        uploaded_by = ""
        if request.user.is_authenticated:
            uploaded_by = getattr(request.user, "email", "") or ""

        doc = DocumentLibrary.objects.create(
            name=name,
            category=category,
            file_url=stored_path,
            file_name=file.name,
            file_size_bytes=file.size,
            mime_type=mime,
            language=language,
            description=description,
            product_id=product_id,
            version=version,
            uploaded_by=uploaded_by,
        )
        return Response(DocumentLibrarySerializer(doc).data, status=status.HTTP_201_CREATED)

    # ─── /{id}/download ───────────────────────────────────────────────
    @action(detail=True, methods=["get"])
    @xframe_options_sameorigin
    def download(self, request, pk=None):
        """Stream the stored file (local). Prod: return a Supabase signed URL.

        ``?inline=1`` serves the file inline (for PDF / image preview) instead
        of forcing a download.

        ``@xframe_options_sameorigin`` overrides the site-wide
        ``X-Frame-Options: DENY`` for this response only, so the same-origin
        PDF/image preview can render inside an ``<iframe>`` (otherwise prod
        blocks the embed with ``ERR_BLOCKED_BY_RESPONSE``).
        """
        doc = self.get_object()
        if not doc.file_url or not default_storage.exists(doc.file_url):
            raise Http404("Fichier introuvable ou purgé.")
        inline = request.query_params.get("inline") in ("1", "true")
        return FileResponse(
            default_storage.open(doc.file_url, "rb"),
            as_attachment=not inline,
            filename=doc.file_name or "document",
            content_type=doc.mime_type or "application/octet-stream",
        )

    # ─── /{id}/versions ───────────────────────────────────────────────
    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        """Version chain of this document — same (product, language, file_name)."""
        doc = self.get_object()
        qs = DocumentLibrary.objects.filter(file_name=doc.file_name, language=doc.language)
        qs = (
            qs.filter(product_id=doc.product_id)
            if doc.product_id
            else qs.filter(product__isnull=True)
        )
        return Response(DocumentLibrarySerializer(qs.order_by("version"), many=True).data)


def _safe_json(maybe_json, *, fallback: dict) -> dict:
    """Parse a JSON string if possible, else wrap as {fr: <raw>}."""
    if isinstance(maybe_json, dict):
        return maybe_json
    try:
        parsed = json.loads(maybe_json)
        if isinstance(parsed, dict):
            return parsed
    except (TypeError, ValueError):
        pass
    return {"fr": str(maybe_json)} if maybe_json else fallback
