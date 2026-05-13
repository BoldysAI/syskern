from django.contrib import admin

from .models import MigrationUnmatched


@admin.register(MigrationUnmatched)
class MigrationUnmatchedAdmin(admin.ModelAdmin):
    list_display = ("source_file", "source_row_number", "reason", "resolved_at", "resolved_by")
    list_filter = ("source_file", "reason", "resolved_at")
    search_fields = ("source_file", "resolution_notes")
    readonly_fields = ("created_at", "updated_at", "raw_data")
