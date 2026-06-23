"""Document library — reusable attachments for project offers (CDC §7.4)."""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel, Language


class DocumentCategory(models.TextChoices):
    CGV = "cgv", "CGV — Conditions générales de vente"
    WARRANTY = "warranty", "Warranty"
    QUALITY = "quality", "Quality management"
    PROJECT_REFERENCE = "project_reference", "Project references"
    COMPANY = "company", "Company presentation"
    OTHER = "other", "Other"


class DocumentLibrary(BaseModel):
    name = models.JSONField(help_text="Multilingual label")
    category = models.CharField(max_length=32, choices=DocumentCategory.choices)
    # Storage path / URL of the stored file (local: MEDIA path; prod: Supabase).
    file_url = models.TextField()
    file_name = models.CharField(max_length=255, blank=True, default="")
    file_size_bytes = models.IntegerField(null=True, blank=True)
    mime_type = models.CharField(max_length=128, blank=True, default="")
    language = models.CharField(max_length=2, choices=Language.choices, blank=True, default="")
    description = models.TextField(blank=True, default="")
    # Optional link to a product (CDC §7.4). SET_NULL keeps the doc on delete.
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents",
    )
    # Versioning: a new upload sharing (product, language, file_name) bumps version.
    version = models.IntegerField(default=1)
    uploaded_by = models.EmailField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)
    # Soft-delete timestamp; the daily purge task hard-deletes after 30 days.
    deleted_at = models.DateTimeField(
        null=True, blank=True, help_text="Set on soft-delete; purged after 30 days."
    )

    class Meta:
        db_table = "document_library"
        ordering = ["category", "display_order"]
        indexes = [
            models.Index(fields=["category", "is_active"], name="idx_doc_cat_active"),
            models.Index(fields=["category", "language"], name="idx_doc_cat_lang"),
            models.Index(fields=["product"], name="idx_doc_product"),
            models.Index(fields=["deleted_at"], name="idx_doc_deleted_at"),
        ]

    def __str__(self) -> str:
        return f"{self.category} ({self.language or 'multi'}) v{self.version}"
