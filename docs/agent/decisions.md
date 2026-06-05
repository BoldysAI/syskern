# docs/agent/decisions.md — Journal de décisions (append-only)

> ADR-lite. Append uniquement, daté. N'écrase jamais une entrée. Format : date · décision · raison.
> [P] = décision projet · [T] = décision outillage/agents.
> **C'est ici qu'on documente toute déviation au CDC** (cf. `/AGENTS.md` §2). Une déviation documentée = décision assumée ; une déviation non documentée = dérive à corriger.

## 2026-06-04 · [P] Stack backend = Django 5 + DRF (migration depuis FastAPI)
Validé par toutes les parties. Le code et `pyproject.toml` font foi. Le CDC markdown contient encore des mentions FastAPI obsolètes → ignorer / resynchroniser séparément.

## 2026-06-04 · [P] Gestion des dépendances = uv
Deps dans `backend/pyproject.toml`, lock dans `uv.lock`. Pas de pip/requirements.txt.

## 2026-06-04 · [T] Framework agents = 2 couches
`/AGENTS.md` (transverse, chargé à chaque call, ~200 lignes) + `docs/agent/*.md` (playbooks à la demande). Pas d'`AGENTS.md` imbriqués backend/frontend : Cursor ne les charge pas de façon fiable, et multiplier les fichiers fragilise la boucle full-auto.

## 2026-06-04 · [T] CLAUDE.md = import d'AGENTS.md
`/CLAUDE.md` contient `@AGENTS.md`. Source unique, lue par Cursor et Claude Code.

## 2026-06-04 · [T] Living docs en full-auto
L'agent met à jour `docs/agent/*.md` directement, sans gate. Décisions d'archi → ce fichier (append-only) pour survivre au multi-agent / multi-branche.

## 2026-06-04 · [T] Suppression de frontend/AGENTS.md + frontend/CLAUDE.md
Stub auto-injecté par un codemod Next.js. Conventions front déplacées dans `docs/agent/frontend.md`. Peut réapparaître si un codemod Next est relancé.

## 2026-06-04 · [P] PIM — couche modèle déjà livrée, ticket "migrations initiales" = gap-only
Les tickets `[PIM] Modèle de données produits et migrations initiales` (parent + sous-tâches) décrivent des migrations Alembic/FastAPI. **Le modèle de données est déjà implémenté en Django/DRF et migré** : `products` (hiérarchie 4 niveaux, indexation cuivre, conditionnement, PAMP, index `idx_products_sku`/`idx_products_odoo`/`idx_products_hierarchy`/`idx_products_factory`), `attribute_registry` + `product_attribute_values` (regex `code`, label JSONB, `UNIQUE(product, attribute)`, FK CASCADE, GIN `idx_pav_value_gin`), `product_suppliers` (index unique partiel `one_active_supplier_per_product WHERE is_active=true`, FK CASCADE), `transport_modes`. Décision : ne livrer que le manquant (table incoterms, seed, tests modèles, doc), pas de re-création de schéma. Alembic/FastAPI = obsolète (cf. décision stack Django).

## 2026-06-04 · [P] Incoterms = table de référence `incoterms` coexistant avec l'enum
Le code modelait les incoterms uniquement comme `apps.products.models.Incoterm` (TextChoices), avec une note "pas besoin de table". Le CDC §3.3 demande un pré-chargement des 11 incoterms. Décision : créer une **table `incoterms`** (modèle `apps.market.models.Incoterm`, seedée des 11 codes ICC 2020) servant de référentiel ; `/api/market/incoterms` lit désormais la table. **L'enum est conservé** comme source de validation des CharField `incoterm` sur `ProductSupplier`, `OfferLine`, `Client.preferred_incoterm` — **pas de conversion en FK** en MVP1 (risque trop large : pricing, offers, loaders). Coexistence assumée.

