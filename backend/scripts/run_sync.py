"""Déclenche un sync produits + stock + clients et affiche le rapport."""

import os
import sys

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
sys.path.insert(0, "/app")
django.setup()

from apps.clients.models import Client
from apps.odoo_sync.models import SyncScope, SyncType
from apps.odoo_sync.services.runner import sync
from apps.products.models import Product

print("─" * 60)
print("SYNC PRODUCTS")
log = sync(scope=SyncScope.PRODUCTS, sync_type=SyncType.MANUAL, triggered_by="test")
print(f"  status  : {log.status}")
print(f"  created : {log.items_created}")
print(f"  updated : {log.items_updated}")
print(f"  failed  : {log.items_failed}")
if log.errors:
    for e in log.errors[:5]:
        print(f"  ⚠ {e}")

print()
print("─" * 60)
print("SYNC STOCK")
log2 = sync(scope=SyncScope.STOCK, sync_type=SyncType.MANUAL, triggered_by="test")
print(f"  status  : {log2.status}")
print(f"  updated : {log2.items_updated}")
print(f"  failed  : {log2.items_failed}")

print()
print("─" * 60)
print("SYNC CLIENTS")
log3 = sync(scope=SyncScope.CLIENTS, sync_type=SyncType.MANUAL, triggered_by="test")
print(f"  status  : {log3.status}")
print(f"  created : {log3.items_created}")
print(f"  updated : {log3.items_updated}")
print(f"  failed  : {log3.items_failed}")

print()
print("─" * 60)
print("RÉSULTAT EN BASE")
n_products = Product.objects.filter(odoo_id__isnull=False).count()
n_clients = Client.objects.filter(odoo_id__isnull=False).count()
sample = Product.objects.filter(odoo_id__isnull=False).order_by("sku_code")[:5]
print(f"  Produits synchro : {n_products}")
print(f"  Clients synchro  : {n_clients}")
print()
print("  Exemples produits :")
for p in sample:
    print(
        f"    {p.sku_code:<30} universe={p.universe!r:<20} pamp={p.pamp_eur} stock={p.stock_quantity}"
    )
