# docs/agent/backend.md — Conventions backend (Django + DRF)

> Lis ce fichier avant toute tâche backend. Règles d'or transverses → `/AGENTS.md`.
> Patterns détaillés : `drf-resource.md`, `odoo-adapter.md`, `pricing-chain.md`, `celery-task.md`, `integrations.md`.
> Domaines : `pim.md` (catalogue produit + attributs).

## Organisation
- Projet Django dans `backend/config/` : `settings/{base,local,production}.py`, `urls.py`, `celery.py`, `wsgi/asgi.py`.
- Code métier dans `backend/apps/<app>/`, déclaré dans `INSTALLED_APPS` sous le préfixe `apps.` (groupe `LOCAL_APPS`).
- Settings splittés : `base.py` (commun) → `local.py` / `production.py` importent et surchargent. Dev & test = `config.settings.local`.
- Config via **django-environ** (`.env` lu au boot, variables dans `backend/.env.example`). **Jamais de secret en dur.**

## Anatomie d'une app
```
apps/<app>/
├── models.py        # modèles — héritent de core.BaseModel
├── serializers.py   # DRF (souvent list / detail / write séparés)
├── views.py         # ViewSets + APIView ; docstring → section CDC
├── urls.py          # app_name = "<app>" + DefaultRouter
├── admin.py · apps.py
├── filters.py       # FilterSet django-filter (si filtrage)
├── tasks.py         # tâches Celery (si async) → celery-task.md
├── services/        # logique métier lourde, hors vues (ex. moteur pricing)
└── tests/           # pytest
```
La logique métier non triviale va dans `services/`, **pas** dans les vues/serializers.

## Données de référence (seed)

Pour les référentiels fixes (incoterms, transport modes, attributs minimaux) :
- Constantes + helpers idempotents dans `apps/<app>/seeds.py` (`get_or_create` sur `code`).
- Chargement au déploiement via **data migration** `RunPython` qui importe le helper
  (réutilisable dans les tests). Reverse = suppression ciblée par `code`.
- Exemples : `apps/market/seeds.py`, `apps/attributes/seeds.py`.
- Ne pas seed les données saisies manuellement (`market_parameters` cuivre/FX).

## Modèles
- Hériter de `apps.core.models.BaseModel` → **UUID PK** + `created_at`/`updated_at`.
- Devises : `core.models.Currency` (EUR/USD/RMB). Langues : `core.models.Language` (fr/en/es). Contenu multilingue en **JSONB** (`{"fr": ..., "en": ...}`).
- Champs Postgres / JSONB via `django.contrib.postgres` (déjà installé).
- **Argent = `Decimal`** (`NUMERIC`), jamais float.
- **Soft-delete** produits : `is_active = False`, jamais de hard-delete (préserve les simulations).
- **Simulations finalized** : garde DRF (`SimulationViewSet`) **+** triggers PostgreSQL
  (`simulations/0003` : `simulations_guard_finalized`, `simulation_lines_guard_finalized_parent`).
  Détail schéma / champs snapshot → `pricing-chain.md`.

