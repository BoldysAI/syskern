"""Inspect purchase.order.line states + res.partner customer/supplier
flags, so we can decide what to filter in the adapter."""
import os
import httpx

URL = os.environ["ODOO_V16_BASE_URL"].rstrip("/")
DB  = os.environ["ODOO_V16_DB_NAME"]
USER = os.environ["ODOO_V16_API_USER"]
KEY = os.environ["ODOO_V16_API_PASSWORD"]

def call(service, method, args):
    with httpx.Client(timeout=60.0) as c:
        r = c.post(f"{URL}/jsonrpc",
                   json={"jsonrpc":"2.0","method":"call",
                         "params":{"service":service,"method":method,"args":args}})
        r.raise_for_status()
        body = r.json()
        if body.get("error"):
            raise RuntimeError(body["error"])
        return body["result"]

uid = call("common", "authenticate", [DB, USER, KEY, {}])
def kw(m,meth,a,k=None): return call("object","execute_kw",[DB,uid,KEY,m,meth,a,k or {}])

# ─── purchase.order.line + parent state ────────────────────────────
print("─── purchase.order states distribution ───")
all_orders = kw("purchase.order", "search_read", [[]], {"fields": ["state"]})
from collections import Counter
print(Counter(o["state"] for o in all_orders).most_common())

print()
print("─── First purchase.order.line with all fields ───")
fields_po_line = list(kw("purchase.order.line", "fields_get", [], {"attributes":[]}).keys())
print(f"total fields: {len(fields_po_line)}")
key_fields = [f for f in fields_po_line if any(k in f for k in [
    "product", "qty", "price", "currency", "date_planned", "order_id", "state", "received", "invoiced"
])]
print(f"key fields: {key_fields}")

samples = kw("purchase.order.line", "search_read", [[]], {"fields": key_fields, "limit": 3})
for s in samples:
    print()
    for k, v in s.items():
        print(f"    {k:24s} = {repr(v)[:90]}")

# ─── res.partner profile breakdown ─────────────────────────────────
print()
print("─── res.partner customer/supplier breakdown ───")
all_partners = kw("res.partner", "search_read", [[]], {
    "fields": ["id", "name", "customer_rank", "supplier_rank", "is_company", "country_id"]
})
buckets = Counter()
for p in all_partners:
    cust = (p.get("customer_rank") or 0) > 0
    supp = (p.get("supplier_rank") or 0) > 0
    if cust and supp: buckets["both"] += 1
    elif cust: buckets["customer_only"] += 1
    elif supp: buckets["supplier_only"] += 1
    else: buckets["neither"] += 1
print(f"  {dict(buckets)}")
print()
print("─── Sample customers (customer_rank > 0) ───")
for p in [x for x in all_partners if (x.get("customer_rank") or 0) > 0][:5]:
    print(f"  id={p['id']:4d}  name={p.get('name'):40s}  country={p.get('country_id')}")

print()
print("─── Sample suppliers (supplier_rank > 0) ───")
for p in [x for x in all_partners if (x.get("supplier_rank") or 0) > 0][:5]:
    print(f"  id={p['id']:4d}  name={p.get('name'):40s}  country={p.get('country_id')}")
