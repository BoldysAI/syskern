from django.contrib import admin

from .models import DocumentLibrary


@admin.register(DocumentLibrary)
class DocumentLibraryAdmin(admin.ModelAdmin):
    list_display = ("category", "language", "is_active", "display_order", "created_at")
    list_filter = ("category", "language", "is_active")
    search_fields = ("description",)
