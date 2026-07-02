"""Default implementations of the four migration steps (CDC §8.4).

These are the production step callables wired into :class:`MigrationOrchestrator`
by the ``run_migration`` command. Each is tolerant: when its input is absent
(Odoo unconfigured, no Excel manifest, no internal-DB source) it returns a
*skipped* :class:`StepReport` rather than failing — the orchestrator only stops
on genuine errors.

The Excel/internal-DB steps are driven by a **manifest** (JSON) so Boldys can
declare which source file feeds which loader without code changes — the loader
formats themselves (one class per source file) already live in ``loaders/``.
See ``docs/runbooks/migration.md`` for the manifest schema.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from django.conf import settings

from .loaders.base import BaseExcelLoader
from .loaders.loader_po_ayp import AYPLoader
from .loaders.loader_po_fournisseurs import POFournisseursLoader
from .loaders.loader_po_infoks import INFOKSLoader
from .loaders.loader_po_mirsan import MirsanLoader
from .loaders.loader_technique import TechniqueLoader
from .loaders.types import LoaderConfig
from .orchestrator import MigrationContext, MigrationStep, StepReport

logger = logging.getLogger("apps.data_migration.steps")

# Loader key → class. Manifest entries reference a loader by key. Keys mirror
# the ``load_<key>`` management commands so operators recognise them.
LOADER_REGISTRY: dict[str, type[BaseExcelLoader]] = {
    "po_fournisseurs": POFournisseursLoader,
    "po_ayp": AYPLoader,
    "po_infoks": INFOKSLoader,
    "po_mirsan": MirsanLoader,
    "technique": TechniqueLoader,
}


# ── Step 1 — Sync Odoo initiale ─────────────────────────────────────────────


def _odoo_configured(version: str) -> bool:
    """True if the selected Odoo instance has a base URL configured."""
    odoo = settings.ODOO
    if version == "v16":
        return bool(odoo.get("V16_BASE_URL") or odoo.get("BASE_URL"))
    if version == "v19":
        return bool(odoo.get("V19_BASE_URL") or odoo.get("BASE_URL"))
    return bool(odoo.get("BASE_URL"))


def step_odoo_sync(ctx: MigrationContext) -> StepReport:
    """Pull the product/stock/PAMP/supplier/client trunk from Odoo (CDC §8.4-1)."""
    if ctx.skip_odoo:
        return StepReport(detail="skipped (--skip-odoo)", skipped=True)

    version = (ctx.odoo_api_version or settings.ODOO.get("API_VERSION") or "v19").lower()
    if not _odoo_configured(version):
        return StepReport(detail=f"skipped (Odoo {version} not configured)", skipped=True)
    if ctx.dry_run:
        return StepReport(detail=f"dry-run: Odoo {version} sync not executed", skipped=True)

    # Imported lazily so the module loads without a live Odoo config (tests).
    from apps.odoo_sync.models import SyncScope, SyncType
    from apps.odoo_sync.services.runner import sync

    log = sync(
        scope=SyncScope.ALL,
        sync_type=SyncType.MANUAL,
        triggered_by="migration",
        api_version=version,
    )
    return StepReport(
        created=log.items_created,
        updated=log.items_updated,
        failed=log.items_failed,
        detail=f"odoo={version} sync_log={log.id} status={log.status}",
    )


# ── Manifest loading (shared by steps 2 & 3) ────────────────────────────────


def _load_manifest(ctx: MigrationContext) -> list[dict]:
    """Read the migration manifest, or return an empty list if none configured.

    Manifest schema (JSON array)::

        [{"loader": "po_fournisseurs", "file": "PO_March2026.xlsx",
          "sheet": "...", "header_row": 12, "phase": "enrich"}]

    ``file`` may be relative (resolved against ``sources_dir``) or absolute.
    ``sheet`` / ``header_row`` are optional (the loader command defaults apply
    when omitted — here we require explicit values or fall back to None/0).
    ``phase`` is "enrich" (step 2, default) or "create" (step 3).
    """
    if ctx.options.get("manifest_entries") is not None:
        return list(ctx.options["manifest_entries"])

    manifest_path = ctx.manifest_path
    if manifest_path is None:
        configured = settings.MIGRATION.get("MANIFEST")
        manifest_path = Path(configured) if configured else None
    if manifest_path is None or not Path(manifest_path).exists():
        return []

    raw = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"Manifest {manifest_path} must be a JSON array")
    return raw


def _run_manifest_entries(ctx: MigrationContext, entries: list[dict], phase: str) -> StepReport:
    """Run every manifest entry tagged with *phase* through its loader."""
    total = StepReport()
    ran = 0
    for entry in entries:
        if entry.get("phase", "enrich") != phase:
            continue
        loader_key = entry["loader"]
        if loader_key not in LOADER_REGISTRY:
            raise ValueError(f"Unknown loader {loader_key!r} (valid: {sorted(LOADER_REGISTRY)})")

        file_value = Path(entry["file"])
        if not file_value.is_absolute() and ctx.sources_dir is not None:
            file_value = ctx.sources_dir / file_value

        config = LoaderConfig(
            file_path=str(file_value),
            sheet_name=entry.get("sheet"),
            header_row=int(entry.get("header_row", 0)),
            batch_size=int(entry.get("batch_size", 500)),
            dry_run=ctx.dry_run,
            # `create` phase bootstraps products from the source; a manifest entry
            # may override explicitly (e.g. create-and-enrich in one pass).
            create_missing=bool(entry.get("create_missing", phase == "create")),
        )
        loader = LOADER_REGISTRY[loader_key]()
        report = loader.run(config)
        ran += 1
        total.updated += report.rows_updated + report.rows_created
        total.failed += report.rows_quarantined
        logger.info("Loaded %s (%s): %s", loader_key, file_value.name, report)

    if ran == 0:
        return StepReport(detail=f"no '{phase}' sources in manifest", skipped=True)
    total.detail = f"{ran} file(s) loaded"
    return total


def step_excel_enrichment(ctx: MigrationContext) -> StepReport:
    """Enrich Odoo-imported products from the Excel sources (CDC §8.4-2)."""
    entries = _load_manifest(ctx)
    if not entries:
        return StepReport(detail="no manifest configured", skipped=True)
    return _run_manifest_entries(ctx, entries, phase="enrich")


def step_create_non_odoo(ctx: MigrationContext) -> StepReport:
    """Create products from the "Database interne" that are absent from Odoo
    (CDC §8.4-3, ``migration_source = database_internal``).

    Driven by manifest entries with ``"phase": "create"``. No such loader ships
    by default (the file format is client-specific and written when the real
    file arrives, per CDC §8.4); absent a create-phase entry this is a no-op.
    """
    entries = _load_manifest(ctx)
    if not entries:
        return StepReport(detail="no manifest configured", skipped=True)
    return _run_manifest_entries(ctx, entries, phase="create")


# ── Step 4 — Validation et dérivations ──────────────────────────────────────


def step_validate_and_derive(ctx: MigrationContext) -> StepReport:
    """Apply CDC §8.5 derivations then run the §8.4 step-4 validation."""
    from .derivations import apply_derivations, validate_products

    derived = apply_derivations(dry_run=ctx.dry_run)
    anomalies = validate_products(quarantine=not ctx.dry_run)
    return StepReport(
        updated=derived,
        failed=anomalies,
        detail=f"derived={derived} anomalies={anomalies}" + (" [dry-run]" if ctx.dry_run else ""),
    )


# ── Step assembly ───────────────────────────────────────────────────────────


def build_default_steps() -> list[MigrationStep]:
    """The canonical 4-step pipeline (CDC §8.4), in order."""
    return [
        MigrationStep(1, "odoo_sync", "Sync Odoo initiale", step_odoo_sync),
        MigrationStep(2, "excel_enrichment", "Enrichissement Excel", step_excel_enrichment),
        MigrationStep(3, "create_non_odoo", "Création produits hors-Odoo", step_create_non_odoo),
        MigrationStep(4, "validate_derive", "Validation et dérivations", step_validate_and_derive),
    ]
