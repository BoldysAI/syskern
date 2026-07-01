# Runbook — One-shot initial data migration (CDC §8)

Operated by **Boldys at deployment**, before production go-live. Not an
end-user feature. This runbook covers running, resuming and dry-running the
migration. For the destructive reset (replay on a fresh env) see
[`migration-reset.md`](migration-reset.md).

## What it does (4 sequential steps — CDC §8.4)

| # | Step (key) | Action |
|---|------------|--------|
| 1 | `odoo_sync` | Initial pull of the product/stock/PAMP/supplier/client trunk from Odoo |
| 2 | `excel_enrichment` | Enrich the imported products from the client Excel sources |
| 3 | `create_non_odoo` | Create "Database interne" products absent from Odoo (`migration_source=database_internal`) |
| 4 | `validate_derive` | Apply CDC §8.5 derivations, then run §8.4 validation (anomalies → quarantine) |

Each step persists a **resume checkpoint** on disk after it completes, so a
failed run resumes from the failed step instead of restarting from scratch.

## Prerequisites (CDC §8.3)

- Odoo API access configured (`ODOO_*` env — see `.env.example`).
- Client Excel sources dropped into `migration/sources/` (mounted as
  `/migration/sources` in the backend container).
- A **manifest** (`migration/manifest.json`) mapping each source file to its
  loader — see [`migration/README.md`](../../migration/README.md) for the schema.
- `MIGRATION_LOCKED` must be **false** (it blocks real runs once true).

> The backend container does not mount `/migration` by default. For the real
> migration, add a bind mount (`- ./migration:/migration`) to the `backend`
> service, or copy the sources + manifest into the container.

## Commands

All commands run in the backend container:

```bash
# 0. Preview — writes NOTHING (safe, allowed even when locked).
docker compose run --rm backend python manage.py run_migration --dry-run

# 1. Full run (fresh environment, sources + manifest in place).
docker compose run --rm \
  -e MIGRATION_MANIFEST=/migration/manifest.json \
  backend python manage.py run_migration

# 2. Resume after a failure (auto-detected; or be explicit).
docker compose run --rm backend python manage.py run_migration --start-from=step_2

# 3. Re-run everything, discarding the resume checkpoint.
docker compose run --rm backend python manage.py run_migration --reset

# Useful flags:
#   --skip-odoo            skip step 1 (Excel-only re-enrichment)
#   --api-version v16|v19  Odoo instance for step 1
#   --manifest PATH        sources manifest (default: MIGRATION_MANIFEST)
#   --sources-dir PATH     Excel sources dir (default: MIGRATION_SOURCES_DIR)
#   --yes                  non-interactive resume (no prompt)
```

`--start-from` accepts the index (`2`), the `step_2` form, or the step key
(`excel_enrichment`).

### Loading a single Excel file (per-loader)

To load one source without the full orchestrator (e.g. add one supplier's PO),
use its dedicated loader command. Loaders: `load_po_fournisseurs` (Symea),
`load_po_ayp`, `load_po_infoks`, `load_po_mirsan`, `load_technique`.

```bash
# Dry-run first (writes nothing):
docker compose run --rm backend python manage.py load_po_ayp \
  --file /migration/sources/PO_AYP.xlsx --sheet 0 --header-row 0 --dry-run
# Real load (drop --dry-run). --sheet = name or 0-based index; --header-row 0-based.
```

⚠️ These loaders **enrich existing products** — run the Odoo sync (or a product
import) first, otherwise every row lands in quarantine as `NO_MATCH` (see below).

## Resume behaviour

- The checkpoint lives at `MIGRATION_STATE_FILE` (default
  `backend/.migration_state.json`). It is **on disk, not in Postgres**, so it
  survives `migration_reset`.
- On launch, if a previous run is incomplete the command resumes from the
  failed step. In an interactive terminal it asks **[R]esume / [S]tart over**;
  non-interactively (CI / `--yes`) it resumes automatically.
- `run_migration --reset` clears the *checkpoint* (re-run all steps). This is
  **different** from `migration_reset`, which truncates the *DB tables*.

## After the run

- Review the per-step summary printed at the end.
- Step 4 logs validation anomalies into the **quarantine** table
  (`migration_unmatched`, `source_file = "__validation__"`) and Excel
  unmatched rows under their source file name. Review them in the Django admin
  or via the quarantine API, and arbitrate manually (CDC §8.7).
- Idempotency: re-running the full pipeline on already-migrated data yields the
  same DB state (derivations only fill/recompute; validation clears and
  re-logs its own anomalies).

## Quarantine (CDC §8.7)

Unmatched rows land in `migration_unmatched`. Olivier reviews and resolves them
from the admin UI at **`/admin/migration-quarantine`** (admin-only): filter by
source file / reason / resolved status. Each row shows its data as a
**structured key/value view** (no raw JSON), and resolution is **automatic** via
one of three explicit actions (2026-06-30):

- **Créer le produit** — builds & persists the `Product` directly from the row
  (SKU prefilled, `factory_code`/`parent_reference` derived); no need to go to
  *Catalogue → Nouveau produit* manually.
- **Supprimer** — the row is discarded (soft, kept for audit).
- **Ne rien faire** — the row is simply marked resolved.

`resolved_by` defaults to the logged-in admin. The chosen action is stored
(`resolution_action`) for the report.

> ⚠️ **Root cause of mass quarantine**: the PO loaders *enrich existing
> products* — they don't create them. If products aren't in the DB first
> (Odoo sync, step 1), every PO row → `NO_MATCH`. Always run step 1 (or a
> product import) **before** the PO enrichment loaders.

API: `GET /api/migration/unmatched/` (paginated, filters `source_file`,
`reason`, `resolved`, `ordering`), `GET .../facets/` (counts for the filter UI),
`POST|PATCH .../{id}/resolve/` (`{action: ignore|create|delete, product?,
resolved_by?, resolution_notes?}`).

## Final report (CDC §8.8)

Produce the cross-validation workbook + email summary for Olivier before go-live:

```bash
# Write migration_report_<date>.xlsx and print the email body.
docker compose run --rm backend python manage.py migration_report

# Also email it (recipients from --to or MIGRATION_REPORT_RECIPIENTS).
docker compose run --rm backend python manage.py migration_report --email \
    --to olivier@syskern.com,yassine@boldys.ai
```

Tabs: Synthèse (totals + products-by-source + run created/updated/duration from
the checkpoint), Fournisseurs, Attributs, Quarantaine, Dérivations, Simulation
(PV moyen par gamme over finalized simulations). Output dir defaults to
`MIGRATION_REPORT_DIR` (repo-root `migration/reports/`). `--email` requires
`EMAIL_*` configured and recipients set.

## Go-live

After the client validates the production load (CDC §7.1 criterion 4), set
`MIGRATION_LOCKED=true` so neither `run_migration` nor `migration_reset` can run
again and clobber enriched data (CDC §8.9).
