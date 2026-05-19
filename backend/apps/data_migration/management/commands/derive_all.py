"""Management command: run post-migration automatic field derivations (CDC §8.5).

Usage
-----
::

    # Preview what would change — nothing is written
    python manage.py derive_all --dry-run

    # Fill only empty fields (default behaviour)
    python manage.py derive_all

    # Re-derive and overwrite ALL derivable fields (e.g. after rule correction)
    python manage.py derive_all --force

What this command derives
--------------------------
Four fields can be computed purely from data already on the ``Product`` row:

  ============  ==========================================================
  Field         Rule
  ============  ==========================================================
  factory_code  CDC §8.5 — ``-[E]?\\d+`` suffix of ``sku_code``
  parent_ref    CDC §8.5 — ``sku_code`` before the factory suffix
  is_copper     CDC §8.5 — ``True`` if ``copper_weight_kg_per_unit > 0``
  base_unit     CDC §8.5 — ``'km'`` if «câble» in the category path
  ============  ==========================================================

``pamp_eur`` and ``is_active`` are **not** re-derived here — they require
Odoo source data (``standard_price``, ``active`` flag) that is consumed at
Odoo-sync time and not stored as separate fields on ``Product``.

Default vs --force
------------------
By default only empty fields (``""`` or ``None``) are filled, so values
written by the Odoo sync or loaders are preserved.  ``--force`` overwrites
every field, useful after a rule correction (e.g. fixing the suffix regex).

Validation
----------
After derivation, anomalous products are logged to ``MigrationUnmatched``
with reason ``MISSING_REQUIRED_FIELD`` so that Olivier can review them in
the admin UI (CDC §8.7):

  - SKU with an empty ``name``
  - ``is_copper_indexed=True`` with ``copper_weight_kg_per_unit`` ≤ 0 or null
  - Active ``ProductSupplier`` without ``po_base_price``, ``po_currency``
    or ``incoterm``

Guard-rail
----------
Obeys ``MIGRATION_LOCKED=true`` — set this env-var after production go-live
to prevent accidental re-runs (CDC §8.9).  ``--dry-run`` is always allowed.
"""
from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass, field
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.data_migration.derivations import (
    derive_base_unit,
    derive_factory_code,
    derive_is_copper_indexed,
    derive_parent_reference,
)
from apps.data_migration.models import MigrationUnmatched, UnmatchedReason
from apps.products.models import Product

logger = logging.getLogger(__name__)

# Fields written by this command (used in bulk_update)
_DERIVE_FIELDS = ["factory_code", "parent_reference", "is_copper_indexed", "base_unit"]
_BULK_CHUNK = 500


# ---------------------------------------------------------------------------
# Internal result tracking
# ---------------------------------------------------------------------------


