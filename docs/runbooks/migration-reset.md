# Runbook — Migration reset (DESTRUCTIVE) (CDC §8.9)

> ⚠️ **DESTRUCTIVE — pre-production only.** This permanently deletes migrated
> data. Use it solely to replay the one-shot migration on a fresh / pre-prod
> environment. After go-live it is blocked by `MIGRATION_LOCKED=true`.

## What it does

Purges the migrated tables, **preserving reference data**:

| Purged | Preserved |
|--------|-----------|
| `products` | `attribute_registry` |
| `product_attribute_values` | `incoterms` |
| `product_suppliers` | `transport_modes` |
| `clients` | |
| `migration_unmatched` | |

Reference tables are seeded by Django data migrations; re-seeding is not the
migration's job, so the reset leaves them intact.

## Guard-rails

1. **Lock**: blocked when `MIGRATION_LOCKED=true` (CDC §8.9) — fails before any
   deletion.
2. **Confirmation**: you must type `RESET` exactly. Any other input aborts with
   nothing deleted. Skip only in scripted runbooks with `--no-input`.

## Command

```bash
# Interactive (prompts for the RESET token):
docker compose run --rm backend python manage.py migration_reset

# Scripted (no prompt) — use with care:
docker compose run --rm backend python manage.py migration_reset --no-input
```

The command prints the row counts it is about to delete, performs the purge in
a single transaction (FK-safe: children before parents), then prints the rows
deleted per table.

## Then replay

```bash
# The resume checkpoint is on disk and survives the DB reset — clear it too:
docker compose run --rm backend python manage.py run_migration --reset
```

## Notes

- `Product` is referenced with `on_delete=PROTECT` from `simulation_lines`. If a
  simulation already references a product the purge raises `ProtectedError` —
  this is intentional: you should not be resetting a DB that already has pricing
  history. Pre-production there are no simulations, so this never fires.
- Do not confuse this with `run_migration --reset`, which only clears the
  resume *checkpoint* (not the DB).
