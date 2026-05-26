"""Vérifie la qualité des données synchros en base."""
import os, sys, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
sys.path.insert(0, "/app")
django.setup()

from apps.products.models import Product, ProductSupplier
from apps.clients.models import Client

# ── Stats générales ──────────────────────────────────────────────────────
total = Product.objects.filter(odoo_id__isnull=False).count()
with_universe = Product.objects.filter(odoo_id__isnull=False).exclude(universe="").count()
with_supplier = Product.objects.filter(odoo_id__isnull=False, suppliers__is_active=True).distinct().count()
with_pamp     = Product.objects.filter(odoo_id__isnull=False, pamp_eur__gt=0).count()
with_stock    = Product.objects.filter(odoo_id__isnull=False, stock_quantity__gt=0).count()

print("── Produits ─────────────────────────────────────────────────────")
print(f"  Total synchro       : {total}")
print(f"  Avec univers        : {with_universe}  ({100*with_universe//total}%)")
print(f"  Avec fournisseur    : {with_supplier}  ({100*with_supplier//total}%)")
print(f"  Avec PAMP > 0       : {with_pamp}  ({100*with_pamp//total}%)")
print(f"  Avec stock > 0      : {with_stock}  ({100*with_stock//total}%)")

# ── Breakdown par univers ────────────────────────────────────────────────
from django.db.models import Count
by_universe = (
    Product.objects.filter(odoo_id__isnull=False)
    .values("universe")
    .annotate(n=Count("id"))
    .order_by("-n")
)
print()
print("── Par univers ──────────────────────────────────────────────────")
for row in by_universe[:10]:
    u = row["universe"] or "(racine — categ All)"
    print(f"  {u:<40} {row['n']:>4}")

# ── Exemples avec données ────────────────────────────────────────────────
print()
print("── Exemples produits avec PAMP + stock ──────────────────────────")
sample = Product.objects.filter(odoo_id__isnull=False, pamp_eur__gt=0).order_by("-pamp_eur")[:5]
for p in sample:
    s = ProductSupplier.objects.filter(product=p, is_active=True).first()
    sup = s.supplier_name if s else "—"
    print(f"  {p.sku_code:<30} universe={p.universe:<15} pamp={p.pamp_eur} fournisseur={sup}")

# ── Clients ─────────────────────────────────────────────────────────────
print()
print("── Clients ──────────────────────────────────────────────────────")
n_clients = Client.objects.filter(odoo_id__isnull=False).count()
print(f"  Total synchro : {n_clients}")
for c in Client.objects.filter(odoo_id__isnull=False)[:5]:
    print(f"  [{c.odoo_id}] {c.name} — {c.address_country}")

# ── Probe: combien de res.partner avec customer_rank > 0 dans v19 ? ──────
print()
print("── Probe v19 customer_rank > 0 ──────────────────────────────────")
import httpx
from django.conf import settings
cfg = settings.ODOO
url  = cfg["BASE_URL"].rstrip("/")
db   = cfg["DB_NAME"]
user = cfg["API_USER"]
pwd  = cfg["API_PASSWORD"]
with httpx.Client(verify=False, timeout=30) as c:
    r = c.post(url + "/jsonrpc", json={"jsonrpc":"2.0","method":"call","params":{
        "service":"common","method":"login","args":[db,user,pwd]}})
    uid = r.json()["result"]
    r2 = c.post(url + "/jsonrpc", json={"jsonrpc":"2.0","method":"call","params":{
        "service":"object","method":"execute_kw","args":[db,uid,pwd,
        "res.partner","search_count",[[["customer_rank",">",0]]],{}]}})
    count = r2.json().get("result",0)
    print(f"  res.partner avec customer_rank > 0 : {count}")
