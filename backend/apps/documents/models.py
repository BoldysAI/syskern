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
    file_url = models.TextField()  # Supabase Storage URL
    file_size_bytes = models.IntegerField(null=True, blank=True)
    mime_type = models.CharField(max_length=128, blank=True, default="")
    language = models.CharField(
        max_length=2, choices=Language.choices, blank=True, default=""
    )
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)

    class Meta:
        db_table = "document_library"
        ordering = ["category", "display_order"]
        indexes = [
            models.Index(fields=["category", "is_active"], name="idx_doc_cat_active"),
        ]

    def __str__(self) -> str:
        return f"{self.category} ({self.language or 'multi'})"
