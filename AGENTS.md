# AGENTS.md — Syskern Pricing Platform

> Règles pour agents IA de code (Cursor, Claude Code) **et** développeurs.
> Source unique transverse, **chargée à chaque appel — garde-la courte (~200 lignes)**.
> `CLAUDE.md` ne fait que l'importer (`@AGENTS.md`).
> Détail mécanique (playbooks chargés à la demande) → `docs/agent/`.

---

## 1. Le projet en une page

Plateforme **PIM + pricing** pour le client **Syskern** (entité contractuelle : *Amplify Invest*).
Remplace un workflow de pricing sous Excel. Périmètre **MVP1**, trois domaines fonctionnels :

1. **PIM** — catalogue produit (`apps/products`, `apps/attributes`).
2. **Moteur de pricing** — chaîne **PA → PR → PV** (`apps/simulations`, `apps/market`).
3. **Générateur d'offres** — intègre l'API Gamma (`apps/offers`, `apps/documents`).

La même stack sera réutilisée pour un second client (**Symea Group**). Écris du code générique
au projet *quand le CDC le permet*, jamais des hacks spécifiques à un client sauf demande.

Spécification : `README.md`, `docs/Cahier des charges technique — Pricing Platform MVP1.md`,
Annexe Technique Projet-001. **Persona, besoins, règles métier = uniquement ces documents.**

---

## 2. Hiérarchie des sources (à respecter strictement)

Quand une info manque ou que deux sources se contredisent :

1. **Le code + `backend/pyproject.toml` + `uv.lock`** — vérité opérationnelle.
2. **README.md, CDC technique, Annexe Technique** — spécification fonctionnelle et métier.
3. **Instructions explicites du développeur dans la session.**
4. **Docs officielles à jour via Context7** (Django 5, DRF, Next.js) — voir §7.

Règles absolues :
- **N'invente jamais** un besoin client, une décision produit, une règle de pricing ou une hypothèse technique absente des sources 1-2.
- Si une info projet manque, **signale-la comme non définie** et demande — ne comble pas avec une « best practice ».
- **Arbitrage stack** : le CDC markdown contient encore des mentions FastAPI obsolètes. **Le code Django/DRF fait foi.** Si tu vois FastAPI/uvicorn dans un document, ignore-le et signale l'écart.

