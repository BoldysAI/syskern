"""Register the daily document-purge Celery Beat task at 04:00 UTC (CDC §7.4).

Hard-deletes soft-deleted documents older than 30 days. Editable from the Django
admin (django_celery_beat database scheduler).
"""

from django.db import migrations

SCHEDULE_NAME = "Daily document purge (04:00 UTC)"
TASK_NAME = "documents.purge_deleted_documents"


def create_schedule(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="0",
        hour="4",
        day_of_week="*",
        day_of_month="*",
        month_of_year="*",
        timezone="UTC",
    )
    PeriodicTask.objects.update_or_create(
        name=SCHEDULE_NAME,
        defaults={"crontab": crontab, "task": TASK_NAME, "enabled": True},
    )


def remove_schedule(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=SCHEDULE_NAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("documents", "0002_documentlibrary_deleted_at_documentlibrary_file_name_and_more"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
