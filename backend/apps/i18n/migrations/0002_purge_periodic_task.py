"""Register the daily translation-cache purge Celery Beat task (CDC §10.4.3).

Deletes expired ``TranslationCache`` rows at 03:30 UTC. Editable from the Django
admin (django_celery_beat database scheduler).
"""

from django.db import migrations

SCHEDULE_NAME = "Daily translation cache purge (03:30 UTC)"
TASK_NAME = "i18n.purge_translation_cache"


def create_schedule(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="30",
        hour="3",
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
        ("app_i18n", "0001_initial"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
