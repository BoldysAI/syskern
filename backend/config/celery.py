"""Celery entry point.

Periodic jobs (daily Odoo sync, offer expiration sweep, backup tee) are
registered through `apps.<app>.tasks` modules and Celery Beat schedules.
"""
from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

app = Celery("syskern")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.task(bind=True)
def debug_task(self) -> None:
    print(f"Request: {self.request!r}")