## DRF — baseline (config dans `settings/base.py`)
- Auth par défaut : `core.authentication.CsrfExemptSessionAuthentication` (topologie browser → proxy Next → Django, même origine).
- Permission par défaut : `IsAuthenticated` (`settings/local.py` force `AllowAny` en dev/test → d'où `APIClient()` sans auth dans les tests).
- Login : `core.views.login_view` (email + password → `django.contrib.auth.authenticate`). Users = `User` Django + `apps.accounts.Profile` (rôles `admin`/`commercial`/`viewer`). CRUD users admin-only dans `apps.accounts` (perm `IsAdmin`). ⚠️ **Écart assumé au CDC §9.1** (qui prévoyait un shared-password) → `decisions.md`. Prod cible : Supabase JWT (stub, voir `production.py`).
- Filtres globaux : `DjangoFilterBackend` + `SearchFilter` + `OrderingFilter`.
- Pagination : `LimitOffsetPagination`, `PAGE_SIZE=50`. Pour capper : `core.pagination.DefaultLimitOffsetPagination` (default 50 / max 500).
- Schéma : drf-spectacular (`/api/docs/`).
- **Ajouter une ressource → suis `drf-resource.md`** (ViewSet multi-serializer, lookup UUID-ou-clé-naturelle, `@action`, hooks `perform_*`).

## Async (Celery)
- Tout I/O externe ou long (Odoo, Gamma, DeepL, export Excel) = tâche Celery.
- Contrat HTTP : endpoint → `202` + `{"task_id", "status": "PENDING"}` ; client poll `/api/tasks/{task_id}/`.
- Détail (statuts de sync, retries) → `celery-task.md`.

## Intégrations
- **Odoo** : jamais d'accès direct. `apps.odoo_sync.adapters.factory.get_odoo_adapter[_for]`. v16/v19 derrière l'ABC `OdooAdapter`. → `odoo-adapter.md`.
- **Pricing** : moteur isolé dans `apps/simulations/services/engine/` + `runner.py` (Decimal, transaction, trace `SimulationRecalculation`). → `pricing-chain.md`.
- **Paramètres marché** (`apps/market`) : CRUD `GET/POST /api/market-parameters/` ;
  paramètre actif courant `GET /api/market-parameters/current/?parameter_type=copper_price`
  (FX : `fx_from_currency` + `fx_to_currency`). Cuivre/FX **non seedés** — saisie manuelle.
- **Lookup bulk SKU** (`apps/products`) : `POST /api/products/lookup-bulk` body `{skus: [...]}` →
  `{found: [{id, sku_code, name}], not_found: [...]}`. Une requête `sku_code__in`, produits actifs
  uniquement. Route **avant** le router DRF (évite le conflit `products/{pk}`).
- **Simulations CRUD** (`apps/simulations`) : `SimulationViewSet` + `SimulationLineViewSet`.
  Validations création/édition : projet = 1 client + `project_name` ; tarif = `client_ids` peut être vide.
  **`PATCH /api/simulations/{id}/`** : édition brouillon (label, clients, `market_params`, `calculation_chain`, marges, mix) → `is_dirty=True` via `perform_update`. Garde : `finalized` **et** `archived` → 403. DELETE finalized → 403 ; avec offres → 409.
  Lignes : `GET /api/simulation-lines/?simulation=&status_in=` (CSV `ok,warning,error` ; legacy
  `has_warning`/`has_error`). Recalc : `POST .../recalculate/` body `{scope, market_params?}` —
  `market_params` persistés avant recalc pour **tout** scope si fournis. Tests :
  `apps/products/tests/test_lookup_bulk.py`, `apps/simulations/tests/test_views.py`, `apps/simulations/tests/test_engine.py`.
- **Gamma / OpenAI / DeepL** : clients `httpx` dans `apps/offers/services/` (pattern client simple, sans factory). → `integrations.md`.
- HTTP sortant via `httpx`. Tout appel réseau encapsulé dans une tâche Celery (jamais dans une vue).

## Qualité & tests
- `ruff` (line 100, `E/F/I/W/UP/B/C4/DJ/SIM`, `E501` ignoré — formatter gère).
- `mypy` + `django-stubs` (settings `config.settings.local`).
- `pytest-django` : tests dans `apps/<app>/tests/`, fichiers `test_*.py` / `*_test.py` / `tests.py`. Fixtures via `factory-boy`. `pytest-cov` dispo.

```bash
docker compose run --rm backend python manage.py makemigrations
docker compose run --rm backend python manage.py migrate
docker compose run --rm backend pytest
# avant de clore : ruff check . && ruff format --check . && mypy . && pytest
```

## Gotchas (vu dans le code — respecte-les)
- `from __future__ import annotations` en tête de chaque module.
- Docstring de module = section CDC implémentée.
- **Imports tardifs** (dans la méthode) pour deps lourdes/croisées → chargement des vues léger.
- Messages d'erreur API **en français**.
- Après modif de modèle : `makemigrations` + **commit** les migrations.
- psycopg **3** (`ENGINE = django.db.backends.postgresql`).
- Lookup détail produit : accepte UUID **ou** `sku_code`.
- **`create_platform_user`** = auth plateforme (`Profile.role`) ; **pas** l'accès Django admin
  (`is_staff`/`is_superuser`) → `createsuperuser` ou flags manuels (cf. `local-dev.md`, `decisions.md`).
- **Python 3.12** en dev/prod — pas 3.14 (admin Django cassé). Pin : `backend/.python-version`.