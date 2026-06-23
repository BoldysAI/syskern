"""Register the daily offer-expiration Celery Beat task at 08:00 UTC (CDC §7.5.4).

Auto-expires overdue `sent` offers and emails a J-7 alert. Editable from the
Django admin (django_celery_beat database scheduler); gated by the
EXPIRATION_CRON_ENABLED killswitch at task runtime.
"""

from django.db import migrations

SCHEDULE_NAME = "Daily offer expiration check (08:00 UTC)"
TASK_NAME = "offers.daily_expiration_check"


def create_schedule(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="0",
        hour="8",
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
        ("offers", "0002_offer_ai_arguments_offer_generation_error_and_more"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
