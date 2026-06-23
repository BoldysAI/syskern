"""Register a periodic Celery task that triggers a full Odoo sync every
day at 03:00 UTC (CDC §5.4.2 — daily nightly sync).

Uses django_celery_beat's database scheduler so the schedule is editable
from the Django admin without a code change.
"""

from django.db import migrations

SCHEDULE_NAME = "Daily Odoo full sync (03:00 UTC)"
TASK_NAME = "odoo_sync.sync_task"


def create_schedule(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="0",
        hour="3",
        day_of_week="*",
        day_of_month="*",
        month_of_year="*",
        timezone="UTC",
    )

    PeriodicTask.objects.update_or_create(
        name=SCHEDULE_NAME,
        defaults={
            "crontab": crontab,
            "task": TASK_NAME,
            # SyncScope.ALL keyword
            "kwargs": '{"scope": "all", "sync_type": "scheduled", "triggered_by": "celery-beat"}',
            "enabled": True,
        },
    )


def remove_schedule(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=SCHEDULE_NAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("odoo_sync", "0001_initial"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
