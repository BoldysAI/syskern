from django.apps import AppConfig


class DataMigrationConfig(AppConfig):
    name = "apps.data_migration"
    verbose_name = "Initial data migration"
    default_auto_field = "django.db.models.BigAutoField"
