"""Shared services for the Fournisseurs module (Épic FEEDBACK 1)."""

from __future__ import annotations

import re
from decimal import Decimal

from apps.products.models import (
    PriceChangeSource,
    ProductSupplier,
    SupplierPriceHistory,
)

from .models import Supplier

_PO_QUANTUM = Decimal("0.0001")
_HUNDRED = Decimal("100")


def _unique_supplier_code(name: str) -> str:
    """Derive a unique `Supplier.code` from a display name."""
    base = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper()[:56] or "SUP"
    code = base
    counter = 2
    while Supplier.objects.filter(code=code).exists():
        code = f"{base}-{counter}"[:64]
        counter += 1
    return code


def apply_bulk_po(links: list[ProductSupplier], *, mode: str, value: Decimal) -> tuple[int, int]:
    """Apply a batch PO base-price change to ``links`` (in-app wizard).

    ``mode`` ∈ {``set``, ``pct``, ``abs``}. Returns ``(updated, skipped)``. Each
    applied change writes a ``SupplierPriceHistory`` entry (source=manual). Prices
    never go negative (clamped to 0). Money stays ``Decimal`` (AGENTS §5.1).
    """
    updated = 0
    skipped = 0
    for link in links:
        old = link.po_base_price
        if mode == "set":
            new = value
        elif old is None:
            skipped += 1
            continue
        elif mode == "pct":
            new = old * (Decimal(1) + value / _HUNDRED)
        else:  # abs
            new = old + value

        new = new.quantize(_PO_QUANTUM)
        if new < 0:
            new = Decimal("0").quantize(_PO_QUANTUM)
        if new == old:
            skipped += 1
            continue

        link.po_base_price = new
        link.save(update_fields=["po_base_price", "updated_at"])
        # A wizard edit is a manual action (not an Excel import).
        record_po_change(link, old_price=old, new_price=new, source=PriceChangeSource.MANUAL)
        updated += 1
    return updated, skipped


def bulk_link_skus(supplier: Supplier, product_ids: list) -> tuple[int, int]:
    """Link several existing products to ``supplier`` (catalog picker).

    Creates a ``ProductSupplier`` pre-filled with the supplier defaults for each
    product not already linked. Returns ``(created, skipped)``. Never creates a
    product (matching by existing id only).
    """
    from apps.products.models import Product

    already = set(
        ProductSupplier.objects.filter(supplier=supplier, product_id__in=product_ids).values_list(
            "product_id", flat=True
        )
    )
    products = Product.objects.filter(id__in=product_ids).exclude(id__in=already)

    created = 0
    for product in products:
        ProductSupplier.objects.create(
            product=product,
            supplier=supplier,
            supplier_name=supplier.name,
            factory_code=supplier.factory_code_default,
            po_currency=supplier.currency_default,
            incoterm=supplier.incoterm_default,
            incoterm_location=supplier.location,
            is_active=False,
        )
        created += 1
    skipped = len(set(map(str, product_ids))) - created
    return created, max(skipped, 0)


def get_or_create_supplier_by_name(name: str, *, defaults: dict | None = None) -> Supplier:
    """Return the `Supplier` matching ``name`` (case-insensitive), creating it if
    absent. Used by the Odoo sync so a supplier seen first via Odoo still becomes
    a managed entity. Defaults only apply on creation."""
    cleaned = (name or "").strip()
    supplier = Supplier.objects.filter(name__iexact=cleaned).first()
    if supplier is not None:
        return supplier
    return Supplier.objects.create(
        name=cleaned,
        code=_unique_supplier_code(cleaned),
        **(defaults or {}),
    )


def record_po_change(
    link: ProductSupplier,
    *,
    old_price: Decimal | None,
    new_price: Decimal | None,
    source: str,
) -> SupplierPriceHistory | None:
    """Append a `SupplierPriceHistory` row when a link's PO base price changed.

    No-op when the value is unchanged so the trail stays meaningful.
    Money stays `Decimal` (AGENTS §5.1). `source` ∈ `PriceChangeSource`.
    """
    if old_price == new_price:
        return None
    return SupplierPriceHistory.objects.create(
        product_supplier=link,
        old_po_base_price=old_price,
        new_po_base_price=new_price,
        po_currency=link.po_currency,
        source=source or PriceChangeSource.MANUAL,
    )
