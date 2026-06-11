# Syskern Pricing Platform

Backend Django + DRF pour la plateforme de pricing Syskern (MVP1).

Centralise le catalogue produit (PIM), automatise le calcul des prix
(PA/PR/PV) en fonction du cours du cuivre, du transport, de la douane et
des marges, et génère des offres tarifaires/projets.

Cf. `Cahier des charges technique — Pricing Platform MVP1` et `Annexe
Technique Projet-001` pour la spécification fonctionnelle.

---

## Stack

| Couche | Choix |
|---|---|
| **Backend** | Django 5 + Django REST Framework |
| **Base de données** | PostgreSQL 16 (local : container Postgres / prod : Supabase managé) |
| **Cache & broker** | Redis 7 (Celery) |
| **Auth** | Supabase Auth (prod) / mot de passe partagé (MVP1) |
| **Container** | Docker + Docker Compose pour le dev local |
| **API docs** | drf-spectacular → `/api/docs/` |

> Production : Supabase (Postgres + Auth + Storage) self-hosted sur VPS OVH.
> Local : Postgres + Redis dans Docker.  L'application Django parle au même
> URL `postgres://...` dans les deux cas.

---

## Structure du projet

```
syskern/
├── docker-compose.yml         # stack locale (postgres, redis, backend)
├── README.md
└── backend/
    ├── Dockerfile             # multi-stage : dev (runserver) / prod (gunicorn)
    ├── pyproject.toml         # deps + dev tools
    ├── manage.py
    ├── .env.example
    ├── config/                # projet Django
    │   ├── settings/
    │   │   ├── base.py        # commun
    │   │   ├── local.py       # dev (DEBUG=True, CORS *)
    │   │   └── production.py  # prod (HTTPS, HSTS, Supabase)
    │   ├── urls.py
    │   ├── wsgi.py / asgi.py
    │   └── celery.py
    └── apps/
        ├── core/              # mixins UUID + timestamps, enums Currency/Language
        ├── products/          # Product, ProductSupplier (PIM)
        ├── attributes/        # registre EAV + valeurs JSONB
        ├── clients/           # Client (Odoo + prospects locaux)
        ├── market/            # TransportMode, MarketParameter (cuivre/FX)
        ├── simulations/       # Simulation + Line + Recalculation
        ├── offers/            # Offer + OfferLine
        ├── documents/         # bibliothèque de PJ pour offres projet
        ├── odoo_sync/         # SyncLog
        └── data_migration/    # quarantaine de migration initiale
```

Chaque app est minimaliste : `models.py`, `admin.py`, `apps.py`.  Les vues
et serializers sont ajoutés au fur et à mesure des briques.

---

## Démarrage

### Prérequis

- **Docker** (optionnel) : Docker Desktop ≥ 24 + `docker compose` v2
- **Sans Docker** : Postgres 16 + Redis 7 + Python 3.12 (`uv`) + Node 20 — voir [docs/agent/local-dev.md](docs/agent/local-dev.md)

### Développement sans Docker (2 terminaux)

Si Docker Desktop bug, Postgres et Redis tournent en local (ex. Homebrew) :

```bash
# Une fois
./scripts/dev-setup.sh
cd backend && uv run python manage.py create_platform_user \
  --email toi@example.com --password secret --role admin

# Terminal 1
./scripts/dev-backend.sh

# Terminal 2
./scripts/dev-frontend.sh

# Terminal 3 (optionnel — PAMP Odoo, DeepL, exports)
./scripts/dev-celery.sh
```

→ Frontend http://localhost:3000 · API http://127.0.0.1:8000/api/health

Utiliser `backend/.env.native.example` comme modèle (hosts `127.0.0.1`, pas `postgres`/`redis`).

### Bootstrap (Docker)

```bash
# 1. cloner et entrer dans le repo
cd syskern

# 2. copier les variables d'env
cp backend/.env.example backend/.env
# (les valeurs par défaut suffisent pour le dev local)

# 3. build l'image backend
docker compose build

# 4. lancer la stack
docker compose up
```

Au premier `up`, le service `backend` :

1. attend que Postgres soit healthy
2. exécute `python manage.py migrate`
3. démarre le dev server sur http://localhost:8000

Vérifier :

- http://localhost:8000/api/health → `{"status": "ok"}`
- http://localhost:8000/api/docs/ → Swagger UI
- http://localhost:8000/admin/ → Django admin

### Initialiser les migrations (première fois)

Les migrations Django ne sont pas générées par défaut.  À la première
installation :

```bash
docker compose run --rm backend python manage.py makemigrations
docker compose run --rm backend python manage.py migrate
docker compose run --rm backend python manage.py createsuperuser
```

Les fichiers de migration générés doivent être committés (`apps/*/migrations/`).

