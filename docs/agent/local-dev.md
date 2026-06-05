# docs/agent/local-dev.md — Développement local sans Docker

> Alternative à `docker compose up` quand Docker Desktop pose problème.
> Stack : **Postgres + Redis** (Homebrew ou install existante) + **backend** (`uv`) +
> **frontend** (`npm`) dans des terminaux séparés.

---

## Prérequis (une fois)

| Outil | Version | Installation macOS (Homebrew) |
|---|---|---|
| Python | 3.12+ | `brew install python@3.12` |
| [uv](https://docs.astral.sh/uv/) | récent | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | 20+ | `brew install node@20` |
| PostgreSQL | 16 | `brew install postgresql@16` |
| Redis | 7 | `brew install redis` |

Démarrer les services système :

```bash
brew services start postgresql@16
brew services start redis
```

Créer la base et l'utilisateur (une fois) :

```bash
# Adapter si ton Postgres utilise un autre superuser (souvent ton login macOS)
createuser -s syskern 2>/dev/null || true
psql postgres -c "ALTER USER syskern WITH PASSWORD 'syskern';" 2>/dev/null || true
createdb -O syskern syskern 2>/dev/null || true
```

Vérifier :

```bash
pg_isready -h 127.0.0.1 -p 5432
redis-cli ping   # → PONG
```

**Format du fichier `backend/.env`** : pas d'espace autour du `=` (`MA_VAR=valeur`, pas `MA_VAR= valeur`).
Les scripts de dev **ne font pas** `source .env` (bash interprète mal les URLs) ; Django charge le fichier via `django-environ`.

---

## Configuration (une fois)

```bash
cd syskern

# Backend : .env avec localhost (pas postgres/redis Docker)
cp backend/.env.native.example backend/.env
# Si tu avais déjà un .env Docker, remplace au minimum :
#   DATABASE_URL=postgres://syskern:syskern@127.0.0.1:5432/syskern
#   REDIS_URL=redis://127.0.0.1:6379/0

# Frontend
cp frontend/.env.example frontend/.env.local
# BACKEND_URL=http://127.0.0.1:8000  (déjà la valeur par défaut)

# Dépendances
cd backend && uv sync --extra dev && cd ..
cd frontend && npm ci && cd ..

# Schéma + utilisateur plateforme
cd backend
uv run python manage.py migrate
uv run python manage.py create_platform_user \
  --email toi@example.com \
  --password ton-mot-de-passe \
  --role admin
cd ..
```

---

## Lancer au quotidien (3 terminaux)

**Terminal 1 — API Django**

```bash
./scripts/dev-backend.sh
```

→ http://127.0.0.1:8000/api/health

**Terminal 2 — Frontend Next.js**

```bash
./scripts/dev-frontend.sh
```

→ http://localhost:3000

**Terminal 3 — Celery (optionnel)**

Requis pour : recalcul PAMP Odoo, traduction DeepL, exports Excel.

```bash
./scripts/dev-celery.sh
```

Sans Celery, le catalogue et la fiche produit (lecture + édition PATCH) fonctionnent ;
les boutons async renverront une erreur ou resteront en attente.

---

## Vérifications rapides

| URL | Attendu |
|---|---|
| http://127.0.0.1:8000/api/health | `{"status":"ok"}` |
| http://127.0.0.1:8000/api/docs/ | Swagger |
| http://localhost:3000/login | Page de connexion |
| http://localhost:3000/catalog | Liste produits (après login) |

---

## Dépannage

**`connection refused` sur Postgres** — Postgres pas démarré : `brew services start postgresql@16`.

**`FATAL: role "syskern" does not exist`** — Recréer l'utilisateur (section prérequis) ou mettre dans `.env` une `DATABASE_URL` avec ton user macOS, ex. `postgres://$(whoami)@127.0.0.1:5432/syskern` (et `createdb syskern`).

**`redis connection error`** — `brew services start redis`. Pour tester sans Redis, seules les routes synchrones marchent.

**Frontend 401 / redirect login** — Créer un user avec `create_platform_user` (rôle `admin` ou `commercial`).

**`NEXT_PUBLIC_ODOO_BASE_URL`** — Ajouter dans `frontend/.env.local`, redémarrer `npm run dev` (en mode dev, pas besoin de rebuild).

**Réutiliser les données Docker** — Si tu avais déjà un volume Postgres Docker, tu peux soit garder cette BDD (exporter/import) soit repartir sur une BDD native vide + loaders `load_*` (cf. `data_migration`).

---

## Équivalence Docker ↔ natif

| Docker Compose | Natif |
|---|---|
| `docker compose up` | `./scripts/dev-backend.sh` + `./scripts/dev-frontend.sh` |
| `docker compose run --rm backend python manage.py …` | `cd backend && uv run python manage.py …` |
| hostname `postgres` | `127.0.0.1` |
| hostname `redis` | `127.0.0.1` |
| `BACKEND_URL=http://syskern-backend:8000` | `BACKEND_URL=http://127.0.0.1:8000` |
