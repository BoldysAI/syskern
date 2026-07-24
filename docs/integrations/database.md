# Base de données — PostgreSQL

PostgreSQL **classique** (psycopg 3). Aucun projet Supabase n’est lié à
Syskern ([décision 2026-06-22](../agent/decisions.md)).

---

## Environnements

| Env | Hébergement | URL typique |
|---|---|---|
| Local Docker | service `postgres:16-alpine` | `postgres://syskern:syskern@postgres:5432/syskern` |
| Local natif | Homebrew / local | `…@127.0.0.1:5432/…` (cf. `.env.native.example`) |
| Prod | Postgres sur VPS OVH (Coolify) | `DATABASE_URL` injecté · `DJANGO_DB_SSLMODE` selon besoin |

Settings :

- Commun : `config/settings/base.py` (dj-database-url)
- Prod : `production.py` peut imposer `sslmode=require`

---

## Conventions schéma

- PK **UUID** via `apps.core.models.BaseModel`
- Prix : `Decimal(12, 4)` — jamais `float`
- JSONB : descriptions multilingues, snapshots calcul, EAV
- Soft-delete produits : `is_active=False` (CDC §4.6)
- Index : GIN sur valeurs attributs JSONB ; `select_related` /
  `prefetch_related` côté ORM

Migrations Django versionnées dans `apps/*/migrations/` — toujours
`makemigrations` + commit.

---

## Compose local

```yaml
# extrait — voir docker-compose.yml
postgres:
  image: postgres:16-alpine
  # log_min_duration_statement=500 (requêtes lentes)
```

Volumes : `postgres_data` (persistant), reset = `docker compose down -v`.

---

## Ops

| Besoin | Doc / commande |
|---|---|
| Backup / restore | [`../runbooks/restore.md`](../runbooks/restore.md), `infra/backup.sh` |
| Health DB | `GET /api/health` → champ `database` |
| Requêtes lentes | `log_min_duration_statement=500` · [`../runbooks/monitoring.md`](../runbooks/monitoring.md) |
| Migration métier one-shot | [`../runbooks/migration.md`](../runbooks/migration.md) |
| Purge tables migrées | [`../runbooks/migration-reset.md`](../runbooks/migration-reset.md) |

Dump ad hoc (Coolify) :

```bash
PG=$(docker ps -qf "name=<UUID_APP_POSTGRES>")
docker exec "$PG" pg_dump -U postgres -Fc postgres > ~/syskern_$(date +%F).dump
```

---

## Ce qui n’existe pas (volontairement)

- Supabase Auth / Storage / Realtime comme stack DB
- Réplication streaming / PITR en MVP1
- Chiffrement TDE applicatif (chiffrement disque VPS + SSE S3 backups)
