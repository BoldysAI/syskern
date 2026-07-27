"""Réparer les kwargs de la sync quotidienne — `sync_type` était invalide.

La migration `0002` enregistrait la tâche beat avec `"sync_type": "scheduled"`,
valeur **absente de l'enum `SyncType`** (`auto_daily` / `manual` / `on_demand`).
`sync_task` fait `SyncType(sync_type)` → `ValueError: 'scheduled' is not a valid
SyncType`, levée avant la moindre écriture.

Conséquence : la sync Odoo quotidienne (CDC §5.4.1) **n'a jamais tourné** depuis
sa création. Beat la déclenchait bien, le worker la recevait, elle plantait —
et comme l'exception survient avant la création du `SyncLog`, rien n'apparaissait
dans l'historique de synchronisation : panne totalement silencieuse côté UI.

Idempotent : réécrit les kwargs de la tâche existante, sans toucher au planning
ni à l'état `enabled` (un opérateur a pu la désactiver volontairement).
"""

from __future__ import annotations

import json

from django.db import migrations

SCHEDULE_NAME = "Daily Odoo full sync (03:00 UTC)"
GOOD_KWARGS = {"scope": "all", "sync_type": "auto_daily", "triggered_by": "celery-beat"}


def fix_kwargs(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    for task in PeriodicTask.objects.filter(name=SCHEDULE_NAME):
        try:
            current = json.loads(task.kwargs or "{}")
        except json.JSONDecodeError:
            current = {}
        # Ne réécrit que le champ fautif : un scope ajusté à la main est préservé.
        current["sync_type"] = "auto_daily"
        current.setdefault("scope", "all")
        current.setdefault("triggered_by", "celery-beat")
        task.kwargs = json.dumps(current)
        task.save(update_fields=["kwargs"])


def restore_broken_kwargs(apps, schema_editor):
    """Reverse : remet la valeur d'origine (cassée) pour rester fidèle à 0002."""
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=SCHEDULE_NAME).update(
        kwargs='{"scope": "all", "sync_type": "scheduled", "triggered_by": "celery-beat"}'
    )


class Migration(migrations.Migration):
    dependencies = [
        ("odoo_sync", "0003_hourly_retry_failed_pushes"),
    ]

    operations = [
        migrations.RunPython(fix_kwargs, restore_broken_kwargs),
    ]
