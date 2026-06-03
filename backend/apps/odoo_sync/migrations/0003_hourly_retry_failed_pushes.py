"""Periodic task: every hour, re-dispatch the platform → Odoo push
for products stuck in pending or failed sync (CDC §5.4.3 + §5.5).

Idempotent: relies on django-celery-beat update_or_create.
"""
from django.db import migrations


SCHEDULE_NAME = "Hourly retry of failed Odoo product pushes"
TASK_NAME = "odoo_sync.retry_failed_product_pushes"


def create_schedule(apps, schema_editor):
    IntervalSchedule = apps.get_model("django_celery_beat", "IntervalSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    interval, _ = IntervalSchedule.objects.get_or_create(
        every=1,
        period="hours",
    )

    PeriodicTask.objects.update_or_create(
        name=SCHEDULE_NAME,
        defaults={
            "interval": interval,
            "task": TASK_NAME,
            "kwargs": "{}",
            "enabled": True,
        },
    )


def remove_schedule(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=SCHEDULE_NAME).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("odoo_sync", "0002_daily_sync_periodic_task"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