---

## Workflow Docker

Toutes les commandes Python/Django passent **par Docker** (pas de venv local).

```bash
# shell Django
docker compose run --rm backend python manage.py shell_plus  # ou shell

# checks
docker compose run --rm backend python manage.py check

# nouvelle migration suite à un changement de modèle
docker compose run --rm backend python manage.py makemigrations <app>

# appliquer les migrations
docker compose run --rm backend python manage.py migrate

# tests
docker compose run --rm backend pytest

# linting
docker compose run --rm backend ruff check .
```

Rebuild après un changement de `pyproject.toml` :

```bash
docker compose build backend
```

Reset complet de la BDD locale :

```bash
docker compose down -v       # supprime le volume postgres
docker compose up
```

---

## Variables d'environnement

Documenté dans `backend/.env.example`.  Catégories principales :

| Préfixe | Rôle |
|---|---|
| `DJANGO_*` | settings Django (SECRET_KEY, DEBUG, ALLOWED_HOSTS, CORS) |
| `DATABASE_URL` | URL Postgres (local : Postgres docker, prod : Supabase) |
| `REDIS_URL` | broker Celery |
| `APP_PASSWORD` | mot de passe partagé MVP1 (sera remplacé par Supabase Auth) |
| `SUPABASE_*` | URL + JWT secret + service role (production) |
| `ODOO_*` | adapter Odoo (v16 / v19 selectionné via `ODOO_API_VERSION`) |
| `GAMMA_*`, `DEEPL_API_KEY`, `OPENAI_API_KEY` | services tiers de génération d'offres |

---

## Modèle de données

Les modèles reflètent fidèlement le schéma du CDC §3.2.  Points marquants :

- **UUID partout** (table `id` = uuid4) via `apps.core.models.BaseModel`
- **JSONB** pour les contenus multilingues, les snapshots de calcul, les
  options d'attributs dynamiques (Postgres `JSONField`)
- **Arrays de UUID** pour `client_ids` (Postgres `ArrayField`)
- **EAV** pour les attributs dynamiques (`attribute_registry` +
  `product_attribute_values`), avec index GIN sur la valeur JSONB
- **`Decimal(12,4)`** pour tous les prix → arithmétique décimale stricte,
  pas de `float`
- **Snapshots figés** côté `SimulationLine` (`product_snapshot`,
  `supplier_snapshot`, `calculation_breakdown`) : les modifications
  ultérieures du produit n'affectent pas une simulation finalisée
- **Trace historique** des recalculs dans `simulation_recalculations`
  (CDC §6.9.12)
- **Contrainte partielle** "une seule source fournisseur active par
  produit" via `UniqueConstraint(condition=Q(is_active=True))`

Voir chaque `apps/*/models.py` pour les commentaires inline qui pointent
les sections correspondantes du CDC.

---

## Production (Supabase + VPS OVH)

La cible production est documentée dans le CDC §9 :

- Supabase self-hosted (Postgres 16 + GoTrue + Storage) sur VPS OVH
- Reverse proxy Nginx + Let's Encrypt, HSTS, CSP
- Backups quotidiens vers S3 (rétention 7 jours, RPO indicatif 24 h)
- Backend déployé en mode `prod` (gunicorn + 3 workers) via le même
  Dockerfile (cible `prod`)

Pour basculer un environnement en prod :

```bash
DJANGO_SETTINGS_MODULE=config.settings.production \
DATABASE_URL=postgres://...supabase... \
SUPABASE_JWT_SECRET=... \
docker run --env-file .env.prod -p 8000:8000 syskern-backend:prod
```

`config/settings/production.py` impose `sslmode=require`, HSTS, le proxy
HTTPS header, et lit `ALLOWED_HOSTS` / `CORS_ALLOWED_ORIGINS` depuis
l'environnement.

---

## Roadmap immédiate (post-fondations)

Cette release n'inclut **que** les fondations (structure projet, modèles
BDD, settings, Docker).  Étapes suivantes :

1. **Sérialiseurs DRF** + **viewsets** par app (commencer par `products`
   et `attributes`)
2. **Moteur de calcul** dans `apps.simulations.services.engine` (CDC §6)
   avec tests unitaires sur l'exemple chiffré PA = 390.16 €/km
3. **Adapter Odoo** (`apps.odoo_sync.adapters/{base,v16,v19,factory}.py`)
4. **Auth** : middleware vérifiant `APP_PASSWORD` (MVP1) puis JWT Supabase
5. **Génération d'offres** : clients HTTP Gamma / OpenAI / DeepL,
   templates Excel
6. **Scripts de migration initiale** dans `apps.data_migration.scripts/`

---

## Licence

Code propriétaire — © Boldys / Syskern 2026.
