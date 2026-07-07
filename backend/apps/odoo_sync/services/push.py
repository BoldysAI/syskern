"""Push a platform product to Odoo (CDC §5.3, §5.4.3).

Shared by ``ProductViewSet`` (wizard create/update) **and** the quarantine
resolution, so both close the same loop: create locally → create in Odoo →
the next sync links it back by ``odoo_id``. Keeping one entry point means the
two creation paths can never diverge again.
"""

from __future__ import annotations

from django.conf import settings

from apps.products.models import Product


def push_product_async(product: Product) -> None:
    """Mark the product ``pending_odoo_sync`` and dispatch the push task.

    Fire-and-forget: the status is set immediately so the hourly retry job
    catches the row if the worker drops the message; the task itself records
    failures (status → ``sync_failed`` + error) and retries automatically.
    """
    from apps.odoo_sync.tasks import push_product_task

    Product.objects.filter(pk=product.pk).update(
        odoo_sync_status="pending_odoo_sync",
        odoo_sync_error="",
    )
    api_version = (settings.ODOO.get("API_VERSION") or "v19").lower()
    push_product_task.delay(str(product.pk), api_version=api_version)
