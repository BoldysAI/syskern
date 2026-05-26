"""Look at a real SKU end-to-end — descriptions, custom fields, supplier,
stock — to finalise the field mapping doc.
"""
import os, json
import httpx

URL = os.environ["ODOO_V16_BASE_URL"].rstrip("/")
DB  = os.environ["ODOO_V16_DB_NAME"]
USER = os.environ["ODOO_V16_API_USER"]
KEY = os.environ["ODOO_V16_API_PASSWORD"]

def call(service, method, args):
    with httpx.Client(timeout=60.0) as c:
        r = c.post(f"{URL}/jsonrpc", json={
            "jsonrpc":"2.0","method":"call",
            "params":{"service":service,"method":method,"args":args}})
        r.raise_for_status()
        body = r.json()
        if body.get("error"):
            raise RuntimeError(body["error"])
        return body["result"]

uid = call("common", "authenticate", [DB, USER, KEY, {}])
print(f"uid = {uid}")

def kw(model, method, args, kwargs=None):
    return call("object", "execute_kw", [DB, uid, KEY, model, method, args, kwargs or {}])

# Pick the first 3 real *storable* products (type='product') with a non-empty seller.
ids = kw("product.template", "search",
         [[("type", "=", "product"), ("seller_ids", "!=", False)]],
         {"limit": 5})
print(f"product ids: {ids}")

all_fields = sorted(kw("product.template", "fields_get", [], {"attributes": []}).keys())
print(f"\ntotal fields on product.template: {len(all_fields)}")

# Show interesting fields including any candidates for HS / copper / weight
interesting = [f for f in all_fields if any(k in f.lower() for k in [
    "hs", "barcode", "copper", "weight", "default_code", "description",
    "categ", "name", "type", "list", "standard", "active", "uom", "dop", "x_studio",
])]
print(f"\nfields probed: {interesting}\n")

records = kw("product.template", "read", [ids], {"fields": interesting + ["seller_ids", "id"]})
for r in records:
    print("\n──", r["id"], r.get("name"), "──")
    for k, v in r.items():
        s = repr(v)[:140]
        print(f"  {k:30s} = {s}")

# Look at the seller for the first product.
if records and records[0].get("seller_ids"):
    sid = records[0]["seller_ids"][0]
    si = kw("product.supplierinfo", "read", [[sid]], {})
    print("\n── product.supplierinfo (full record) ──")
    for k, v in si[0].items():
        s = repr(v)[:140]
        print(f"  {k:30s} = {s}")

# How many storable products are there in total?
n_storable = kw("product.template", "search_count", [[("type", "=", "product")]])
n_service = kw("product.template", "search_count", [[("type", "=", "service")]])
print(f"\nstorable products: {n_storable}  service products: {n_service}")