**Le CDC n'est pas à prendre au pied de la lettre.** C'est une spécification de départ, pas un contrat figé : le projet **dévie volontairement** du CDC quand le code/produit a évolué (ex. l'auth users+rôles vs le shared-password prévu — cf. `decisions.md`). C'est normal et attendu. La seule contrainte :
- **Toute déviation par rapport au CDC doit être documentée** dans `docs/agent/decisions.md` (entrée `[P]` datée, append-only).
- **Une déviation n'est un problème que si elle n'est PAS documentée.** Documentée = décision assumée, le code fait foi. Non documentée = dérive silencieuse à corriger (réaligner le code sur le CDC, ou documenter la décision).
- Donc avant de « corriger » du code qui semble contredire le CDC : vérifie `decisions.md`. Si la déviation y figure, **ne la défais pas** — étends-la. Sinon, signale-la et documente-la.

---

## 3. Stack (référence : `backend/pyproject.toml`, ne jamais recopier les versions ici)

| Couche | Choix |
|---|---|
| Backend | **Django 5 + DRF**, Python 3.12 |
| Async | **Celery + Redis** (`celery[redis]`, `django-celery-beat`) |
| DB | **PostgreSQL classique** — psycopg 3. Local : Postgres Docker. Prod : Postgres sur VPS OVH. **Aucun projet Supabase lié** (cf. `decisions.md` 2026-06-22) |
| Auth | Session Django + **users & rôles** (`admin`/`commercial`/`viewer`, `apps.accounts.Profile`). Prod cible : Supabase Auth JWT (stub) |
| API docs | drf-spectacular → `/api/docs/` |
| Frontend | **Next.js** (App Router), TypeScript |
| Serveur prod | gunicorn + whitenoise |
| HTTP externe | `httpx` (Odoo, Gamma, DeepL, OpenAI) |
| Gestion deps | **uv** (`uv.lock`). Jamais pip/requirements.txt |
| Qualité | **ruff**, **mypy** + django-stubs, **pytest-django** + factory-boy |

**N'ajoute jamais une dépendance** sans l'ajouter à `pyproject.toml` et régénérer `uv.lock`.

---

## 4. Carte du dépôt

```
syskern/
├── AGENTS.md / CLAUDE.md      # règles transverses, chargées à chaque call
├── docs/agent/                # playbooks + journal de décisions — chargés à la demande
├── docker-compose.yml         # stack locale (postgres, redis, backend)
├── README.md
├── docs/                      # CDC technique
├── data/                      # données source (Odoo, PO fournisseurs, base technique)
├── backend/                   # Django + DRF
│   ├── pyproject.toml · uv.lock
│   ├── config/                # settings/{base,local,production}, celery, urls
│   └── apps/
│       ├── core/              # BaseModel (UUID+timestamps), enums Currency/Language, pagination, auth
│       ├── products/          # PIM : Product, ProductSupplier, SupplierPriceHistory
│       ├── suppliers/         # module Fournisseurs : entité Supplier, CRUD, SKU liés, import batch PO
│       ├── attributes/        # registre EAV + valeurs JSONB
│       ├── clients/           # Client (Odoo + prospects locaux)
│       ├── market/            # Incoterm, TransportMode, MarketParameter (cuivre/FX) ; seeds dans seeds.py
│       ├── simulations/       # moteur pricing : Simulation/Line/Recalculation + services/engine
│       ├── offers/            # Offer/OfferLine + génération Gamma
│       ├── documents/         # PJ pour offres projet
│       ├── odoo_sync/         # adapters Odoo (factory v16/v19), SyncLog, tâches Celery
│       ├── accounts/          # auth : User Django + Profile (rôles admin/commercial/viewer), CRUD users admin
│       ├── i18n/              # traduction DeepL : cache (translation_cache), /api/translate, purge cron
│       └── data_migration/    # quarantaine migration initiale
└── frontend/                  # Next.js (App Router, TS) : src/{app,components,contexts,lib}
                               # lib/api.ts = client API · proxy.ts = BFF
```

---

## 5. Règles d'or (non négociables — c'est ici que les agents dérivent)

1. **Argent = `Decimal`, jamais `float`.** Tout le moteur pricing utilise `decimal.Decimal`.
2. **Le pricing vit dans UN seul endroit** : `apps/simulations/services/engine/` (`chain`, `context`, `modules`, `pamp`) + `runner.py`. **Ne calcule jamais un prix dans une vue, un serializer ou le frontend.**
3. **Odoo passe TOUJOURS par la factory** : `apps.odoo_sync.adapters.factory.get_odoo_adapter()` / `get_odoo_adapter_for(version)`. Aucun code hors `odoo_sync` ne connaît la version Odoo (CDC §5.1). Nouvelle version → nouvel adapter `vNN.py` branché dans `factory._instantiate`.
4. **Tout appel externe ou long (Odoo, Gamma, DeepL, exports) = tâche Celery.** L'endpoint renvoie `202 + {"task_id"}`, le client poll `/api/tasks/{task_id}/`. **Ne bloque jamais un thread de requête sur un I/O externe.**
5. **Soft-delete uniquement** sur les produits (`is_active = False`) — préserve les simulations historiques (CDC §4.6). Pas de hard-delete.
6. **Réutilise `core`** : tout modèle hérite de `BaseModel` (UUID PK + timestamps). Devises = `core.models.Currency` (EUR/USD/RMB). Langues = `core.models.Language` (fr/en/es). Ne redéfinis pas ces enums.
7. **Respecte le périmètre MVP1. N'ajoute aucune fonctionnalité hors CDC.** Bornes notables :
   - **Auth = vrais users + rôles** (`admin`/`commercial`/`viewer`, `apps.accounts.Profile` ; login session via `core.views.login_view`). ⚠️ **Écart assumé au CDC §9.1** (qui prévoyait un mot de passe unique partagé) — tracé dans `docs/agent/decisions.md`. Le code fait foi : étends cette auth, ne la remplace pas par un shared-password.
   - **Marge Symea** : défaut **6 %**, formule `PR = X / (1 - marge)`. Seul déplacement autorisé : toggle « avant/après transports » (CDC §6).
   - **Paramètres marché (cuivre, FX) saisis manuellement** et historisés. Pas de fetch auto de cours en MVP1.
8. **Performance DB** : `select_related` / `prefetch_related` systématiques. Pas de N+1.
9. **Messages API destinés à l'utilisateur en français.**
10. **Migrations** : après tout changement de modèle, `makemigrations` puis **commit** les fichiers `apps/*/migrations/`.

---

## 6. Conventions de code transverses

- Première ligne de chaque module Python : `from __future__ import annotations`.
- **Docstring de module = référence à la section CDC** implémentée (ex. `"""DRF views for the PIM (CDC §4.4)."""`).
- Typage : `mypy` doit passer (`django-stubs` actif).
- Lint/format : `ruff` (line-length 100, règles `E/F/I/W/UP/B/C4/DJ/SIM`). Ne désactive pas une règle pour « faire passer ».
- Tests : `pytest-django`, fixtures via `factory-boy`. Settings de test = `config.settings.local`.

---

## 7. Docs à jour — Context7 obligatoire

Ton training est périmé sur Django 5 / DRF / Next.js. **Avant d'écrire du code utilisant ces frameworks, récupère la doc à jour via le MCP Context7.** Ne code pas d'API framework de mémoire. Next.js en particulier a des breaking changes vs ton training — lis la doc à jour et tiens compte des dépréciations.

---

## 8. Workflow & commandes

```bash
docker compose up                                                   # stack locale (ou dev natif → docs/agent/local-dev.md)
docker compose run --rm backend python manage.py makemigrations     # migrations
docker compose run --rm backend python manage.py migrate
ruff check . && ruff format --check .                               # qualité backend (dans backend/)
mypy .
pytest
npm run lint && npx tsc --noEmit && npm run build                   # qualité frontend (dans frontend/)
```

Santé : `/api/health` → `{"status":"ok"}` · `/api/docs/` (Swagger) · `/admin/`.

**Definition of Done** :
- Backend (si touché) :
  - [ ] `ruff check` + `ruff format --check` propres
  - [ ] `mypy` sans erreur
  - [ ] `pytest` vert (tests ajoutés/maj pour la logique métier touchée)
  - [ ] migrations générées et committées si modèles modifiés
  - [ ] aucune dépendance ajoutée hors `pyproject.toml` + `uv.lock`
- Frontend (si touché) :
  - [ ] `npm run lint` propre, `npx tsc --noEmit` sans erreur de types
  - [ ] `npm run build` (`next build`) passe
  - [ ] checklist `docs/agent/frontend.md` respectée
- **Docs (systématique — cf. §11)** : toute PR / tâche qui touche code, modèle, API, convention ou dev local inclut la mise à jour des playbooks concernés **dans le même diff** (pas « plus tard »). Checklist §11.

> Pas de CI dans le repo : ces vérifications sont **locales et manuelles**. Ne suppose pas qu'un pipeline les rattrapera.

---

## 9. Commits & PR

- **Conventional Commits** : `feat:`, `fix:`, `refactor:`, `chore:`, `test:`, `docs:`. Corps en bullets si non trivial.
- Diffs **petits et ciblés**. Ne reformate pas de fichiers non concernés.
- Une PR = une brique/tâche cohérente : quoi + pourquoi + comment tester.

---

## 10. Interdits

- ❌ Changer la stack (réintroduire FastAPI, changer de gestionnaire de paquets).
- ❌ Modifier l'**Annexe Technique PDF** ou tout document contractuel sans instruction explicite.
- ❌ Inventer un besoin client, une règle de pricing ou une décision produit absente du CDC.
- ❌ Contourner la factory Odoo ou calculer un prix hors du moteur.
- ❌ Mettre des secrets/tokens dans le code (tout vit dans `.env`, cf. `.env.example`).
- ❌ Désactiver lint/typage/tests pour faire passer un build.
- ❌ Hard-delete des produits.

---

## 11. Auto-maintenance des règles (living docs)

Les playbooks de `docs/agent/` sont **vivants**. **Chaque changement de code qui introduit, modifie ou clarifie un comportement doit se solder par une mise à jour doc dans le même lot de travail** — pas en tâche séparée, pas « on verra plus tard ».

### Obligation systématique (agents et devs)

Avant de considérer une tâche **terminée**, parcours cette checklist et mets à jour ce qui s'applique :

| Déclencheur | Où documenter |
|---|---|
| Écart au CDC, choix d'archi, coexistence de deux modèles (enum + table, etc.) | `docs/agent/decisions.md` — entrée `[P]` ou `[T]` datée, append-only |
| Nouveau modèle, endpoint, contrainte DB, pattern backend récurrent | playbook domaine (`pim.md`, `pricing-chain.md`, …) **et** si transverse → `backend.md` |
| Nouvelle convention frontend (composant, autosave, env) | `frontend.md` (+ playbook domaine si spécifique) |
| Setup local, piège dev (versions Python, auth admin, ports) | `local-dev.md` |
| Nouveau domaine sans playbook | **créer** `docs/agent/<domaine>.md`, l'ajouter au routing ci-dessous |
| Carte du dépôt / routing obsolète | ce fichier (`AGENTS.md` §4 ou §11) — **garder court** |

**Une PR sans mise à jour doc quand la checklist s'applique = incomplète**, même si les tests passent.

### Routing (lecture avant tâche non triviale)

- backend → `docs/agent/backend.md`
- frontend → `docs/agent/frontend.md`
- dev local sans Docker → `docs/agent/local-dev.md`
- PIM (catalogue, attributs, seeds référence) → `pim.md`
- fournisseurs (entité Supplier, CRUD, SKU liés, import batch PO, historique prix) → `suppliers.md`
- migration initiale one-shot (orchestrateur, loaders, reset, dérivations) → `migration.md`
- offres (génération tarif/projet, Excel/Gamma, suivi) → `offers.md`
- multilingue / traduction (DeepL, cache, couverture, langue offre) → `i18n.md`
- comparaisons simulations → `pricing-chain.md` + `frontend.md` (§ `/comparator`)
- tableau de bord / page d'accueil → `frontend.md` (§ page d'accueil)
- sinon → `drf-resource.md`, `odoo-adapter.md`, `pricing-chain.md`, `celery-task.md`, `integrations.md`

### Règles de forme

- **Garde ce fichier court** (~200 lignes). Le détail mécanique vit dans `docs/agent/*.md`, jamais ici.
- **Nouvelle brique ou feature d'un domaine non encore couvert → crée un playbook** `docs/agent/<domaine>.md` (terse, sections stables), branche-le dans le routing ci-dessus.
- **Décisions d'architecture → `decisions.md`**, append-only et daté. N'écrase jamais une entrée passée.
- **Le code fait foi** : si une doc contredit le code réel, corrige la doc (pas l'inverse sans décision dans `decisions.md`).
