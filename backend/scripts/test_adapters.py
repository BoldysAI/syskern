"""Smoke-test the real OdooAdapterV16 and OdooAdapterV19 against staging.

Run via:
  docker compose run --rm backend python /app/scripts/test_adapters.py

All operations are READ-ONLY.  No writes happen.
"""
import os, sys, django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
sys.path.insert(0, "/app")
django.setup()

from apps.odoo_sync.adapters.v16 import OdooAdapterV16
from apps.odoo_sync.adapters.v19 import OdooAdapterV19


def banner(msg):
    print(f"\n{'─'*60}")
    print(f"  {msg}")
    print(f"{'─'*60}")


def _run_adapter_test(label: str, adapter):
    banner(f"{label}")

    # ── auth ────────────────────────────────────────────────────
    adapter.authenticate()
    print(f"  ✓ auth  uid={adapter._uid}")

    # ── list_products (first 5) ─────────────────────────────────
    products = adapter.list_products(limit=5)
    print(f"  ✓ list_products → {len(products)} records")
    for p in products[:3]:
        print(f"    id={p.odoo_id}  sku={p.sku_code!r:<30}  "
              f"universe={p.universe!r}  suppliers={len(p.suppliers)}")

    if not products:
        print("  ! No products returned — skipping downstream tests")
        return

    # ── get_product (single) ────────────────────────────────────
    first = products[0]
    detail = adapter.get_product(first.odoo_id)
    print(f"  ✓ get_product id={detail.odoo_id}  weight={detail.weight_kg}  "
          f"price_eur={detail.standard_price_eur}")

    # ── stock ───────────────────────────────────────────────────
    ids = [p.odoo_id for p in products]
    stock = adapter.get_stock_quantities(ids)
    print(f"  ✓ get_stock_quantities → {len(stock)} entries")
    for tid, s in list(stock.items())[:3]:
        print(f"    tmpl={tid}  qty={s.quantity}  avail={s.available_quantity}")

    # ── pending purchases ───────────────────────────────────────
    pending = adapter.get_pending_purchases(ids)
    total_lines = sum(len(v) for v in pending.values())
    print(f"  ✓ get_pending_purchases → {total_lines} pending lines across {len(ids)} products")

    # ── clients ─────────────────────────────────────────────────
    clients = adapter.list_clients(limit=5)
    print(f"  ✓ list_clients → {len(clients)} records")
    for c in clients[:3]:
        print(f"    id={c.odoo_id}  name={c.name!r}  country={c.address_country!r}")

    print(f"\n  ✅  {label} PASSED")


# ── V16 ──────────────────────────────────────────────────────────────────────

v16 = OdooAdapterV16(
    base_url=os.environ["ODOO_V16_BASE_URL"],
    db_name=os.environ["ODOO_V16_DB_NAME"],
    user=os.environ["ODOO_V16_API_USER"],
    password=os.environ["ODOO_V16_API_PASSWORD"],
    timeout=60.0,
    verify_tls=True,
)

# ── V19 ──────────────────────────────────────────────────────────────────────

v19 = OdooAdapterV19(
    base_url=os.environ["ODOO_V19_BASE_URL"].strip(),
    db_name=os.environ["ODOO_V19_DB_NAME"],
    user=os.environ["ODOO_V19_API_USER"],
    password=os.environ["ODOO_V19_API_PASSWORD"],
    timeout=60.0,
    verify_tls=os.environ.get("ODOO_V19_VERIFY_TLS", "true").lower() not in ("false", "0"),
)

errors = []
for label, adapter in [("OdooAdapterV16", v16), ("OdooAdapterV19", v19)]:
    try:
        _run_adapter_test(label, adapter)
    except Exception as exc:
        errors.append((label, exc))
        print(f"\n  ✗ {label} FAILED: {exc}")

print()
if errors:
    print(f"{'='*60}")
    print(f"  FAILURES: {len(errors)}")
    for label, exc in errors:
        print(f"  • {label}: {exc}")
    sys.exit(1)
else:
    print(f"{'='*60}")
    print("  ALL ADAPTERS PASSED ✅")