@dataclass
class _DeriveReport:
    total: int = 0
    changed: int = 0
    anomalies: int = 0
    field_counts: dict[str, int] = field(default_factory=dict)

    def record_change(self, field_name: str) -> None:
        self.changed += 1
        self.field_counts[field_name] = self.field_counts.get(field_name, 0) + 1

    def __str__(self) -> str:  # noqa: D105
        lines = [
            f"derive_all report",
            f"  Products scanned : {self.total}",
            f"  Products changed : {self.changed}",
            f"  Anomalies logged : {self.anomalies}",
        ]
        if self.field_counts:
            lines.append("  Field breakdown  :")
            for f_name, count in sorted(self.field_counts.items()):
                lines.append(f"    {f_name:<20} {count}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Core derivation logic
# ---------------------------------------------------------------------------


def _apply_derivations(product: Product, force: bool) -> list[str]:
    """Derive and potentially update fields on a Product instance.

    Returns a list of field names that were changed (for reporting).
    Does NOT save — the caller handles bulk_update.
    """
    changed: list[str] = []

    def _set(attr: str, new_value: object) -> None:
        """Write new_value if force or the field is currently empty."""
        current = getattr(product, attr)
        is_empty = current is None or current == ""
        if force or is_empty:
            if current != new_value:
                setattr(product, attr, new_value)
                changed.append(attr)

    # 1. factory_code — from sku_code suffix (-NN / -ENN)
    derived_factory = derive_factory_code(product.sku_code)
    if derived_factory is not None:
        _set("factory_code", derived_factory)

    # 2. parent_reference — sku_code before the factory suffix
    derived_parent = derive_parent_reference(product.sku_code)
    if derived_parent is not None:
        _set("parent_reference", derived_parent)

    # 3. is_copper_indexed — True when copper weight is positive
    derived_copper = derive_is_copper_indexed(product.copper_weight_kg_per_unit)
    _set("is_copper_indexed", derived_copper)

    # 4. base_unit — 'km' when «câble» appears in the category path
    category_path = " ".join(
        filter(None, [product.universe, product.family, product.range, product.sub_range])
    )
    derived_unit = derive_base_unit(category_path)
    _set("base_unit", derived_unit)

    return changed


def _build_quarantine_entries(product: Product) -> list[dict[str, Any]]:
    """Return a list of anomaly dicts for products that fail post-derivation checks."""
    anomalies: list[dict[str, Any]] = []
    raw_base = {"sku_code": product.sku_code, "product_id": str(product.pk)}

    if not product.name:
        anomalies.append({
            "reason": UnmatchedReason.MISSING_REQUIRED_FIELD,
            "raw": {**raw_base, "problem": "name is empty"},
        })

    if product.is_copper_indexed and (
        product.copper_weight_kg_per_unit is None
        or product.copper_weight_kg_per_unit <= 0
    ):
        anomalies.append({
            "reason": UnmatchedReason.MISSING_REQUIRED_FIELD,
            "raw": {
                **raw_base,
                "problem": "is_copper_indexed=True but copper_weight_kg_per_unit is missing or zero",
                "copper_weight": str(product.copper_weight_kg_per_unit),
            },
        })

    for supplier in product.suppliers.filter(is_active=True):
        missing = []
        if not supplier.po_base_price:
            missing.append("po_base_price")
        if not supplier.po_currency:
            missing.append("po_currency")
        if not supplier.incoterm:
            missing.append("incoterm")
        if missing:
            anomalies.append({
                "reason": UnmatchedReason.MISSING_REQUIRED_FIELD,
                "raw": {
                    **raw_base,
                    "problem": f"active supplier '{supplier.supplier_name}' missing: {', '.join(missing)}",
                    "supplier_id": str(supplier.pk),
                },
            })

    return anomalies


# ---------------------------------------------------------------------------
# Management command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = (
        "Apply post-migration automatic field derivations to all Product rows (CDC §8.5).\n"
        "Derives: factory_code, parent_reference, is_copper_indexed, base_unit.\n"
        "Logs anomalies to migration_unmatched for review."
    )

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Compute derivations and print the report without writing to the DB.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help=(
                "Overwrite ALL derivable fields, even those already populated. "
                "Default: fill only empty fields."
            ),
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=_BULK_CHUNK,
            metavar="N",
            help=f"bulk_update chunk size (default: {_BULK_CHUNK}).",
        )
        parser.add_argument(
            "--log-level",
            default="INFO",
            choices=["DEBUG", "INFO", "WARNING", "ERROR"],
            metavar="LEVEL",
            help="Logging verbosity (default: %(default)s).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        logging.basicConfig(
            level=getattr(logging, options["log_level"]),
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            stream=sys.stderr,
        )

        dry_run: bool = options["dry_run"]
        force: bool = options["force"]
        batch_size: int = options["batch_size"]

        self._check_migration_lock(dry_run)

        if dry_run:
            self.stdout.write(self.style.WARNING("[DRY RUN] No changes will be written."))
        if force:
            self.stdout.write(self.style.WARNING("[FORCE] All derivable fields will be overwritten."))

        report = _DeriveReport()
        pending_updates: list[Product] = []
        pending_anomalies: list[tuple[Product, dict[str, Any]]] = []

        qs = (
            Product.objects.prefetch_related("suppliers")
            .only(
                "id", "sku_code", "name",
                "factory_code", "parent_reference",
                "is_copper_indexed", "copper_weight_kg_per_unit",
                "base_unit", "universe", "family", "range", "sub_range",
            )
            .iterator(chunk_size=batch_size)
        )

        for product in qs:
            report.total += 1
            changed_fields = _apply_derivations(product, force=force)

            if changed_fields:
                for f_name in changed_fields:
                    report.record_change(f_name)
                pending_updates.append(product)
                logger.debug("Product %s: derived %s", product.sku_code, changed_fields)

            for anomaly in _build_quarantine_entries(product):
                pending_anomalies.append((product, anomaly))
                report.anomalies += 1
                logger.warning(
                    "Anomaly on %s: %s", product.sku_code, anomaly["raw"].get("problem")
                )

            # Flush in batches
            if len(pending_updates) >= batch_size:
                self._flush_updates(pending_updates, batch_size, dry_run)
                pending_updates = []

        # Final flush
        if pending_updates:
            self._flush_updates(pending_updates, batch_size, dry_run)

        # Write anomalies to quarantine
        if not dry_run and pending_anomalies:
            self._write_quarantine(pending_anomalies)

        self.stdout.write(str(report))

        if dry_run:
            self.stdout.write(self.style.WARNING("\n[DRY RUN] No changes committed."))
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nDerivations applied. {report.anomalies} anomaly/anomalies "
                    f"logged to migration_unmatched."
                )
            )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _flush_updates(
        self, products: list[Product], batch_size: int, dry_run: bool
    ) -> None:
        if dry_run:
            logger.debug("DRY RUN: would bulk_update %d products", len(products))
            return
        with transaction.atomic():
            Product.objects.bulk_update(
                products,
                fields=_DERIVE_FIELDS + ["updated_at"],
                batch_size=batch_size,
            )
        logger.info("bulk_update: committed %d products", len(products))

    @staticmethod
    def _write_quarantine(anomalies: list[tuple[Product, dict[str, Any]]]) -> None:
        entries = [
            MigrationUnmatched(
                source_file="derive_all",
                source_row_number=None,
                raw_data=a["raw"],
                reason=a["reason"],
            )
            for _, a in anomalies
        ]
        MigrationUnmatched.objects.bulk_create(entries, batch_size=500)
        logger.info("Quarantine: wrote %d anomaly entries", len(entries))

    @staticmethod
    def _check_migration_lock(dry_run: bool) -> None:
        """Enforce MIGRATION_LOCKED guard-rail (CDC §8.9)."""
        if dry_run:
            return
        if os.environ.get("MIGRATION_LOCKED", "").lower() == "true":
            raise CommandError(
                "MIGRATION_LOCKED=true is set.  Use --dry-run to preview, or "
                "unset MIGRATION_LOCKED if you are running on a fresh environment."
            )
