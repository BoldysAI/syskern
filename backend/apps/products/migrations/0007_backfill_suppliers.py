"""Backfill the `suppliers` table from the free-text `product_suppliers.supplier_name`.

Module Fournisseurs (Épic FEEDBACK 1). Extracts a clean `Supplier` entity from
the denormalised supplier names carried on each product-supplier link, and points
`ProductSupplier.supplier` at the matching row. Defaults are derived from the most
recently updated link of each name. Reverse detaches the FK and removes the rows.
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


def backfill_suppliers(apps, schema_editor):
    ProductSupplier = apps.get_model("products", "ProductSupplier")
    Supplier = apps.get_model("suppliers", "Supplier")

    names = (
        ProductSupplier.objects.exclude(supplier_name="")
        .exclude(supplier_name__isnull=True)
        .values_list("supplier_name", flat=True)
        .distinct()
    )

    taken_codes: set[str] = set(Supplier.objects.values_list("code", flat=True))
    for name in names:
        cleaned = (name or "").strip()
        if not cleaned:
            continue
        # A supplier may already exist (idempotent re-run / partial migration).
        supplier = Supplier.objects.filter(name=cleaned).first()
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


def unlink_suppliers(apps, schema_editor):
    ProductSupplier = apps.get_model("products", "ProductSupplier")
    Supplier = apps.get_model("suppliers", "Supplier")
    ProductSupplier.objects.update(supplier=None)
    Supplier.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("products", "0006_supplierpricehistory_productsupplier_supplier_and_more"),
        ("suppliers", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(backfill_suppliers, unlink_suppliers),
    ]
