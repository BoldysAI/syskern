"""Register the stuck-generation reaper Celery Beat task (every 15 min).

Backstop for offers left in `generating` after a worker hard-kill, so the UI
stops polling forever (CDC §7.6.3). Editable from the Django admin
(django_celery_beat database scheduler).
"""

from django.db import migrations

SCHEDULE_NAME = "Reap stuck offer generations (every 15 min)"
TASK_NAME = "offers.reap_stuck_generations"


def create_schedule(apps, schema_editor):
    IntervalSchedule = apps.get_model("django_celery_beat", "IntervalSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    interval, _ = IntervalSchedule.objects.get_or_create(every=15, period="minutes")
    PeriodicTask.objects.update_or_create(
        name=SCHEDULE_NAME,
        defaults={"interval": interval, "task": TASK_NAME, "enabled": True},
    )


def remove_schedule(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=SCHEDULE_NAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("offers", "0004_offeralertconfig"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
