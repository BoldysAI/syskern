# Expose the Celery app at the package level so it is initialised when
# Django starts. Tasks use the @shared_task decorator and bind to this app
# via autodiscover_tasks() (see config/celery.py).
from .celery import app as celery_app

__all__ = ("celery_app",)
