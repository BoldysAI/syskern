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

## Automatic one-shot bootstrap on deploy (`bootstrap_catalog`)

The container start command runs `python manage.py bootstrap_catalog` after
`migrate` (both local `docker-compose` and prod `Dockerfile`). It is
**idempotent and deploy-safe**:

- **No-op** if the catalog is already populated (`Product` exists) or
  `MIGRATION_LOCKED=true` → so every deploy after the first does nothing.
- On a **fresh** DB it auto-discovers the client Excel in
  `MIGRATION["SOURCES_DIR"]` (default `/migration/sources`) by filename glob and
  loads them once: `UKN_RANGE_PRICES*.xlsx` → `po_fournisseurs --create-missing`
  (PO&SC sheet auto-detected), `LAN_CABLE_PRICE_LIST*.xlsx` → `po_ayp`, then
  `seed_client_market_params`.
- A **missing** source file is skipped with a warning — it never fails the deploy.

**Prod sources — two options** (the resolver tries them in this order):

1. **Baked into the image** (current prod choice): the 2 required .xlsx are
   committed to `backend/migration_sources/` (private repo — see that dir's
   README). They ship in the image, so prod self-loads with **no volume and no
   env var**. Update = replace the file + commit + redeploy.
2. **Mounted volume** (keeps the .xlsx out of git): set `MIGRATION_SOURCES_DIR`
   (default `/migration/sources`), mount a persistent volume at `/migration` in
   Coolify, upload the files there once. Takes precedence over the baked-in dir.

Either way the load runs a **single time** on a fresh DB; further deploys no-op.
⚠️ Option 1 puts confidential client prices in git history permanently — chosen
deliberately for this private repo (see `decisions.md` 2026-07-02).

Force a reload (e.g. staging): `python manage.py bootstrap_catalog --force`
(still honours `MIGRATION_LOCKED`).

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

**Bootstrapping the catalog from Excel** (`po_fournisseurs` only): add
`--create-missing` so unmatched rows **create** the product (the UKN `PO & SC`
sheet carries the full definition — SKU, hierarchy, descriptions, copper, GTIN,
HS, supplier). Verified on the real client file: 1055 rows → 748 enriched,
~305 created, 2 quarantined; suppliers Symea/Mirsan/Infoks/Otrans/HT/… all
populated.

```bash
docker compose run --rm -v "$(pwd)/migration/sources:/migration/sources" backend \
  python manage.py load_po_fournisseurs \
  --file "/migration/sources/UKN_RANGE_PRICES_..._(avec_copper_adjust).xlsx" \
  --sheet "PO & SC Dec 2026" --header-row 12 --create-missing
```

⚠️ Without `--create-missing`, the loaders **enrich existing products only** — run
the Odoo sync (or bootstrap with `--create-missing` / `phase: create`) first,
otherwise unmatched rows land in quarantine as `NO_MATCH`.

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
  (SKU prefilled from the `sku_code` column — never the GTIN;
  `factory_code`/`parent_reference` derived); no need to go to *Catalogue →
  Nouveau produit* manually. **Idempotent**: if the SKU already matches a catalog
  product (created earlier by the Odoo sync or the create-missing bootstrap), the
  row is resolved against the existing product (note *« Produit déjà présent »*)
  instead of failing — so re-creating an existing product no longer returns 400.
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
