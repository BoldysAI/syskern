"""Measure how fast we can pull the full SKU catalog from v16."""
import os, time
import httpx

URL = os.environ["ODOO_V16_BASE_URL"].rstrip("/")
DB  = os.environ["ODOO_V16_DB_NAME"]
USER = os.environ["ODOO_V16_API_USER"]
KEY = os.environ["ODOO_V16_API_PASSWORD"]


def call(service, method, args):
    with httpx.Client(timeout=120.0) as c:
        r = c.post(f"{URL}/jsonrpc", json={
            "jsonrpc": "2.0", "method": "call",
            "params": {"service": service, "method": method, "args": args}})
        r.raise_for_status()
        body = r.json()
        if body.get("error"):
            raise RuntimeError(body["error"])
        return body["result"]


uid = call("common", "authenticate", [DB, USER, KEY, {}])
print(f"uid = {uid}")


def kw(model, method, args, kwargs=None):
    return call("object", "execute_kw", [DB, uid, KEY, model, method, args, kwargs or {}])


FIELDS = [
    "id", "name", "default_code", "categ_id", "barcode", "weight", "hs_code",
    "type", "active", "standard_price", "list_price",
    "description", "description_sale", "description_purchase",
    "uom_id", "seller_ids",
    "x_studio_num_dop_china", "x_studio_num_dop_trkiye", "x_studio_to_deliver",
]


for batch_size in [100, 500, 1000]:
    t0 = time.perf_counter()
    records = kw("product.template", "search_read", [[]],
                 {"fields": FIELDS, "limit": batch_size, "offset": 0})
    dt = time.perf_counter() - t0
    print(f"  search_read fields={len(FIELDS)} limit={batch_size:4d} -> {len(records):4d} rows in {dt:5.2f}s "
          f"({len(records)/dt:.0f} rows/s)")

print()
# Sequential paging to fetch everything
t0 = time.perf_counter()
all_records = []
offset = 0
while True:
    batch = kw("product.template", "search_read", [[]],
               {"fields": FIELDS, "limit": 500, "offset": offset})
    all_records += batch
    if len(batch) < 500:
        break
    offset += 500
dt = time.perf_counter() - t0
print(f"FULL PULL: {len(all_records)} rows in {dt:.2f}s ({len(all_records)/dt:.0f} rows/s)")
