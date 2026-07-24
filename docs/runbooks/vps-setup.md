# Runbook — Provisionnement VPS OVH + Coolify (INF / CDC §9)

Procédure pour déployer (ou redéployer) la plateforme sur un **VPS OVH**
orchestré par **Coolify**. Alignée sur le code (`backend/Dockerfile`,
`.env.example`) et les décisions (`docs/agent/decisions.md`).

> **Écart CDC §9.3–§9.4** : le CDC décrit Nginx + Let’s Encrypt + stack
> Supabase self-host. En production réelle : **Traefik (Coolify)** termine le
> TLS ; la BDD est un **Postgres classique** (service Coolify ou container),
> **sans** projet Supabase. Documenté ici = vérité ops.

---

## 1. Prérequis

| Élément | Cible indicative |
|---|---|
| VPS OVH | 4 vCPU / 8 Go RAM (validé spike Odoo 2026-06-18) |
| OS | Ubuntu LTS récent |
| Disque | Chiffrement bloc OVH activé (CDC §9.5) |
| DNS | Enregistrement A/AAAA vers l’IP VPS (domaine app + API si séparés) |
| Accès | SSH clé, utilisateur non-root avec sudo |

---

## 2. Installer Coolify sur le VPS

Suivre la doc Coolify officielle (install one-liner / script). Après install :

1. Créer un **projet** `syskern-pricing` (ou équivalent).
2. Brancher le repo Git privé (GitHub App / Deploy Key).
3. Prévoir **4 services applicatifs** + **2 dépendances** :

| Service Coolify | Build | Port interne | Health |
|---|---|---|---|
| Backend web | `backend/Dockerfile` target **`prod`**, Base Directory `/backend` | **8000** | `GET /api/health` |
| Celery worker | `backend/Dockerfile.worker` (cf. repo) | — | process alive |
| Celery beat | `backend/Dockerfile.beat` | — | process alive |
| Frontend | `frontend/Dockerfile` | **3000** | HTTP 200 |
| Postgres | image officielle 16 | 5432 | — |
| Redis | image officielle 7 | 6379 | — |

⚠️ **Piège Traefik** : `loadbalancer.server.port` du backend = **8000**
(gunicorn), pas 3000. Sinon → 502 (vu en bascule Odoo 2026-07-22).

---

## 3. Variables d’environnement (backend + worker + beat)

Copier depuis `backend/.env.example`. Minimum prod :

```bash
DJANGO_SETTINGS_MODULE=config.settings.production
DJANGO_SECRET_KEY=<long-random>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=<host-api>
DJANGO_CORS_ALLOWED_ORIGINS=https://<host-front>
DJANGO_CSRF_TRUSTED_ORIGINS=https://<host-front>
DATABASE_URL=postgres://...
REDIS_URL=redis://...
# Odoo
ODOO_API_VERSION=v16   # ou v19 selon instance
ODOO_BASE_URL=...
ODOO_DB_NAME=...
ODOO_API_USER=...
ODOO_API_PASSWORD=...
ODOO_SYNC_ENABLED=true
# Optionnel selon features
GAMMA_API_KEY=...
DEEPL_API_KEY=...
OPENAI_API_KEY=...
MIGRATION_LOCKED=true   # après go-live migration
```

Règles secrets (CDC §9.2) :

- Jamais commités ; injectés par Coolify.
- Rotation : régénérer chez le fournisseur → maj env → **Redeploy** (pas Restart).

`DJANGO_SECURE_SSL_REDIRECT` : laisser `false` si Traefik gère déjà HTTPS
(commentaire `.env.example`).

---

## 4. Premier déploiement

1. Deploy backend → vérifier logs `migrate` + `bootstrap_catalog` (idempotent).
2. Deploy worker + beat (même image/env Odoo/Redis).
3. Deploy frontend (`NEXT_PUBLIC_*` / URL API selon `frontend/.env.example`).
4. Smoke tests :
   ```bash
   curl -sS https://<host-api>/api/health
   # → {"status":"ok","database":"ok"}
   open https://<host-api>/api/docs/
   ```
5. Créer le premier admin plateforme :
   ```bash
   docker exec <backend> python manage.py create_platform_user \
     --email admin@… --password '…' --role admin
   ```
6. Brancher l’uptime externe → [`monitoring.md`](monitoring.md).
7. Installer logrotate → `infra/logrotate/syskern-pricing` ([`monitoring.md`](monitoring.md) §3).
8. Configurer les backups → [`restore.md`](restore.md) + `infra/backup.sh`.

---

## 5. Migration initiale (avant go-live métier)

Sur env frais uniquement :

1. `MIGRATION_LOCKED=false` + Redeploy.
2. Suivre [`migration.md`](migration.md) (`run_migration`, quarantaine, rapport).
3. Validation client → `MIGRATION_LOCKED=true` + Redeploy.

Reset si rejeu pré-prod → [`migration-reset.md`](migration-reset.md).

---

## 6. Checklist « env propre » (à rejouer une fois)

- [ ] VPS joignable SSH, Coolify OK
- [ ] 4 services app + Postgres + Redis healthy
- [ ] `/api/health` 200 + DB ok
- [ ] `/api/docs/` accessible
- [ ] Login frontend avec user `admin`
- [ ] Celery beat : tâches `odoo_sync.sync_task` visibles (django-celery-beat)
- [ ] Logrotate installé
- [ ] Backup cron testé (dump listable) — cf. restore
- [ ] UptimeRobot (ou équiv.) alerte email Boldys

---

## 7. Références

- Dockerfiles : `backend/Dockerfile` (header Coolify), `frontend/Dockerfile`
- Monitoring : [`monitoring.md`](monitoring.md)
- Bascule Odoo : [`bascule-odoo-prod.md`](bascule-odoo-prod.md)
- CDC §9 (intent) vs décisions 2026-06-22 (DB) / auth 2026-06-04