## 2026-06-04 · [P] Seed des données de référence = data migrations Django idempotentes
Les données de référence (11 incoterms, 7 transport_modes, 5 attributs minimaux) sont chargées via **data migrations Django** (`RunPython`, idempotent via `get_or_create` sur `code`), pas via un script ad hoc. Logique réutilisable extraite dans `apps/market/seeds.py` et `apps/attributes/seeds.py` (appelée par les migrations et par les tests). S'exécute automatiquement au `migrate` → visible dès le premier déploiement. `market_parameters` (cuivre/FX) **non seedé** : saisie manuelle (cf. AGENTS.md §5.7).

## 2026-06-04 · [P] Attributs minimaux vs colonnes Product (chevauchement assumé)
`hs_code`, `gtin`, `dop_number`, `unit_weight_kg`, `pallet_qty` existent déjà comme **colonnes first-class** de `products.Product`. Le CDC §3.3 demande aussi de les enregistrer dans `attribute_registry`. Décision : les seeder dans le registre comme demandé. Le chevauchement (colonne + attribut dynamique) est connu et assumé pour MVP1 ; aucune synchronisation automatique entre les deux n'est implémentée.

## 2026-06-04 · [P] Auth = vrais users + rôles (écart assumé au CDC §9.1)
Le CDC §9.1 prévoyait un **mot de passe unique partagé** sans gestion d'utilisateurs en MVP1. Le code a finalement implémenté une **auth utilisateurs réelle** : `User` Django + `apps.accounts.Profile` (rôles `admin`/`commercial`/`viewer`), login session (`core.views.login_view`), CRUD users admin-only (`apps.accounts`), et côté front `lib/auth.ts` + `/admin/users`. Décision : **le code fait foi**, cet écart au CDC est assumé. Le module shared-password (`core.permissions` : `AppPasswordAuthentication`, `SharedPasswordRequired`, `validate_app_password`) et le setting `APP_PASSWORD` sont du **code mort** → retirés. Prod cible inchangée : Supabase Auth JWT (stub, cf. `production.py`).

## 2026-06-05 · [P] Fiche produit détaillée (Écran 2, CDC §4.1.2 / §4.3) — choix d'implémentation
Refonte **en place** de `frontend/src/app/catalog/[sku]/page.tsx` : layout 2 colonnes (carte infos clés à gauche, 6 onglets à droite : Général, Technique, Marketing, Logistique, Commercial, Médias), édition en place avec autosave (`useAutosave`, debounce 2s). Décisions notables :
- **Lien « Voir dans Odoo »** : l'URL Odoo est exposée au front via `NEXT_PUBLIC_ODOO_BASE_URL` (et non via un champ calculé backend). L'URL produit construite est `${NEXT_PUBLIC_ODOO_BASE_URL}/web#id=<odoo_id>&model=product.template`. ⚠️ `NEXT_PUBLIC_*` est inliné au build Next.js → changer la valeur impose un rebuild. Bouton désactivé si `odoo_id` est null ou si la variable est vide.
- **Édition gardée par `canEdit(role)`** (admin/commercial) : le bouton « Modifier » n'apparaît pas pour `viewer`. Le CDC ne précisait pas le contrôle d'accès sur l'écran 2 ; on aligne sur l'auth rôles déjà en place.
- **Autosave** : champs cœur via `PATCH /api/products/{id}` (batché — un burst d'édits = un seul appel après debounce), attributs via `PUT /api/products/{id}/attributes/{attr}/`. Affichage optimiste (les inputs reflètent le draft immédiatement) ; en cas d'erreur backend → message + rollback (purge du draft + refetch SWR). Validation client par `data_type` avant envoi (les valeurs invalides ne sont jamais persistées).
- **`AttributeRenderer`** (`frontend/src/components/AttributeRenderer.tsx`) : composant autonome réutilisable rendant les 6 `data_type` en lecture/édition. Conçu pour réemploi futur dans le wizard de création produit (hors scope de cette tâche).
- **Hors scope MVP1 (placeholders explicites « MVP2 »)** : onglet **Médias** et bouton **Historique des modifications**.
- **Source unique des descriptions** : le modèle n'a que `description_marketing` et `description_technical` (JSON multilingue). Les « descriptions multilingues » (Général) éditent `description_marketing` ; l'onglet Marketing porte les **attributs** de catégorie `marketing` (contenus enrichis). Pas de double éditeur sur le même champ.