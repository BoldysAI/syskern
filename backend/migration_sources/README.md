# backend/migration_sources/ — client Excel baked into the prod image

⚠️ **Confidential** — these `.xlsx` hold the client's real supplier prices,
margins and PO data. They live in this **private** repo on purpose so the prod
image self-loads the catalog once, without a persistent volume or manual upload.

## Why here (and not the repo-root `migration/sources/`)

The Coolify prod build context is **`backend/`** (`Base Directory: /backend`), so
only files under `backend/` end up in the image. The repo-root `migration/`
folder is **not** in the image — hence this dir.

## How prod uses it

`bootstrap_catalog` (run at container start, after `migrate`) globs
`MIGRATION["SOURCES_DIR"]`. In prod set:

```
MIGRATION_SOURCES_DIR=/app/migration_sources
```

so it reads these baked-in files. The load is **idempotent / one-shot**: it runs
only on a fresh DB (no `Product` rows) and is a no-op on every later deploy.

## Files (only these two are needed for the bootstrap)

| File | Loader | Notes |
|---|---|---|
| `UKN_RANGE_PRICES_*_(avec_copper_adjust).xlsx` | `po_fournisseurs --create-missing` | UKN `PO & SC` sheet — creates the catalog trunk |
| `LAN_CABLE_PRICE_LIST_*.xlsx` | `po_ayp` | AYP price grid — enriches |

## Updating the catalog later

Replace a file here + commit, then either run
`bootstrap_catalog --force` on a staging DB, or use the per-loader commands
(see `docs/runbooks/migration.md`). On the locked prod DB (`MIGRATION_LOCKED=true`)
the bootstrap stays a no-op — deliberate (CDC §8.9).
