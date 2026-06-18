# Odoo mapping — synced fields, conventions, volumetry

Generated alongside `apps/odoo_sync/adapters/`.

---

## Volumétrie — pull complet Odoo

_Mesuré le 2026-06-17 18:46 UTC contre `api_version=v16`._

| Scope (limit) | Records | Pages | Total latency | Median/page | p99/page | Bytes reçus |
|---|---:|---:|---:|---:|---:|---:|
| `product.template (limit=100)` | 800 | 9 | 0.98 s | 108 ms | 142 ms | 478.3 kB |
| `product.template (limit=200)` | 800 | 5 | 0.67 s | 146 ms | 159 ms | 478.1 kB |
| `product.template (limit=500)` | 800 | 2 | 0.42 s | 211 ms | 261 ms | 478.0 kB |
| `stock.quant (single call)` | 80 | 1 | 0.10 s | 102 ms | 102 ms | 10.8 kB |
| `res.partner (limit=200)` | 16 | 1 | 0.09 s | 88 ms | 88 ms | 4.2 kB |
| `product.supplierinfo (limit=500)` | 677 | 2 | 0.23 s | 116 ms | 140 ms | 104.5 kB |

### Taille tables BDD plateforme (après ingestion)

| Table | `pg_total_relation_size` |
|---|---|
| `products` | 1088 kB |
| `product_suppliers` | 464 kB |
| `clients` | 96 kB |
| `product_attribute_values` | 72 kB |
| `sync_logs` | 2016 kB |

### Recommandations

- **`limit` optimal pour `product.template`** : ~500 
  (total `0.42 s` vs autres options).
- **Sizing VPS** : sur l'instance staging (800 produits + stock + clients),
  le pull complet tient sous 2.5 s — confortable pour un cron 03:00 UTC.
  L'hypothèse 4 vCPU / 8 Go reste valable tant que les workers Celery ne sont pas saturés en parallèle.
- **Timeout HTTP par requête** : viser ≥ 3× le p99 par page (cf. tableau ci-dessus).
  Notre `ODOO_TIMEOUT_SECONDS=60` couvre largement le pire cas observé.
