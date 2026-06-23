"""Step 4 — automatic derivations and validation (CDC §8.4 étape 4, §8.5).

Run once after the raw rows are loaded (Odoo sync + Excel enrichment + hors-Odoo
creation). Two responsibilities:

* :func:`apply_derivations` — compute the fields that are *derivable* from the
  already-imported data (CDC §8.5 table): ``factory_code`` and
  ``parent_reference`` from the SKU, ``is_copper_indexed`` from the copper
  weight, ``base_unit`` for cables. ``pamp_eur`` and ``is_active`` are NOT
  derived here — they come straight from the Odoo sync.

* :func:`validate_products` — flag the coherence anomalies listed in CDC §8.4
  step 4 into the quarantine table for Olivier to arbitrate. The migration
  never auto-corrects: it reports.

Both functions are **idempotent** — re-running them on the same data yields the
same DB state (required by the "rejeu intégral → résultat identique" acceptance
criterion). ``apply_derivations`` only fills empty ``factory_code`` /
``parent_reference`` (never clobbers) and recomputes the pure-function fields;
``validate_products`` clears its own prior quarantine rows before re-logging.
"""

from __future__ import annotations

import logging
import unicodedata

from apps.products.models import BaseUnit, Product, ProductSupplier
from apps.products.services.sku_parser import extract_factory_code, extract_parent_reference

from .models import MigrationUnmatched, UnmatchedReason

logger = logging.getLogger("apps.data_migration.derivations")

# Source-file label used for anomalies produced by validate_products(), so they
# are distinguishable from real Excel-row quarantine entries and can be cleared
# before each re-validation (keeps validation idempotent).
VALIDATION_SOURCE = "__validation__"


def _strip_accents_lower(value: str) -> str:
    """Lower-case + accent-fold so "Câble" and "cable" compare equal."""
    nfkd = unicodedata.normalize("NFKD", value)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()


def _is_cable(product: Product) -> bool:
    """True if any hierarchy level mentions "câble" (CDC §8.5 base_unit rule)."""
    haystack = " ".join(
        filter(None, [product.universe, product.family, product.range, product.sub_range])
    )
    return "cable" in _strip_accents_lower(haystack)


def derive_fields_for(product: Product) -> dict[str, object]:
    """Return the field updates derivation would apply to *product*.

    Pure (no DB write) so it is trivially unit-testable. Returns only the keys
    whose value actually changes.
    """
    updates: dict[str, object] = {}

    # factory_code / parent_reference — fill only when empty (respect any value
    # a loader or Odoo already set; CDC §4.2 treats these as a modifiable proposal).
    if not product.factory_code:
        fc = extract_factory_code(product.sku_code)
        if fc:
            updates["factory_code"] = fc
    if not product.parent_reference:
        pr = extract_parent_reference(product.sku_code)
        if pr:
            updates["parent_reference"] = pr

    # is_copper_indexed — authoritative function of the copper weight (CDC §8.5:
    # "true si copper_weight_kg_per_unit > 0, sinon false").
    weight = product.copper_weight_kg_per_unit
    desired_copper = bool(weight and weight > 0)
    if product.is_copper_indexed != desired_copper:
        updates["is_copper_indexed"] = desired_copper

    # base_unit — cables sell per km. We only *upgrade* to km for cables; we
    # never downgrade a non-cable to 'unit' so a deliberate 'm' is preserved.
    if _is_cable(product) and product.base_unit != BaseUnit.KM:
        updates["base_unit"] = BaseUnit.KM

    return updates


def apply_derivations(*, dry_run: bool = False) -> int:
    """Apply CDC §8.5 derivations to every product. Returns the rows changed."""
    changed = 0
    for product in Product.objects.all().iterator():
        updates = derive_fields_for(product)
        if not updates:
            continue
        changed += 1
        if dry_run:
            logger.info("[dry-run] %s → %s", product.sku_code, updates)
            continue
        for field_name, value in updates.items():
            setattr(product, field_name, value)
        product.save(update_fields=[*updates.keys(), "updated_at"])
    logger.info("Derivations applied to %d product(s)%s", changed, " [dry-run]" if dry_run else "")
    return changed


def _quarantine_anomaly(sku: str, reason: UnmatchedReason, detail: str) -> None:
    MigrationUnmatched.objects.create(
        source_file=VALIDATION_SOURCE,
        source_row_number=None,
        raw_data={"sku_code": sku, "anomaly": detail},
        reason=reason,
    )


def validate_products(*, quarantine: bool = True) -> int:
    """Run the CDC §8.4 step-4 coherence checks. Returns the anomaly count.

    Checks:
      * ``name`` non-empty.
      * copper-indexed products have ``copper_weight_kg_per_unit > 0``.
      * a product with an active supplier has ``po_base_price`` + ``po_currency``
        + ``incoterm`` on that supplier.

    (``sku_code`` uniqueness is enforced by a DB constraint, so duplicates
    cannot exist here — nothing to check.)

    When ``quarantine`` is True the anomalies are logged into
    ``migration_unmatched``; prior validation rows are cleared first so the
    function is idempotent.
    """
    if quarantine:
        MigrationUnmatched.objects.filter(source_file=VALIDATION_SOURCE).delete()

    anomalies = 0

    for product in Product.objects.all().iterator():
        if not (product.name or "").strip():
            anomalies += 1
            if quarantine:
                _quarantine_anomaly(
                    product.sku_code, UnmatchedReason.MISSING_REQUIRED_FIELD, "empty name"
                )

        weight = product.copper_weight_kg_per_unit
        if product.is_copper_indexed and not (weight and weight > 0):
            anomalies += 1
            if quarantine:
                _quarantine_anomaly(
                    product.sku_code,
                    UnmatchedReason.INVALID_FORMAT,
                    "copper-indexed but copper_weight_kg_per_unit <= 0",
                )

    # Active suppliers missing required pricing fields.
    active_suppliers = ProductSupplier.objects.filter(is_active=True).select_related("product")
    for supplier in active_suppliers.iterator():
        missing = []
        if supplier.po_base_price is None or supplier.po_base_price <= 0:
            missing.append("po_base_price")
        if not supplier.po_currency:
            missing.append("po_currency")
        if not supplier.incoterm:
            missing.append("incoterm")
        if missing:
            anomalies += 1
            if quarantine:
                _quarantine_anomaly(
                    supplier.product.sku_code,
                    UnmatchedReason.MISSING_REQUIRED_FIELD,
                    f"active supplier {supplier.supplier_name!r} missing {', '.join(missing)}",
                )

    logger.info(
        "Validation found %d anomaly(ies)%s", anomalies, "" if quarantine else " [not logged]"
    )
    return anomalies
