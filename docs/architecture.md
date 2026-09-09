# Architecture — Syskern Pricing Platform (MVP1)

Vue d’ensemble pour un développeur qui reprend le projet. Détail métier →
[CDC technique](Cahier%20des%20charges%20technique%20—%20Pricing%20Platform%20MVP1.md).
Écarts assumés → [`agent/decisions.md`](agent/decisions.md).

---

## 1. Pourquoi cette plateforme

Remplace un workflow Excel de pricing pour **Syskern** (entité contractuelle
*Amplify Invest*). Trois domaines MVP1 :

1. **PIM** — catalogue produit (`apps/products`, `apps/attributes`, `apps/suppliers`)
2. **Moteur de pricing** — chaîne **PA → PR → PV** (`apps/simulations`, `apps/market`)
3. **Générateur d’offres** — Excel tarif + Gamma devis projet (`apps/offers`, `apps/documents`)

La stack est conçue pour être réutilisable pour un second client (**Symea Group**)
sans hardcoder Syskern hors des points CDC.

---

## 2. Schéma global

```
┌─────────────┐     session cookie      ┌──────────────────────────────┐
│  Next.js    │ ◄────────────────────► │  Django 5 + DRF (gunicorn)   │
│  App Router │   BFF proxy.ts /api/*   │  /api/* · /admin/ · /api/docs│
└─────────────┘                         └──────────────┬───────────────┘
                                                       │
                    ┌──────────────────────────────────┼──────────────────┐
                    │                                  │                  │
                    ▼                                  ▼                  ▼
             ┌────────────┐                    ┌────────────┐      ┌────────────┐
             │ PostgreSQL │                    │   Redis    │      │   Celery   │
             │  (psycopg3)│                    │  broker    │      │ worker+beat│
             └────────────┘                    └────────────┘      └─────┬──────┘
                                                                         │
                              httpx (jamais dans le thread requête)       │
                    ┌────────────┬────────────┬────────────┬─────────────┘
                    ▼            ▼            ▼            ▼
                 Odoo v16/v19  Gamma.app    DeepL       OpenAI
                 (JSON-RPC)    (devis)    (traduction) (copy)
```

**Local** : `docker compose` (postgres + redis + backend + worker + beat + frontend)
ou scripts natifs → [`agent/local-dev.md`](agent/local-dev.md).

**Prod** : VPS OVH, orchestré par **Coolify** (Dockerfiles multi-stage, Traefik
en reverse proxy TLS). Voir [`runbooks/vps-setup.md`](runbooks/vps-setup.md).

---

## 3. Choix techniques (vérité opérationnelle)

| Couche | Choix | Notes |
|---|---|---|
| Backend | Django 5 + DRF, Python 3.12 | CDC mentionne encore FastAPI → **ignorer** |
| API docs | drf-spectacular | Live : `/api/docs/` · schéma : `/api/schema/` · export : [`api/`](api/) |
| Async | Celery + Redis + django-celery-beat | Externes / longs → `202 + task_id` |
| DB | **PostgreSQL classique** | Local Docker / prod VPS. **Aucun projet Supabase** lié ([décision 2026-06-22](agent/decisions.md)) |
| Auth MVP1 | Session Django + rôles `admin` / `commercial` / `viewer` | Écart CDC §9.1 (shared-password) — documenté |
| Auth prod cible | JWT Supabase Auth | Stub (`SUPABASE_*`) — non branché en live |
| Frontend | Next.js App Router, TypeScript | Client API : `frontend/src/lib/api.ts` |
| Serveur | gunicorn + whitenoise | Target Docker `prod` |
| Deps | **uv** (`uv.lock`) | Pas de `requirements.txt` |
| Qualité | ruff, mypy, pytest-django, pre-commit | Pas de CI dans le repo |

Versions exactes → `backend/pyproject.toml` + `uv.lock` (ne pas les recopier ici).

---

## 4. Carte des apps Django

| App | Rôle |
|---|---|
| `core` | `BaseModel` (UUID + timestamps), enums Currency/Language, auth login session, health, pagination |
| `accounts` | `Profile` (rôles), CRUD users admin |
| `products` | PIM : Product, ProductSupplier, SupplierPriceHistory |
| `attributes` | Registre EAV + valeurs JSONB |
| `suppliers` | Entité Supplier, import batch PO |
| `clients` | Clients Odoo + prospects locaux |
| `market` | Incoterm, TransportMode, MarketParameter (cuivre / FX) |
| `simulations` | Moteur pricing **uniquement** dans `services/engine/` |
| `offers` | Offres + clients Gamma / OpenAI / DeepL (traduction aussi via `i18n`) |
| `documents` | Pièces jointes offres projet |
| `odoo_sync` | Factory adapters v16/v19, SyncLog, tâches Celery |
| `i18n` | Cache DeepL, `/api/translate`, purge cron |
| `data_migration` | Migration initiale one-shot + quarantaine |

---

## 5. Invariants d’architecture (non négociables)

1. **Argent = `Decimal`**, jamais `float`.
2. **Pricing** uniquement dans `apps/simulations/services/engine/` (+ `runner.py`).
3. **Odoo** uniquement via `get_odoo_adapter()` / `get_odoo_adapter_for(version)`.
4. **I/O externe** = Celery (sauf exceptions documentées, ex. `POST /api/translate` court).
5. **Soft-delete** produits (`is_active=False`) — pas de hard-delete.
6. Messages API utilisateur en **français**.

---

## 6. Flux métier clés

### Sync Odoo (quotidien 03:00 UTC)

Celery Beat → `odoo_sync.sync_task` (scope `all`) → adapter factory → upsert
produits (y compris `supplierinfo`) / stock / clients. Historique dans `sync_logs`.
Inventaire (objets, sens, fréquence, scopes no-op) → [`agent/odoo-sync.md`](agent/odoo-sync.md).
Mapping champs → [`odoo-mapping.md`](odoo-mapping.md). Troubleshooting →
[`runbooks/odoo-sync-troubleshooting.md`](runbooks/odoo-sync-troubleshooting.md).

### Chaîne de pricing PA → PR → PV

Saisie simulation → moteur (`chain` / `modules` / `pamp`) → snapshots figés sur
`SimulationLine`. Marges : Symea 6 % (toggle avant/après transports), Syskern
20 % (fixe, avant transports vente). Playbook → `agent/pricing-chain.md`.

### Offre projet

Création Offer → Celery `run_generation` → OpenAI (copy) + Gamma (PDF) →
statut + URLs. Traduction produit : DeepL + cache `i18n`.

### Migration initiale (one-shot)

Orchestrateur `run_migration` (4 steps) → go-live → `MIGRATION_LOCKED=true`.
Runbooks → [`runbooks/migration.md`](runbooks/migration.md),
[`migration-reset.md`](runbooks/migration-reset.md).

---

## 7. Liens CDC (sections utiles)

| Sujet | CDC |
|---|---|
| Modèle de données | §3 |
| PIM / soft-delete | §4 |
| Sync Odoo | §5 |
| Moteur pricing | §6 |
| Offres / Gamma | §7 |
| Migration initiale | §8 |
| Auth / secrets / HTTPS / backups / logs | §9 |
| i18n / DeepL | §10 |

Quand le CDC contredit le code : vérifier `agent/decisions.md` avant de « corriger ».
