"""Re-backfill `ProductSupplier.supplier` from the denormalised `supplier_name`.

The one-time backfill (0007) ran at deploy, but `bootstrap_catalog --purge`
deletes + re-creates the product-supplier links afterwards, and the Excel PO
loader used to set only `supplier_name` (not the FK) — so re-bootstrapped links
came back with a NULL FK. That made the suppliers-list `linked_skus_count`
(FK-based) wrong and the delete guard unsafe, while the detail (name-based)
still showed the products. The loader now sets the FK; this migration repairs
the existing rows. Idempotent — only touches links whose FK is still NULL.
"""

from __future__ import annotations

import re

from django.db import migrations


def _slug_code(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper()[:56] or "SUP"
    code = base
    counter = 2
    while code in taken:
        code = f"{base}-{counter}"[:64]
        counter += 1
    taken.add(code)
    return code


def rebackfill_supplier_fk(apps, schema_editor):
    ProductSupplier = apps.get_model("products", "ProductSupplier")
    Supplier = apps.get_model("suppliers", "Supplier")

    taken_codes: set[str] = set(Supplier.objects.values_list("code", flat=True))
    names = (
        ProductSupplier.objects.filter(supplier__isnull=True)
        .exclude(supplier_name="")
        .exclude(supplier_name__isnull=True)
        .values_list("supplier_name", flat=True)
        .distinct()
    )
    for name in names:
        cleaned = (name or "").strip()
        if not cleaned:
            continue
        supplier = Supplier.objects.filter(name__iexact=cleaned).first()
        if supplier is None:
            latest = (
                ProductSupplier.objects.filter(supplier_name=cleaned)
                .order_by("-updated_at")
                .first()
            )
            supplier = Supplier.objects.create(
                name=cleaned,
                code=_slug_code(cleaned, taken_codes),
                factory_code_default=(latest.factory_code if latest else "") or "",
                currency_default=(latest.po_currency if latest else "RMB") or "RMB",
                incoterm_default=(latest.incoterm if latest else "") or "",
                location=(latest.incoterm_location if latest else "") or "",
                is_active=True,
            )
        ProductSupplier.objects.filter(supplier_name=cleaned, supplier__isnull=True).update(
            supplier=supplier
        )


class Migration(migrations.Migration):
    dependencies = [
        ("products", "0007_backfill_suppliers"),
        ("suppliers", "0003_supplierimportmapping_header_row"),
    ]

    operations = [
        migrations.RunPython(rebackfill_supplier_fk, migrations.RunPython.noop),
    ]
