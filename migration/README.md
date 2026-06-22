# `migration/` — one-shot initial migration sources (CDC §8)

This directory holds the **source files and manifest** consumed by the one-shot
initial migration (`backend/apps/data_migration`). It is operated by Boldys at
deployment, **not** an end-user feature.

```
migration/
├── README.md          # this file (tracked)
├── sources/           # client Excel sources — gitignored except .gitkeep
│   ├── .gitkeep
│   └── *.xlsx         # PO fournisseurs, fiche technique, database interne…
└── manifest.json      # optional: declares which source feeds which loader
```

The actual `sources/*.xlsx` are **gitignored** (confidential / large). On a
fresh environment, drop the client files here and mount the directory into the
backend container (it resolves to `/migration/sources` there — see
`MIGRATION_SOURCES_DIR`).

## Manifest schema

`run_migration` reads an optional JSON manifest (`MIGRATION_MANIFEST`, or
`--manifest`) declaring which Excel file each loader consumes:

```json
[
  {"loader": "po_fournisseurs", "file": "PO_March2026.xlsx",
   "sheet": "PO & SC March 2026", "header_row": 12, "phase": "enrich"},
  {"loader": "technique", "file": "UKN_all_items.xlsx",
   "sheet": "GTIN code & packing details", "header_row": 0, "phase": "enrich"}
]
```

- `loader` — one of: `po_fournisseurs`, `po_ayp`, `po_infoks`, `po_mirsan`, `technique`.
- `file` — relative to `sources/` (or absolute).
- `sheet` / `header_row` — sheet name (or 0-based index) and 0-based header row.
- `phase` — `enrich` (step 2, default) or `create` (step 3, hors-Odoo).

See `docs/runbooks/migration.md` for the full runbook.
