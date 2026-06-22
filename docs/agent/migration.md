# Playbook — Migration initiale (CDC §8)

> One-shot, opérée par Boldys au déploiement. App : `backend/apps/data_migration/`.
> Runbooks opérateur : `docs/runbooks/migration.md` + `migration-reset.md`.

## Carte du module

```
apps/data_migration/
├── orchestrator.py     # cœur générique : steps ordonnés + checkpoint/resume (aucune dépendance Odoo/Excel)
├── steps.py            # implémentations des 4 steps + LOADER_REGISTRY + lecture manifest
├── derivations.py      # step 4 : dérivations CDC §8.5 + validation §8.4 (idempotent)
├── reset.py            # purge DB (logique pure, sans prompt)
├── locking.py          # garde-fou MIGRATION_LOCKED (lu depuis os.environ)
├── report.py           # rapport final §8.8 : data + workbook openpyxl + corps de mail
├── loaders/            # un loader par fichier source Excel (BaseExcelLoader)
│   └── matching.py     # ProductMatcher : cascade 4 règles §8.6 (index en mémoire)
├── models.py           # MigrationUnmatched (quarantaine, CDC §8.7)
├── views.py · filters.py · serializers.py   # API quarantaine (list/facets/resolve)
└── management/commands/
    ├── run_migration.py    # orchestre les 4 steps (--start-from / --reset / --dry-run / --skip-odoo)
    ├── migration_reset.py  # purge DB (confirmation 'RESET', --no-input)
    ├── migration_report.py # rapport final §8.8 (--email / --to / --output-dir)
    └── load_*.py           # loaders Excel individuels (BaseLoaderCommand)
```

Frontend : `frontend/src/app/admin/migration-quarantine/` (page admin-only, calque `/admin/users`).

## Les 4 steps (ordre figé, CDC §8.4)

1. `odoo_sync` — `apps.odoo_sync.services.runner.sync(scope=ALL)`. Skip si Odoo non configuré, `--skip-odoo`, ou `--dry-run`.
2. `excel_enrichment` — joue les entrées manifest `phase=enrich` via `LOADER_REGISTRY`.
3. `create_non_odoo` — entrées manifest `phase=create` (produits hors-Odoo). Pas de loader par défaut (format client-spécifique).
4. `validate_derive` — `apply_derivations()` puis `validate_products()`.

Manifest = JSON listant `{loader, file, sheet, header_row, phase}` (cf. `migration/README.md`). Loaders valides : `po_fournisseurs`, `po_ayp`, `po_infoks`, `po_mirsan`, `technique`.

## Règles à respecter

- **Orchestrateur générique** : ne pas y mettre de logique Odoo/Excel. Les steps sont des callables `ctx -> StepReport` injectés (`build_default_steps()`), ce qui les rend stubables en test.
- **Checkpoint = fichier disque** (`MIGRATION_STATE_FILE`, défaut `backend/.migration_state.json`), **jamais en base** : il doit survivre à `migration_reset`. Gitignoré.
- **Deux « reset » distincts** : `run_migration --reset` efface le *checkpoint* ; `migration_reset` truncate les *tables DB*. Ne pas les confondre.
- **`MIGRATION_LOCKED`** bloque tout run réel (dry-run toléré) et tout reset (CDC §8.9). Helper `apps.data_migration.locking`.
- **Idempotence** (critère « rejeu intégral → identique ») : `apply_derivations` remplit factory_code/parent_reference seulement si vides, recalcule is_copper_indexed/base_unit ; `validate_products` purge ses propres lignes quarantaine (`source_file="__validation__"`) avant de relogger.
- **Dérivations** (CDC §8.5) : réutiliser `apps.products.services.sku_parser`. `pamp_eur`/`is_active` ne sont **pas** dérivés (viennent du sync Odoo).
- **Quarantaine** : anomalies de validation → `MigrationUnmatched` (`source_file="__validation__"`) ; lignes Excel non matchées → leur nom de fichier. Pas de réinjection auto (CDC §8.7) — l'UI `/admin/migration-quarantine` ne fait que lister/filtrer/résoudre. Résolution = `POST|PATCH /api/migration/unmatched/{id}/resolve/` (`resolved_by` email requis).
- **Matching** (`ProductMatcher`, §8.6) : cascade stricte 4 règles, court-circuit dès qu'une règle donne ≥1 candidat ; ≥2 candidats → `DUPLICATE_MATCH` (quarantaine, **jamais** de choix arbitraire). Index pré-chargés en mémoire 1×/run (pas de requête DB par ligne — perf <1s/100 lignes sur 2000 produits).
- **Rapport** (`report.py`, §8.8) : `build_report_data()` agrège en live depuis la DB ; les compteurs créés/maj + durée viennent du **checkpoint** (seul endroit où ils existent). Idempotent / lecture seule. PV moyen par gamme = `SimulationLine` des simulations `finalized` groupées par `product__range`.
- Nouveau format source → nouveau loader `loaders/loader_<x>.py` + clé dans `LOADER_REGISTRY` (`steps.py`) + commande `load_<x>` optionnelle.
