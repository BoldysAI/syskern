"""Les tâches planifiées doivent être réellement exécutables (CDC §5.4.1).

Régression réelle (2026-07-27) : la sync Odoo quotidienne était enregistrée avec
`"sync_type": "scheduled"`, valeur absente de l'enum `SyncType`. Beat la
déclenchait, le worker la recevait, et elle levait `ValueError` **avant** la
création du `SyncLog` — donc une panne totalement invisible dans l'UI de
synchronisation. Elle n'a jamais tourné depuis sa création.

Ces tests valident les kwargs figés en base par les migrations, pas seulement le
code des tâches : c'est le raccord entre les deux qui avait cédé.
"""

from __future__ import annotations

import json

import pytest
from django_celery_beat.models import PeriodicTask

from apps.odoo_sync.models import SyncScope, SyncType

pytestmark = pytest.mark.django_db

DAILY_SYNC = "Daily Odoo full sync (03:00 UTC)"


def test_daily_sync_is_registered_and_enabled():
    task = PeriodicTask.objects.filter(name=DAILY_SYNC).first()
    assert task is not None, "la sync quotidienne n'est pas enregistrée"
    assert task.task == "odoo_sync.sync_task"
    assert task.enabled


def test_daily_sync_kwargs_are_valid_enum_values():
    """Le cœur du bug : les kwargs doivent passer les constructeurs d'enum."""
    task = PeriodicTask.objects.get(name=DAILY_SYNC)
    kwargs = json.loads(task.kwargs or "{}")

    # Lèverait ValueError sur l'ancienne valeur "scheduled".
    assert SyncType(kwargs["sync_type"]) == SyncType.AUTO_DAILY
    assert SyncScope(kwargs["scope"]) == SyncScope.ALL


def test_every_scheduled_task_has_json_kwargs():
    """Aucune tâche beat ne doit porter de kwargs illisibles."""
    for task in PeriodicTask.objects.all():
        json.loads(task.kwargs or "{}")  # ne doit pas lever
        json.loads(task.args or "[]")


def test_daily_sync_actually_reaches_the_runner(monkeypatch):
    """Bout en bout : les kwargs figés en base doivent traverser `sync_task`.

    Le runner est bouchonné (pas d'appel Odoo) ; ce qu'on vérifie, c'est que la
    conversion des kwargs en enums n'explose pas.
    """
    from apps.odoo_sync import tasks

    captured: dict = {}

    def _fake_sync(*, scope, sync_type, triggered_by, api_version=None):
        captured.update({"scope": scope, "sync_type": sync_type, "triggered_by": triggered_by})

        class _Log:
            pass

        return _Log()

    monkeypatch.setattr(tasks, "sync", _fake_sync)
    monkeypatch.setattr(tasks, "SyncLogSerializer", lambda log: type("S", (), {"data": {}})())

    kwargs = json.loads(PeriodicTask.objects.get(name=DAILY_SYNC).kwargs)
    tasks.sync_task(**kwargs)

    assert captured["sync_type"] == SyncType.AUTO_DAILY
    assert captured["scope"] == SyncScope.ALL
    assert captured["triggered_by"] == "celery-beat"
