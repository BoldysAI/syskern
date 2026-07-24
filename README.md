# Syskern Pricing Platform

Plateforme **PIM + pricing + offres** pour Syskern (entité contractuelle
*Amplify Invest*). Remplace un workflow Excel : catalogue produit, calcul
**PA → PR → PV** (cuivre, transport, douane, marges), génération d’offres
tarifaires et projets (Excel / Gamma).

| Audience | Où aller |
|---|---|
| Nouveau développeur (setup) | Ce README |
| Architecture & reprise | [`docs/`](docs/README.md) |
| Spec fonctionnelle | [`docs/Cahier des charges technique — Pricing Platform MVP1.md`](docs/Cahier%20des%20charges%20technique%20—%20Pricing%20Platform%20MVP1.md) |
| Agents IA / conventions code | [`AGENTS.md`](AGENTS.md) · [`docs/agent/`](docs/agent/) |
| Écarts assumés au CDC | [`docs/agent/decisions.md`](docs/agent/decisions.md) |

---

## Stack (vérité opérationnelle)

| Couche | Choix |
|---|---|
| Backend | Django 5 + DRF, Python 3.12 |
| Frontend | Next.js (App Router), TypeScript |
| Base | **PostgreSQL** classique (psycopg 3) — local Docker, prod VPS OVH |
| Async | Celery + Redis + django-celery-beat |
| Auth MVP1 | Session Django + rôles `admin` / `commercial` / `viewer` |
| API docs | drf-spectacular → `/api/docs/` |
| Prod | Coolify sur VPS OVH (gunicorn + Traefik TLS) |
| Deps | **uv** (`backend/uv.lock`) — jamais `requirements.txt` |

> Le CDC mentionne encore FastAPI / Supabase self-host / mot de passe partagé.
> **Le code et `docs/agent/decisions.md` font foi** : Django, Postgres classique,
> users+rôles. Aucun projet Supabase n’est lié à cette plateforme.

---

## Prérequis

- **Docker Desktop ≥ 24** + `docker compose` v2 *(recommandé)*
- **Python 3.12** + [`uv`](https://docs.astral.sh/uv/) *(ou pip)*
- **Node 20+** + npm
- Optionnel sans Docker : Postgres 16 + Redis 7 → [`docs/agent/local-dev.md`](docs/agent/local-dev.md)

---

## Démarrer en &lt; 1 h (nouveau clone)

### 1. Setup

```bash
git clone <repo> && cd syskern
make setup          # deps Python+Node, pre-commit, templates .env
```

`make setup` crée `backend/.env` et `frontend/.env.local` s’ils manquent
(depuis les `.env.example`). Les valeurs Docker par défaut suffisent en local.

### 2. Lancer la stack

```bash
make up             # postgres + redis + backend + worker + beat + frontend
```

Au premier démarrage le backend : attend Postgres → `migrate` →
`bootstrap_catalog` (no-op si catalogue déjà peuplé) → runserver.

### 3. Créer un compte admin plateforme

```bash
docker compose exec backend python manage.py create_platform_user \
  --email toi@example.com --password 'ChangeMe!' --role admin
```

> `create_platform_user` crée un user **app** (rôles Profile). Ce n’est **pas**
> un superuser Django admin (`is_staff`). Pour `/admin/` : `createsuperuser`.

### 4. Vérifier

| URL | Attendu |
|---|---|
| http://localhost:3000 | Frontend |
| http://127.0.0.1:8000/api/health | `{"status":"ok","database":"ok"}` |
| http://127.0.0.1:8000/api/docs/ | Swagger (OpenAPI) |
| http://127.0.0.1:8000/admin/ | Django admin |

Login frontend avec l’email/mot de passe créés ci-dessus.

### Sans Docker (2–3 terminaux)

```bash
./scripts/dev-setup.sh
# utiliser backend/.env.native.example (hosts 127.0.0.1)
./scripts/dev-backend.sh      # :8000
./scripts/dev-frontend.sh     # :3000
./scripts/dev-celery.sh       # optionnel (Odoo, DeepL, exports)
```

---

## Structure du dépôt

```
syskern/
├── AGENTS.md / CLAUDE.md     # règles agents + devs
├── docs/                     # doc technique humaine + CDC + playbooks agent/
├── docker-compose.yml
├── Makefile
├── scripts/                  # dev natif
├── migration/                # sources Excel + manifest (migration one-shot)
├── data/                     # données source (référence)
├── backend/                  # Django + DRF
│   ├── config/settings/      # base | local | production
│   └── apps/                 # core, products, simulations, offers, odoo_sync, …
└── frontend/                 # Next.js — src/{app,components,contexts,lib}
```

---

## Commandes utiles

```bash
make up / make down / make logs
make lint          # ruff + eslint
make fmt           # format
make typecheck     # mypy + tsc
make test          # pytest backend
make pre-commit    # tous les hooks sur le repo

# Django via Compose
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py shell
docker compose exec backend pytest
docker compose exec backend ruff check .

# OpenAPI export (fichier versionné sous docs/api/)
docker compose exec backend python manage.py spectacular \
  --file /tmp/openapi.yaml --validate
```

Reset BDD locale : `docker compose down -v && make up`.

---

## Variables d’environnement

Référence complète : `backend/.env.example`. Catégories :

| Préfixe | Rôle |
|---|---|
| `DJANGO_*` | settings, CORS, hosts |
| `DATABASE_URL` / `REDIS_URL` | Postgres / broker Celery |
| `ODOO_*` / `ODOO_V16_*` / `ODOO_V19_*` | sync ERP |
| `GAMMA_*` / `DEEPL_*` / `OPENAI_*` | offres & i18n |
| `MIGRATION_*` | lock migration, sources, rapports |
| `SUPABASE_*` | stub JWT prod (non utilisé en MVP1 live) |
| `EMAIL_*` | SMTP (prod M365) |

Prod : secrets injectés par **Coolify** (pas de `.env` commité).

---

## Documentation technique

Index → **[`docs/README.md`](docs/README.md)**

- Architecture : [`docs/architecture.md`](docs/architecture.md)
- Mapping Odoo : [`docs/odoo-mapping.md`](docs/odoo-mapping.md)
- Runbooks ops : [`docs/runbooks/`](docs/runbooks/)
- Intégrations : [`docs/integrations/`](docs/integrations/)
- OpenAPI : [`docs/api/`](docs/api/)

---

## Qualité & commits

Pre-commit (ruff, eslint, prettier, detect-secrets, commitizen) installé par
`make setup`. Messages = [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, …). Bypass urgence : `git commit --no-verify`
(déconseillé).

Pas de CI dans le repo : les checks DoD sont **locaux** (`make lint` /
`typecheck` / `test`, build frontend).

---

## Licence

Code propriétaire — © Boldys / Syskern 2026.
