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

## 2026-06-11 · [P] `create_platform_user` ≠ accès Django admin (`/admin/`)
La commande `create_platform_user` positionne `User.is_active=True` et `Profile.role` (`admin`/`commercial`/`viewer`) pour l'**auth applicative** (frontend `/login`, API session). Elle **ne positionne pas** `is_staff` ni `is_superuser`. L'admin Django (`/admin/`) exige `is_staff=True` (et en pratique `is_superuser=True` pour tout gérer). Décision : **deux chemins distincts** — plateforme → `create_platform_user` ; Django admin → `createsuperuser` ou activation manuelle des flags sur un user existant. Ne pas fusionner les deux sans décision explicite.

## 2026-06-11 · [P] Python 3.12 requis — 3.14 incompatible avec Django admin
Le backend cible **Python 3.12** (`AGENTS.md` §3, image Docker `python:3.12`, `backend/.python-version`). Python **3.14** provoque un crash sur toutes les pages admin Django 5.1 (`AttributeError: 'super' object has no attribute 'dicts'` dans `django/template/context.py`). `pyproject.toml` borne `requires-python` à `<3.14`. En dev natif : `uv sync --python 3.12` et vérifier `uv run python --version`.

## 2026-06-05 · [P] Fiche produit détaillée (Écran 2, CDC §4.1.2 / §4.3) — choix d'implémentation
Refonte **en place** de `frontend/src/app/catalog/[sku]/page.tsx` : layout 2 colonnes (carte infos clés à gauche, 6 onglets à droite : Général, Technique, Marketing, Logistique, Commercial, Médias), édition en place avec autosave (`useAutosave`, debounce 2s). Décisions notables :
- **Lien « Voir dans Odoo »** : l'URL Odoo est exposée au front via `NEXT_PUBLIC_ODOO_BASE_URL` (et non via un champ calculé backend). L'URL produit construite est `${NEXT_PUBLIC_ODOO_BASE_URL}/web#id=<odoo_id>&model=product.template`. ⚠️ `NEXT_PUBLIC_*` est inliné au build Next.js → changer la valeur impose un rebuild. Bouton désactivé si `odoo_id` est null ou si la variable est vide.
- **Édition gardée par `canEdit(role)`** (admin/commercial) : le bouton « Modifier » n'apparaît pas pour `viewer`. Le CDC ne précisait pas le contrôle d'accès sur l'écran 2 ; on aligne sur l'auth rôles déjà en place.
- **Autosave** : champs cœur via `PATCH /api/products/{id}` (batché — un burst d'édits = un seul appel après debounce), attributs via `PUT /api/products/{id}/attributes/{attr}/`. Affichage optimiste (les inputs reflètent le draft immédiatement) ; en cas d'erreur backend → message + rollback (purge du draft + refetch SWR). Validation client par `data_type` avant envoi (les valeurs invalides ne sont jamais persistées).
- **`AttributeRenderer`** (`frontend/src/components/AttributeRenderer.tsx`) : composant autonome réutilisable rendant les 6 `data_type` en lecture/édition. Conçu pour réemploi futur dans le wizard de création produit (hors scope de cette tâche).
- **Hors scope MVP1 (placeholders explicites « MVP2 »)** : onglet **Médias** et bouton **Historique des modifications**.
- **Source unique des descriptions** : le modèle n'a que `description_marketing` et `description_technical` (JSON multilingue). Les « descriptions multilingues » (Général) éditent `description_marketing` ; l'onglet Marketing porte les **attributs** de catégorie `marketing` (contenus enrichis). Pas de double éditeur sur le même champ.

## 2026-06-16 · [P] Wizard de création produit (Écran 4, CDC §4.1.3) + parsing SKU + gestion fournisseurs
Implémentation de `[PIM] Wizard de création produit + gestion fournisseurs par SKU` (parent + 3 sous-tâches). Décisions notables :
- **Parsing SKU** : module `apps/products/services/sku_parser.py` (`extract_factory_code`, `extract_parent_reference`, `parse_sku`) + endpoint utilitaire `POST /api/products/parse-sku` (action `detail=False`). Le suffixe de spécification est `-NN` / `-ENN` (`re.compile(r"-(E?\d{1,3})$")`). **Correction du regex `extract_parent_reference` du ticket** : le littéral `^(.+?)(-E?\d{1,3})?$` est bugué (un `.+?` non-greedy + groupe optionnel matche toute la chaîne → renvoie le SKU *avec* son suffixe, contredisant l'exemple `KCFF6A4PZHDBL5-21 → KCFF6A4PZHDBL5`). On retire le suffixe via `re.sub` à la place, conforme aux critères d'acceptation. La casse est normalisée (upper + trim).
- **Wizard `/catalog/new`** : route statique (prioritaire sur `/catalog/[sku]`). 5 étapes (Identification, Technique, Logistique, Fournisseur(s), Validation) + **toggle « Formulaire complet »** (tout sur une page). Validation par étape (SKU regex + nom + `description_marketing.fr` requis ; cohérence cuivre — miroir `ProductWriteSerializer`). **Brouillon `localStorage`** (`syskern:new-product-draft:v1`, restauré au montage via initializer paresseux `useState`, écrit via effet sans `setState`, purgé au succès). SKU `onBlur` → `parseSku` → pré-remplit `parent_reference`/`factory_code` (surchargés : si l'utilisateur édite le champ, l'auto-fill ne l'écrase plus). Création gardée par `canEdit(role)`.
- **Flux de création** : `POST /api/products/` → boucle `PUT /api/products/{id}/attributes/{attr}/` (attributs `technical` non vides) → boucle `POST /api/products/{id}/suppliers/`. **Sync Odoo non bloquante** : déjà déclenchée côté serveur par `perform_create` (`_push_to_odoo_async`, statut `pending_odoo_sync` + retry horaire), donc la création locale réussit même si Odoo est indisponible — aucun appel de sync explicite côté client.
- **Gestion fournisseurs** : composant réutilisable `frontend/src/components/SupplierManager.tsx` (CRUD + toggle « Source active » mutex UI + suppression confirmée via `Dialog` Radix — pas de nouvelle dépendance `alert-dialog`). Intégré **inline** dans l'onglet Commercial (wiring API + `mutate` SWR, gardé par `canEdit`) **et** dans l'étape 4 du wizard (wiring sur draft local, ids `crypto.randomUUID()`). Pas de route dédiée `/catalog/[sku]/suppliers`.
- **Activation atomique** : `activate_supplier` (nested) et `ProductSupplierViewSet.activate` (plat) enveloppés dans `transaction.atomic()` pour ne jamais violer l'index partiel `one_active_supplier_per_product` en cours de bascule.
- **Pré-remplissage des paramètres de calcul depuis le fournisseur actif** : déjà assuré par le moteur (`apps/simulations/services/runner.py` lit `suppliers.filter(is_active=True).first()` au calcul) — aucun code ajouté.

## 2026-06-16 · [P] Feedback wizard — hiérarchie en dropdown, fournisseurs existants, fil d'Ariane, push Odoo v19
Retours utilisateur après test du wizard `/catalog/new` :
- **Hiérarchie** : univers / famille / gamme / sous-gamme en `Select` en cascade (`GET /api/hierarchy/distinct` + reset enfants au changement de parent).
- **Fournisseurs existants** : `GET /api/supplier-names` (noms distincts) + `GET /api/supplier-names/template?name=…` (dernière ligne `ProductSupplier` pour pré-remplir prix/incoterm/cuivre). `SupplierManager` propose « Fournisseur existant » vs « Nouveau fournisseur ».
- **Fil d'Ariane** : segment `new` mappé à « Nouveau produit » dans `AppShell` (pas le slug brut).
- **Odoo v19 — `product.template.type`** : la valeur v16 `product` (stockable) n'existe plus en v19 (`consu` / `service` / `combo`). Push create/update v19 → `type: "consu"` + `is_storable: True` (`OdooAdapterV19.payload_from_product`). v16 inchangé (`type: "product"`).

## 2026-06-16 · [P] Catalogue — recherche full-text, filtres avancés, export colonnes
Implémentation de `[PIM] Catalogue frontend avec filtres avancés et recherche full-text` (parent + 3 sous-tâches). Décisions notables :
- **Recherche full-text = trigger, pas colonne générée.** `products.search_vector` (`tsvector`) est maintenu par un **trigger `BEFORE INSERT/UPDATE`** (`products_search_vector_trigger`), pas par une colonne `GENERATED ALWAYS … STORED`. Raison : avec une colonne générée, l'ORM Django (qui liste `search_vector` comme colonne concrète) tente d'y insérer `NULL` → `cannot insert a non-DEFAULT value into a generated column`. Le trigger laisse l'ORM écrire `NULL` puis recalcule. Le ticket listait les deux mécanismes (colonne générée *et* trigger) ; on retient le trigger. Dictionnaires combinés avec `setweight` : `simple` (poids A) pour `sku_code`/`parent_reference`, `french` (B/C) pour `name` + `description_*->>'fr'`, `simple` (D) pour `description_marketing->>'en'/'es'`. Migration `0004_product_search_vector` en `SeparateDatabaseAndState` (état ORM = `SearchVectorField(editable=False, null=True)` + `GinIndex`, DB = trigger + index GIN). Champ exposé via `?q=` (`SearchQuery` `french` OR `simple`, tri `SearchRank`). Le param DRF `search` (icontains) reste en repli.
- **Export = Celery async maintenu (écart au mot « streaming » du ticket).** Le ticket sous-tâche 3 décrit une « streaming response » synchrone ; **AGENTS.md §4 impose Celery async** (`202 + task_id`, poll, download). On conserve l'async (`export_products_task` → fichier `/tmp/syskern_exports/{task_id}.xlsx`, download `/api/products/exports/{task_id}`). Le body POST accepte désormais `{filters, columns, ids}` (au lieu des seuls query-params) ; `ids` = export d'une sélection multiple ; `columns` = sous-ensemble ordonné (registre `_COLUMN_REGISTRY` dans `exports.py`, **mirroré** côté front dans `app/catalog/_components/columns.ts` — garder synchro). Nom de fichier `catalog_<timestamp>.xlsx`. Tests réécrits sur le contrat async (endpoint = 202) + logique testée via `export_products_task.apply()` (in-process, sans worker / sans Celery eager global).
- **Filtres attributs dynamiques = flag `is_filterable`.** Nouveau champ `AttributeRegistry.is_filterable` (défaut `False`, migration `attributes/0004`). `ProductFilter` lit les query-params `attr_<code>=valeur` et ne les honore **que** pour les attributs `is_filterable=True` (jointure `attribute_values`, `value` exact pour text/select/boolean/number, `value__contains` pour multiselect, `.distinct()`). Hiérarchie (`universe`/`family`/`range`/`sub_range`), marque, `factory_code` et `supplier` en **multi CSV** ; filtres `pamp_min`/`pamp_max`, `stock_min`, `in_stock`.
- **Tri catalogue = `ProductOrderingFilter`.** `apps/products/ordering.py` remplace le `OrderingFilter` DRF par défaut sur `ProductViewSet` pour appliquer **`NULLS LAST`** sur `pamp_eur` et `stock_quantity`. Raison : les produits wizard (PAMP non synchronisé depuis Odoo → `pamp_eur IS NULL`) remontaient en tête d'un tri `DESC` Postgres. Tests : `apps/products/tests/test_ordering.py`.
- **Fiche produit depuis le catalogue = drawer + lien.** Clic sur une ligne → **drawer slide-over** (`ProductDrawer`, Radix Dialog) avec résumé + bouton « Ouvrir la fiche complète » ; la cellule SKU est un lien direct vers `/catalog/[sku]`. (CDC §4.3 : « slide-over (drawer) ou nouvel onglet ».)
- **Tri serveur** (param `ordering`, remplace l'ancien tri client-side qui ne triait que la page courante — bug). **Sélection multiple** persistée à travers les pages (`Set<string>` d'ids non réinitialisé au changement de page) → actions groupées (export sélection, `AddToSimulationDialog` généralisé `productIds[]` réutilisant `POST /api/simulations/{id}/lines`). **Filtres favoris** en `localStorage` (`syskern:catalog-filters:v1`), **largeurs de colonnes** en `localStorage` (`syskern:catalog-col-widths:v1`).

## 2026-06-16 · [P] Catalogue — UX filtres, tri cyclique, PAMP NULL, wizard brouillon
Itérations post-livraison du catalogue (retours utilisateur + corrections bugs) :
- **Filtres sidebar = multi-sélection par cases à cocher** (hiérarchie, marque, fournisseur, attributs `select`/`multiselect`) avec recherche locale dans les listes longues, badges de comptage par section, bouton « Effacer » par groupe. Niveaux hiérarchie **indépendants** (plus de cascade obligatoire côté UI — chaque niveau charge `GET /api/hierarchy/distinct?level=…`). Chips actifs au-dessus du tableau (`ActiveFilterBar` + `active-filters.ts`) ; panneau mobile `CatalogFilterSheet`.
- **Pagination** : 100 lignes/page ; `CatalogPagination` (numéros + ellipses + « Aller à »).
- **Tri colonnes (front)** : cycle **croissant → décroissant → défaut (SKU ↑)** par clic sur l'en-tête (évite le nested `setState` qui bloquait le toggle desc).
- **Colonnes redimensionnables** : poignée élargie, persistance corrigée dans `useColumnWidths`.
- **Tri PAMP (back)** : `ProductOrderingFilter` avec `NULLS LAST` sur `pamp_eur`/`stock_quantity` — les produits wizard (`pamp_eur` null, affichés « — ») ne dominent plus un tri décroissant.
- **Soft-delete depuis la fiche** : bouton « Supprimer » (`DELETE /api/products/{id|sku}/`, `deleteProduct()` dans `lib/api.ts`) pour `canEdit` ; redirection catalogue.
- **Wizard brouillon** : `localStorage` conserve les champs mais **pas l'étape** du wizard — réouverture toujours sur Identification (étape 0).
- **Export Celery** : signature `export_products_task(filters, columns, ids)` — **redémarrer le worker** après changement de signature (`./scripts/dev-celery.sh`), sinon `TypeError: unexpected keyword argument 'filters'`.

## 2026-06-18 · [P] PIM — admin du registre d'attributs dynamiques (`/settings/attributes`)
Implémentation de `[PIM] Admin du registre d'attributs dynamiques` (CDC §4.1.4 / §4.3 Écran 3). Le backend était déjà complet (`AttributeRegistryViewSet` CRUD + `POST /reorder/`, `code` immuable et `label.fr` requis validés serveur, CASCADE déjà actif sur `ProductAttributeValue`). Décisions notables :
- **`value_count` exposé sur le serializer (vs endpoint dédié).** `AttributeRegistryViewSet.queryset` est annoté `Count("values")` ; `AttributeRegistrySerializer.value_count` est un `SerializerMethodField` lecture seule avec repli `obj.values.count()` (réponses POST/PUT non annotées, objet unique → pas de N+1). Sert à afficher le nombre de valeurs supprimées en cascade dans la modale de suppression. Pas de changement de modèle → **pas de nouvelle migration**.
- **`reorder` réutilisé tel quel, scopé côté front.** L'endpoint `POST /api/attributes/reorder/` réaffecte `display_order = position` pour les `ids` reçus. Le frontend n'envoie que les ids **d'une seule catégorie** (drag activé uniquement quand une catégorie est isolée par les chips). L'ordre relatif intra-catégorie est ce qui compte (la fiche produit et la sidebar groupent par catégorie). Pas d'unicité globale de `display_order` — assumé.
- **`is_filterable` ajouté à la modale (au-delà de la liste de champs du ticket).** Le champ existe déjà sur le modèle (filtre sidebar catalogue) mais n'était éditable que via l'admin Django. La modale expose un toggle « Filtrable » en plus de Obligatoire / Recherchable. Déviation assumée : extension utile, pas un nouveau besoin.
- **DnD = `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`** (API stable `DndContext`/`SortableContext`/`useSortable`/`arrayMove`, pas le paquet expérimental `@dnd-kit/react`). Reorder optimiste via `mutate(KEY, optimistic, {revalidate:false})` puis revalidation après succès ; rollback (`mutate(KEY)`) + message FR sur erreur.
- **Navigation = barre d'onglets de liens partagée (`SettingsNav`).** `/settings` n'utilise plus les onglets Radix in-page : les sections Marché / Transport / Odoo sont pilotées par le query-param `?tab=` (composant `SettingsContent` enveloppé dans `<Suspense>` — exigence Next 16 pour `useSearchParams`), et « Attributs dynamiques » est la route dédiée `/settings/attributes`. Les deux pages partagent `SettingsNav`. Accès **admin only** (comme `/settings`).
- **Code auto-généré** depuis le label FR (`slugifyCode` : strip accents → snake_case, préfixe `attr_` si début non alphabétique) côté création, **input grisé/disabled en édition** (immuable, doublé par la validation serveur).

## 2026-06-18 · [P] Pricing — modèles simulations : gap-only, pas de SQLAlchemy
Ticket `[PRICING] Modèle de données simulations + simulation_lines + recalculations + market_parameters` (sous-tâches 1–4). Le socle Django ORM était déjà livré (`apps/simulations`, `apps/market`). Décision : **ne livrer que le manquant**, documenter les écarts au ticket, **pas de re-création de schéma**.
- **Pas de SQLAlchemy** : le ticket mentionnait des modèles SQLAlchemy (héritage FastAPI). Stack validée = **Django ORM uniquement** (cf. décision stack 2026-06-04). Aucune couche SQLAlchemy n'est introduite.
- **4 migrations séparées** : non requis — `simulations`/`simulation_lines`/`simulation_recalculations` dans `simulations/0001`, `market_parameters` dans `market/0001`. Les ajouts passent par `simulations/0003` et `market/0004`.
- **`MarketParameter`** : schéma actuel conservé (`copper_price`, `copper_currency`, `fx_from_currency`/`fx_to_currency`) vs ticket (`copper_price_eur_per_kg`, `fx_pair`). Front `/settings` et `lib/api.ts` déjà câblés. Champ `source` ajouté (LME/BCE/manual).
- **`RecalculationTrigger`** : valeurs granulaires actuelles conservées (`manual_current_params`, `manual_refresh_odoo`, `manual_full_refresh`, `initial`, `line_recalculate`) vs ticket (`manual_recalculate`, `refresh_data`, `finalize`) — mieux alignées sur les modes de recalc UI.
- **`SimulationLine`** : `status` + `calculation_breakdown.error` = équivalent fonctionnel aux `warnings[]`/`errors[]` du ticket ; pas de colonnes arrays. Colonnes figées `effective_margin_rate` / `effective_mix_pct` ajoutées (avant seulement dans le JSON breakdown).
- **Protection finalized** : trigger PostgreSQL (`simulations_guard_finalized`, `simulation_lines_guard_finalized_parent`) **+** gardes DRF existantes en doublon. Seule transition autorisée sur une simulation finalized : `status → archived` (status + `updated_at` uniquement). Suppression interdite si `finalized` ou `archived`.
- **`odoo_snapshot_at`** ajouté sur `Simulation` (en plus de la trace `SimulationRecalculation`) — peuplé au recalc global par `runner.py`.

## 2026-06-18 · [P] Pricing — wizard création simulation + APIs CRUD (CDC §6.9.2 / §6.9.9)
Ticket `[PRICING] Wizard création simulation + sélection SKU + APIs CRUD`. Le socle CRUD simulations (`SimulationViewSet`), finalize/duplicate/archive et la protection finalized existaient déjà — **gap-only**.
- **Catalogue embarqué vs redirect CDC** : le CDC §6.9.2 prévoit une redirection vers `/catalog` en mode sélection. Le wizard embarque un `CatalogueSelectionPanel` allégé (recherche + pagination + checkbox) dans l'étape 2 — UX plus fluide, pas de navigation hors wizard.
- **`client_ids` vide toléré pour tarif** : le ticket exige `client_ids` non vide ; on conserve la tolérance pour le quick-add catalogue (`AddToSimulationDialog`) qui crée une simulation avant d'y rattacher des clients.
- **Routes lignes plates conservées** : pas de duplication `GET/PATCH /api/simulations/{id}/lines/{line_id}` — on enrichit `/api/simulation-lines/?simulation=` avec filtres `has_warning` / `has_error`.
- **Presets chaîne structurels** : preset « Standard import Chine » = modules PA (maritime + routier + douane) sans valeurs monétaires inventées — l'utilisateur saisit les coûts.
- **Pas de tests unitaires frontend** : DoD = `tsc` + `eslint` + `next build` ; tests pytest backend uniquement pour les règles d'intégrité 403/409.
- **`xlsx` via npm registry** (`xlsx@0.18.5`) — pas le tarball CDN SheetJS (corrompt `package.json` lors de `npm install`).

## 2026-06-18 · [P] Pricing — édition simulation brouillon + robustesse `pallet_count`
- **Édition via modale, pas re-wizard complet** : `PATCH /api/simulations/{id}/` existait côté DRF ; le front ajoute `updateSimulation` + `SimulationEditModal` sur `/simulator/[id]` (brouillon uniquement). Réutilise `TypeStep` + `ParamsStep` du wizard ; les SKU restent gérés sur la page détail (ajout/suppression de lignes), pas dans la modale.
- **Helpers partagés** : `simulationToEditDraft`, `buildSimulationPatch`, `validateTransportChains`, `step1Valid` dans `wizard-draft.ts` (création + édition).
- **`pallet_count` JSON `null`** : le wizard persistait `null` si le champ palettes était vide → `int(None)` dans `chain.py`. Coalescence `null` → `0` dans `_transport_pallet_count` ; erreur métier FR si `<= 0` (`TransportModule`). Validation front avant soumission wizard/édition.

## 2026-06-18 · [P] Frontend — dépendances npm uniquement dans `frontend/`
- **`npm install` à la racine du repo interdit** : un install accidentel (ex. tarball CDN `xlsx`) créait `package-lock.json` racine + Turbopack scannait tout le monorepo (lenteur extrême). Mitigation : `turbopack.root` dans `frontend/next.config.ts`, entrées `/package.json` + `/node_modules/` dans `.gitignore` racine.

## 2026-06-19 · [P] Pricing — vue principale simulation (drag-and-drop + tableau + recalcul + bulk-edit + export)
Ticket `[PRICING] Vue principale simulation` (CDC §6.9.3–5). Backend additif (aucun modèle modifié → aucune migration). Décisions :
- **Recalcul = champ `scope`** (`params_only` | `with_odoo_refresh` | `full_refresh`) sur `RecalculateSerializer` (vs ancien `{refresh_odoo, market_params}`). `recalculate_task(pk, scope, market_params, note)` mappe `scope → RecalculationTrigger` (`_SCOPE_TRIGGER`). `refresh_odoo=True` sans scope = back-compat → `with_odoo_refresh`. Polling via `/api/tasks/{id}/` (pas d'endpoint `/recalculate/status` dédié).
- **Refresh Odoo réel en masse** : nouveau service `apps/simulations/services/odoo_refresh.py` (`refresh_odoo_for_simulation`) — via la factory `get_odoo_adapter()`, batch `get_stock_quantities` + `get_pending_purchases` sur les `odoo_id` des produits des lignes ; met à jour `Product.stock_quantity/pamp_eur`. Les achats engagés (`OdooPurchaseLine.price_unit`) sont convertis en EUR via le FX figé `fx_eur_<devise>` du snapshot ; **ligne ignorée si aucun FX disponible** (jamais de taux inventé). Le runner passe ces `PendingPurchase` à `compute_predictive_pamp` (avant : stub `[]`).
- **Recalcul ligne unique** : `recalculate_single_line(line)` (runner, synchrone, **aucune** trace `SimulationRecalculation`) exposé via `POST /api/simulation-lines/{id}/recalculate/` (route plate, garde finalized/archived → 403).
- **Bulk-edit** : endpoints conservés à `/lines/bulk` (vs `/lines/bulk-edit` du ticket) + nouveau `/lines/bulk/preview` (`{count}`, sans mutation). Filtre étendu (`has_warning`/`has_error`) via helper `_filter_simulation_lines`. **Attributs dynamiques différés** (EAV coûteux). Lignes impactées passées en `status="dirty"` (badge « surchargé »).
- **Export Excel** : convention dispatch+poll+download (POST `/export` → 202 `task_id`, GET `/exports/{task_id}` → `FileResponse`) calquée sur le catalogue, **vs `GET /export`** du ticket. `build_simulation_xlsx` = 3 onglets (Synthèse / Résultats / Breakdown détaillé), openpyxl. Conversion `Decimal → float` **uniquement pour l'affichage Excel** (le calcul reste Decimal).
- **Serializer lignes** : champs read-only `product_range` / `product_stock` / `product_pamp_eur` ajoutés ; `SimulationLineViewSet` gagne `OrderingFilter` (tri colonne) — pagination DRF déjà active.
- **Frontend `/simulator/[id]` reconstruit en 3 zones** (sidebar paramètres collapsible / tableau / drawer historique). **La sidebar autosave (1s) supersède `SimulationEditModal`** (supprimé) : édition Marché + chaînes PA/PV (`ChainBuilder` DnD) + globaux, contexte (type/clients/`project_name`) via petite modale `TypeStep` dans le header. **Autosave 1s = déviation assumée vs la convention 2s** (`useAutosave` défaut), exigée par le CDC §6.9.3. Remplace/étend l'entrée 2026-06-18 « édition simulation brouillon ».
- **Drawer historique inclus** dans ce lot (consomme `GET /recalculations`), pas reporté à un ticket séparé.

## 2026-06-19 · [P] Feedback vue simulation + tableau partagé catalogue/simulation
Retours utilisateur après livraison de la vue principale simulation :
- **Désignation produit** : pour la plupart des SKU, `Product.name` = `sku_code` ; la désignation lisible est `description_marketing.fr`. Nouvelle propriété `Product.designation` (FR marketing → `name` → `sku_code`), exposée en API lignes via `product_designation` et dans les exports Excel. Le tableau simulation affiche « Désignation », pas le SKU dupliqué.
- **Historique recalculs enrichi** : chaque trace affiche les paramètres figés (cuivre, FX, mix, marges, chaîne, snapshot Odoo) en plus du tag de scope — pas seulement « Paramètres actuels ».
- **Bulk-edit hiérarchie** : filtres Univers/Famille/Gamme **indépendants** (comme la sidebar catalogue), sans cascade obligatoire ; les filtres se cumulent côté API.
- **Tableau UI unifié** : composant partagé `frontend/src/components/data-table/DataTable.tsx` — colonnes redimensionnables (`useColumnWidths` + clé `localStorage` par écran), tri cyclique asc/desc/défaut, pagination Google-style, styles catalogue (zebra, hover orange, en-tête sticky). **Catalogue** (`app/catalog/page.tsx`) et **simulation** (`SimulationTable`) déclarent chacun leurs colonnes via `DataTableColumnDef[]` ; toute évolution visuelle du shell se fait en un seul endroit. Clés largeurs : `syskern:catalog-col-widths:v1` / `syskern:simulation-col-widths:v1`. Les anciens fichiers `catalog/_components/useColumnWidths.ts` et `CatalogPagination.tsx` ne sont que des ré-exports dépréciés.

## 2026-06-19 · [P] Pricing — moteur de calcul (CalculationModule + chaînes PA/PV) : gap-only
Ticket `[PRICING] Moteur de calcul modulaire` (parent + 7 sous-tâches). Le moteur était **déjà entièrement livré** (`apps/simulations/services/engine/` + `runner.py`), test §6.4 (`PA = 390.1636 €/km`) vert. Décision : **gap-only** — combler les tests d'acceptation manquants + documenter les écarts au ticket. **Pas de reconstruction.** Écarts assumés vs le libellé des tickets (FastAPI/from-scratch) :
- **Chemin** `backend/app/services/pricing_engine/` → `apps/simulations/services/engine/` (imposé par `AGENTS.md` §5.2). Pas de second dossier moteur.
- **Types = dataclasses frozen, pas Pydantic** : `PriceWithCurrency`/`SimulationContext`/`CalculationStep`/`ProductView` sont framework-free (testables sans DB ni Django ORM). « Tests validation Pydantic » du ticket → tests dataclass équivalents (upper-case devise, immutabilité, `to_decimal` via `str`).
- **Orchestrateur = `runner.py` (`run_simulation` / `recalculate_single_line`), pas une classe `PricingEngine.calculate()` async** : Odoo passe par la factory (`AGENTS.md` §5.3), jamais injecté dans l'engine. L'isolation d'erreur par ligne (try/except → `status="error"`, les autres lignes calculent) est dans `_recalculate_line`.
- **Douane sans mode `hs_code`** : `CustomsModule` = **`rate_pct`** (taux % sur le prix d'entrée, mode primaire MVP1) + legacy `coefficient` + `détaillé (coût global / quantité)`, conforme à la note MVP1 « pas de table customs_rates complexe ». Le critère « HS code introuvable → fallback/erreur » du ticket est **sans objet** (arbitré en session : design actuel conservé).
- **Transport sans lookup `transport_mode_id`** : coût **inline** dans le `chain_config` ; `transport_mode_code` = **code technique** (ex. `TRUCK_FULL`) persisté en metadata moteur — le libellé FR (« Camion complet ») est résolu côté front via `GET /api/transport-modes/` + fallback seeds (`lib/transport-modes.ts`). Critère « mode_id introuvable → erreur » sans objet.
- **`override_coefficient` = facteur direct** (`out = in * coef`, ex. `1.05`), pas un taux additif `(1 + coef)` — vaut pour transport et douane.
- **Warning cuivre** : `CopperVariationModule` distingue le passthrough non indexé (`reason="not_applicable"`) du cas **indexé sans poids** (`reason="indexed_without_weight"`). `runner.py` remonte ce reason en `status="warning"` (`_WARNING_REASONS`, `calculation_breakdown.warnings`) — première source réelle du statut `warning` (avant : seulement `ok`/`error`).
- **Lint « zéro float »** : pas de règle ruff native → test dédié `tests/test_no_float.py` (scan AST de `engine/*.py`). Aucun modèle modifié → **aucune migration**, aucune dépendance ajoutée.

## 2026-06-19 · [P] Pricing — durcissement moteur (zéro silencieux, Odoo découplé)
Suite au retour « les calculs sont toujours à 0 ». Diagnostic (logs Celery) : le moteur **calcule correctement** ; le `0` venait d'**entrées manquantes affichées silencieusement** — `po_base_price` du fournisseur actif à `0`/`None` → chaîne PA partant de 0 → PA/PR/PV nuls mais `status="ok"`. Reconstruction **axée robustesse** (la logique de calcul §6.4 est conservée, pas réécrite from scratch). Décisions :
- **Jamais de 0 silencieux** : `runner._validate_line_inputs` — fournisseur actif/`po_base_price` absent → `status="error"` (FR) ; `po_base_price == 0` → `status="warning"` (FR), on calcule quand même mais on signale. Le statut ne ment plus (`ok` seulement si ni erreur ni warning).
- **Diagnostics first-class** : `CalculationStep.warnings: list[str]` ; `ChainResult.warnings` agrège ; `calculation_breakdown` standardisé `{"errors": [...], "warnings": [...], ...}` (clé `error` string legacy conservée). Le warning cuivre « indexé sans poids » devient un message FR porté par le step (remplace le mapping `runner._WARNING_REASONS`).
- **Odoo découplé du calcul** : un échec du refresh (`with_odoo_refresh`/`full_refresh`) **n'annule plus** le recalcul — `recalculate_task` log + recalcule sur les params courants (mode dégradé, sans pending), la tâche **réussit**, l'erreur est remontée via `data["odoo_refresh_error"]` + la `note` de la trace. Avant : `_TaskError` faisait échouer tout le recalcul (un `404` Odoo bloquait le pricing).
- **Messages moteur tous en FR** (marge invalide, FX manquant) — destinés à l'utilisateur (AGENTS.md §5 r.9).
- **Front** : `SimulationTable` affiche le 1er diagnostic en texte lisible (ambre warning / rouge erreur) via `lineDiagnostics()` (au lieu d'un simple tooltip) ; `RecalculateModal` affiche un message non bloquant quand Odoo a dégradé ; recalcul ligne unique rafraîchit aussi les agrégats entête.
- **Aucune migration** (diagnostics dans `calculation_breakdown` JSON, pas de champ modèle) ; aucune dépendance ajoutée. **Remplissage des `po_base_price` manquants = sujet données/PIM**, hors moteur (le moteur se contente de le signaler).

## 2026-06-19 · [P] Pricing — transport en warning (pas erreur bloquante) + filtres `status_in`
Retour terrain : recalc global → **250/250 lignes en erreur** car transport activé mais **`pallet_qty` absent**
sur tous les produits (`TransportModule` levait `ValueError`). Décisions :
- **`TransportModule` ne lève plus** sur `pallet_count <= 0` ni `pallet_qty` manquant → passthrough +
  warning FR (`transport_invalid_pallet_count`, `missing_pallet_qty`). Le recalc continue ; ligne
  `status="warning"` si warnings agrégés. Aligné sur le contrat « zéro silencieux » (§6.6) sans
  bloquer toute la simulation pour une donnée logistique manquante côté PIM.
- **Garde front inchangée** : `validateTransportChains` (wizard + sidebar autosave) exige toujours
  `pallet_count > 0` avant PATCH — on distingue saisie chaîne (stricte) vs exécution moteur (dégradée).
- **Filtre lignes `status_in`** : `GET /api/simulation-lines/?status_in=ok,warning,error` (CSV).
  `has_warning`/`has_error` conservés (bulk-edit + rétro-compat). Front : 3 cases cochées par défaut.

## 2026-06-19 · [P] Frontend simulation — mix explicite, breakdown calcul, navigation produit
Itérations UX post-livraison vue simulation :
- **`StockPurchaseMixSlider`** : composant partagé (`app/simulator/_components/`). Curseur = **part stock
  (PAMP)** dans le PR ; gauche = 100 % achat (PA), droite = 100 % stock. Barre bicolore + texte
  `X % achat · Y % stock`. Remplace les libellés ambigus « 0 % (PA) / 100 % (PAMP) ».
- **Wizard « Détail du calcul »** : menu kebab → `CalculationBreakdownDrawer` (3 étapes : Synthèse,
  Chaîne PA, Chaîne PV). Read-only sur `calculation_breakdown` ; helpers `parseLineBreakdown` /
  `moduleLabel` / `MODULE_LABELS` dans `sim-format.ts`. Accessible en lecture seule.
- **`LineDiagnosticsDrawer`** : clic colonne Statut (complète le texte inline des diagnostics).
- **Navigation produit** : liens SKU/Désignation + `productEditHref` (onglet `logistics`/`commercial`
  selon message) ; fil d'Ariane via `BreadcrumbContext` + `useBreadcrumbOverride`.
- **Layout** : sidebar simulation redimensionnable (`useResizableWidth`), sidebar app repliable
  (`usePersistedBoolean` + toggle `AppShell`).

## 2026-06-19 · [P] Pricing — douane %, cuivre RMB, breakdown lisible, libellés transport
Itérations moteur + UX « Détail du calcul » :
- **Douane mode primaire = `rate_pct`** : `CustomsModule` applique un taux % sur le prix d'entrée
  (ex. `5` → +5 %). Modes legacy conservés : `coefficient` + coût global / `total_quantity`
  (passthrough `zero_customs_rate` / `missing_total_quantity` avec explication FR). Front
  `ChainBuilder` : champ « Taux (%) » ; `buildCustoms()` n'écrit pas de bloc douane si désactivé.
- **Cuivre toujours en RMB** : `CopperVariationModule` lit `copper_base/current_price_rmb` ;
  variation calculée en RMB puis convertie vers la devise PO via FX si besoin. Metadata breakdown
  inclut `copper_price_currency`, `variation_rmb`, `po_currency`, `fx_rmb_to_input`. Warning si
  paramètres cuivre absents du snapshot.
- **`market_params` au recalc (tout scope)** : `recalculate_task` persiste `market_params` fournis
  par le client **avant** `run_simulation`, quel que soit `scope` (pas réservé à `full_refresh`).
  `RecalculateModal` + sidebar transmettent le snapshot courant ; fermeture `MarketParamsModal`
  → sauvegarde immédiate (`saveMarketParamsNow`) en plus de l'autosave 1s.
- **`market_params_snapshot` dans `calculation_breakdown`** : sous-ensemble figé (cuivre RMB, FX clés
  utilisées) écrit par `runner._market_params_snapshot` — affiché étape Synthèse du drawer.
- **Breakdown sans clés brutes** : `formatBreakdownStepDetails()` (sim-format.ts) produit des
  phrases FR par module (cuivre, FX, transport, douane %, passthrough `same_currency`, etc.) ;
  codes transport (`TRUCK_FULL`) → libellés FR via `lib/transport-modes.ts` (`localizeLabel`,
  `transportModeLabel`, fallback seeds). `CalculationBreakdownDrawer` charge les modes actifs (SWR).

## 2026-06-19 · [P] Pricing — incoterms dans les simulations (CDC §6.7–6.8, §12.2)
Le CDC distingue incoterm **achat** (PO fournisseur, par SKU) et incoterm **vente** (offre). Le PR
(§6.7) ne dépend pas de l'incoterm — formule mix(PA, PAMP) inchangée.
- **`sale_incoterm` + `sale_incoterm_location` sur `Simulation`** (migration `simulations/0004`) :
  hypothèse commerciale figée au recalc, exposée CRUD/autosave, reprise par défaut à la création
  d'offre (`OfferWriteSerializer`). Écart au schéma CDC §3.2 (incoterm sur offre uniquement) justifié
  par §6.8.3 (rappel + validation dans l'UI simulation).
- **Pas de formule `f(incoterm)` dans l'engine** : service hors engine `incoterm_rules.py` — skeletons
  PA/PV structurels + warnings cohérence §6.8.3/§12.2. Runner agrège dans `calculation_breakdown`
  (`incoterm_context` + `warnings`), statut ligne `warning` si écart (non bloquant).
- **Semi-auto front** : prefill structurel avec **confirmation** si chaîne déjà remplie ; montants
  transport/douane toujours saisis manuellement. Helpers partagés `lib/incoterms.ts` + composant
  `SaleIncotermSection`. `SupplierManager` et sidebar chargent les codes via `GET /api/incoterms`.

## 2026-06-22 · [P] Pricing — cycle de vie simulation (finalize/duplicate/archive/compare/historique)
Ticket `[PRICING] Cycle de vie simulation` (parent + 5 sous-tâches, CDC §6.9.6–8, §6.9.11–12). Socle déjà partiellement livré (actions `finalize`/`duplicate`/`archive`/`compare`/`recalculations`, gardes 403 + triggers DB) → **gap-only**. Décisions notables :
- **Historisation par ligne (option A)** : nouveau champ `SimulationRecalculation.line_snapshots` (JSON, migration `simulations/0005`) figé à chaque recalcul global (`runner._build_line_snapshots`) **et** au finalize. Permet le « Voir détail » (breakdown par ligne lecture seule) et le « Comparer avec actuel » (par SKU) du CDC §6.9.12, impossibles avec les seuls agrégats. Coût stockage assumé (~N lignes × M recalculs).
- **Trigger `finalize` ajouté** à `RecalculationTrigger` (extension de la décision 2026-06-18 qui ne l'avait pas retenu) : le finalize fige une trace dédiée `trigger_type="finalize"` **sans recalculer** (`runner.snapshot_finalize_trace`), créée pendant que la sim est encore `draft` (le guard PostgreSQL ne couvre que `simulations`/`simulation_lines`, pas `simulation_recalculations`).
- **Finalize pré-vol** : `last_calculated_at` non null + aucune ligne `error` (400 + liste des SKU) **+** garde `is_dirty` conservée (défense en profondeur, non exigée par le CDC mais évite de figer des résultats périmés). Modale front à saisie du libellé (anti-erreur).
- **Duplicate** : copie désormais aussi `effective_margin_rate`/`effective_mix_pct` (manquants avant) ; libellé FR `"<label> (copie)"`, body `{label?}`. Pas d'offres ni d'historique recalc copiés.
- **Agrégat `avg_margin`** ajouté à `_aggregate` (manquait alors que CDC §6.9.12 le liste dans chaque entrée d'historique).
- **Liste inclut les archivées par défaut** : `GET /api/simulations/` retourne draft, finalized et archived. Pour exclure les archivées : `?status=draft,finalized` ou `getSimulations({ includeArchived: false })` côté front (accueil). Filtre statut côté page liste simulations.
- **Compare étendu** : `CompareSerializer` accepte `simulation_ids` **et** `recalculation_ids` (2–4 colonnes total) ; réponse `{columns[], products[]}` (matrice SKU × colonne avec PV/PR/PA + marge/mix + agrégats par colonne). Deltas/couleurs calculés côté front. Remplace l'ancien contrat `{simulations[], products[]}` (PV/PR/PV seuls).
- **Pagination historique = LimitOffset projet** (`?limit=&offset=`), **pas** `page/page_size` du CDC : aligné sur `DefaultLimitOffsetPagination` (cf. décision « le code fait foi »). Serializer liste léger (`SimulationRecalculationListSerializer`, sans `line_snapshots`) ; détail complet via action `recalculation_detail`.
- **Front** : `FinalizeModal` + `DuplicateModal` (sidebar), page `/simulator/compare` (voir `frontend.md` : synthèse graphique, diff paramètres, heatmap SKU, comparaisons enregistrées), `RecalcDetailModal` + drawer historique paginé avec actions « Voir détail » / « Comparer avec actuel ». Pas de tests front (DoD = tsc + eslint + build).

## 2026-06-22 · [P] Pricing — comparaisons enrichies + persistance
Extension post cycle de vie (CDC §6.9.8 / §6.9.12) :
- **Compare API enrichi** : chaque colonne expose `context` (marché, mix, marges, incoterm, dates, trigger, modules chaîne) + agrégats avec `warnings_count`/`errors_count` (sims vivantes). Front : 3 vues (synthèse Recharts, diff paramètres type git-diff, SKU heatmap/graphique/détail). Écarts monétaires calculés sur **valeurs brutes** API — `parseLocaleNum` pour l'affichage formaté FR uniquement.
- **Comparaisons enregistrées** : `SavedComparison` (`simulations/0006`) — CRUD `/api/saved-comparisons/` ; front modal Enregistrer + panneau Enregistrées + deep-link `?saved=`. `recalculation_ids` optionnel vide (comparaison simulations seules). Pas de lien user (app sans ownership par utilisateur pour l'instant).

## 2026-06-22 · [P] Base de données Syskern = PostgreSQL classique (aucun projet Supabase lié)
Clarification infra : Syskern tourne sur **PostgreSQL classique** — Postgres Docker en local, instance Postgres sur **VPS OVH** en prod. **Aucun projet Supabase n'est lié à Syskern** (rectifie la mention « Prod : Supabase self-host » d'AGENTS.md §3, objectif abandonné). Conséquence outillage : le serveur **MCP `user-supabase`** configuré dans l'environnement pointe vers un **autre projet** (plateforme d'investissement : tables `asset_prices`, `client_portfolios`, `darwinex_nav`, `performance_fees`, `index_nav_history`…) et **ne doit jamais** servir à inspecter, migrer ou requêter le schéma Syskern. **Vérification du schéma = code + migrations Django** (`apps/*/migrations/`), source de vérité (§2) ; pour l'état réel de la base, utiliser le terminal backend (`manage.py dbshell` / `showmigrations`), pas le MCP Supabase.

## 2026-06-23 · [P] PAMP prévisionnel / mix — déviations assumées au CDC §6.7/§6.8 et aux sous-tâches
Implémentation des sous-tâches `[PRICING] compute_predictive_pamp` et `compute_pr/resolve_mix_pct/resolve_margin_rate`. Le pseudo-code des tickets place un moteur **async** appelant Odoo directement (`backend/app/services/pricing_engine/…`) ; **le code fait foi** et reste aligné `/AGENTS.md` §5 (r.2 moteur framework-free sans ORM/I/O, r.4 appels externes = Celery). Déviations documentées :
- **Engine pur synchrone** : `compute_predictive_pamp` / `compute_pr` / `resolve_mix_pct` / `resolve_margin_rate` vivent dans `apps/simulations/services/engine/pamp.py` comme fonctions pures (pas d'`async`, pas d'Odoo). L'I/O Odoo + conversion multi-devise → EUR vit dans `services/odoo_refresh.py` (`refresh_odoo_for_simulation`, `_to_eur`), exécuté en tâche Celery.
- **Endpoints `GET /api/odoo/products/{odoo_id}/pending-purchases|pending-sales` (CDC §5.7) = superseded** par le service bulk (un batch par recalc), pas d'appel synchrone par produit. Aucun endpoint par produit exposé. `get_pending_sales` sans impact PAMP (ventes consomment le stock au PAMP courant, §6.7.1).
- **`compute_predictive_pamp(odoo_synced=…)` renvoie `None`** si produit jamais syncé (`odoo_id is None`) ou stock 0 sans achat engagé (cas particuliers §6.7.1) ; résultat `quantize()` 4 décimales (§6.5).
- **Mix forcé à 0 + warning non silencieux** : `resolve_mix_pct(pamp_available=False)` → `0` (override compris) ; `compute_pr(pamp_predictive_eur=None)` → PR = PA net (aussi `quantize` 4 dp) ; le runner persiste `effective_mix_pct = 0` et émet un warning FR (ligne `status="warning"`, contrat §6.6) si un mix > 0 était demandé.
- **`resolve_margin_rate` role-agnostique** : signature `(simulation_margin_rate, line_override)` (pas de param `role`). La marge Symea (6 %) passe par la config chaîne PA (`symea_margin`), pas par une surcharge ligne ; **pas de champ `symea_margin_override`** ajouté sur `SimulationLine` (hors périmètre / pas dans le modèle). Tests couvrent Symea et Syskern via le même résolveur.

## 2026-06-18 · [T] Qualité — pre-commit + Conventional Commits + Makefile setup
`make setup` installe deps Python+Node, hooks pre-commit (ruff, eslint, prettier, detect-secrets, transverses) et commitizen sur `commit-msg`. Validation `feat|fix|chore|...(scope): description`. Wrapper `scripts/pre-commit/run-frontend-tool.sh` strip le préfixe `frontend/` pour que eslint/prettier reçoivent des chemins relatifs au cwd `frontend/`. `.secrets.baseline` allow-list les placeholders connus (env.example, doctests). Décision : ne pas activer mypy en hook (trop lent), `make typecheck` à la place.

## 2026-06-18 · [P] Sécurité — rate-limit login 5 tentatives / 15 min par IP (CDC §9.2)
`apps/core/rate_limit.py` (helpers `check`/`register_failure`/`clear`, IP via X-Forwarded-For premier hop) + counter dans `django.core.cache` (Redis backend partagé worker/web/beat). 6e tentative → `429` + `Retry-After`. Login réussi reset le compteur. **Une fois bloqué, même le bon mot de passe → 429** (pas d'oracle leak). Paramètres `LOGIN_RATE_LIMIT_MAX_ATTEMPTS`/`LOGIN_RATE_LIMIT_WINDOW_SECONDS` env-overridables. Tests : `apps/core/tests/test_rate_limit.py` (9 cas, isolation par IP, fenêtre glissante, XFF).

## 2026-06-18 · [P] Cache Redis Django (`CACHES`)
`django.core.cache.backends.redis.RedisCache` ajouté au `settings.base`, `LOCATION = REDIS_URL`, `KEY_PREFIX="syskern"`. Backend partagé entre gunicorn / worker / beat (cohérence du rate-limiter et de toute primitive future).

## 2026-06-18 · [T] Spike volumétrie Odoo (CDC §5 sizing)
`backend/scripts/spike_odoo_volumetry.py` mesure pull complet : `product.template` × 3 limits (100/200/500), `stock.quant`, `res.partner`, `product.supplierinfo`. Rapport markdown `backend/docs/odoo-mapping.md`. Sur v16 staging (800 SKU) : `limit=500` optimal (0.42 s vs 0.98 s à 100), pull total ~2.5 s, p99 par page 261 ms. **Sizing VPS 4 vCPU / 8 Go reste valable** ; `ODOO_TIMEOUT_SECONDS=60` couvre largement (3× le p99).

## 2026-06-22 · [P] Migration — orchestrateur 4 étapes + reset + dérivations (CDC §8.4/§8.5/§8.9)
Implémentation de l'orchestrateur one-shot, du reset destructif et des dérivations. Playbook : `docs/agent/migration.md`. Décisions notables :
- **Commandes de gestion Django, pas `python -m`.** Le CDC §8.9 cite `python -m app.migration.run_migration` / `reset.py`. On implémente `manage.py run_migration` et `manage.py migration_reset` (commandes Django), cohérent avec tous les loaders existants (`load_*`) qui sont déjà des management commands et nécessitent `django.setup()` + accès DB. La logique réutilisable vit dans `orchestrator.py` (générique), `steps.py`, `derivations.py`, `reset.py` ; les commandes ne sont que des entrées CLI. **Écart de forme assumé** vs le littéral `python -m` du CDC.
- **Orchestrateur générique + steps injectés.** `MigrationOrchestrator` ne connaît ni Odoo ni Excel : il exécute une liste ordonnée de `MigrationStep` (callables `ctx -> StepReport`). `build_default_steps()` câble les 4 étapes (`steps.py`). Permet de stubber les steps en test (résume/échec/reprise testés sans DB ni Odoo).
- **Checkpoint de reprise = fichier disque, jamais en base.** `MIGRATION_STATE_FILE` (défaut `backend/.migration_state.json`, gitignoré). Raison : il doit survivre à `migration_reset` (qui truncate la DB) et persister entre deux `docker compose run`. Écrit en tmp+replace (atomique). Sur échec d'une étape : `status=failed` + `failed_index` sauvés, puis `MigrationStepError` (exit ≠ 0) ; la reprise relit le checkpoint et redémarre à l'étape échouée (les étapes < start ne sont pas rejouées).
- **Deux « reset » distincts (piège).** `run_migration --reset` efface le *checkpoint* (rejoue les 4 étapes). `migration_reset` truncate les *tables DB*. Documenté dans les deux runbooks + le playbook.
- **Reset = delete ORM enfant→parent, pas TRUNCATE CASCADE.** Purge `products`, `product_attribute_values`, `product_suppliers`, `clients`, `migration_unmatched` ; **préserve** `attribute_registry`, `incoterms`, `transport_modes` (seeds de référence). ORM delete respecte le `on_delete=PROTECT` de `simulation_lines→product` : si une simulation existe, `ProtectedError` (échec voulu — on ne reset pas une base avec historique pricing). Confirmation interactive `RESET` obligatoire (`--no-input` pour scripts).
- **Garde-fou `MIGRATION_LOCKED`** centralisé dans `apps/data_migration/locking.py` (lu depuis `os.environ`, comme `_loader_base.py`). Bloque tout run réel et tout reset ; dry-run toléré. Miroir `settings.MIGRATION["LOCKED"]`.
- **Dérivations CDC §8.5 idempotentes.** `factory_code`/`parent_reference` remplis seulement si vides (réutilise `sku_parser`) ; `is_copper_indexed` = fonction de `copper_weight>0` ; `base_unit` → `km` pour les câbles uniquement (jamais de downgrade vers `unit`, pour ne pas écraser un `m` délibéré — léger écart au « sinon unit » de §8.5, assumé). `pamp_eur`/`is_active` non dérivés (viennent du sync Odoo).
- **Validation step 4 → quarantaine idempotente.** Anomalies (`name` vide, copper-indexed sans poids, fournisseur actif sans po_base_price/po_currency/incoterm) loggées dans `MigrationUnmatched` avec `source_file="__validation__"`, purgées avant chaque re-validation (rejeu identique).
- **Step 2/3 pilotés par un manifest JSON** (`MIGRATION_MANIFEST`, cf. `migration/README.md`) mappant loader↔fichier↔phase (`enrich`/`create`). Step 3 (hors-Odoo `database_internal`) n'a pas de loader par défaut (format client-spécifique, écrit à l'arrivée du fichier réel) → no-op tant qu'aucune entrée `phase=create`. Sources dans `migration/sources/` (gitignoré sauf `.gitkeep`), résolu `/migration/sources` dans le conteneur.

## 2026-06-22 · [P] Migration — quarantaine (API + UI), matching, rapport final (CDC §8.6/§8.7/§8.8)
Complète la brique migration. Le **matcher 4 règles** (`loaders/matching.py`, `ProductMatcher`), la **table `migration_unmatched`** et l'**API quarantaine** (`views.py`) **préexistaient et étaient testés** (`test_matching.py`, 11 cas) — livré ici : le rapport final, l'UI quarantaine, et les compléments d'API. Décisions :
- **Matching inchangé (déjà conforme §8.6).** Cascade 4 règles + court-circuit ; ≥2 candidats → `DUPLICATE_MATCH` (quarantaine, jamais de choix arbitraire). Le `MatchResult` est un **dataclass riche** (`product_id`/`reason`/`rule_used`/`candidates`), pas l'enum littéral `EXACT_SKU|…|AMBIGUOUS` du ticket — il exprime les 5 issues + la traçabilité. Ajouté seulement un **test de perf** (`test_matching_performance.py` : 100 lignes / 2000 produits < 1s) car c'était un critère d'acceptation non couvert.
- **API quarantaine enrichie.** `MigrationUnmatchedFilter` (`filters.py`) ajoute `resolved` (bool sur `resolved_at__isnull`) en plus de `source_file`/`reason` ; action `facets` (totaux + comptes par raison + fichiers distincts) pour l'UI ; `resolve` accepte **POST et PATCH** (le ticket demandait PATCH, l'existant faisait POST — on supporte les deux). Pas d'endpoint de réinjection/DELETE (405) — par design (§8.7).
- **UI `/admin/migration-quarantine`** (admin-only, calque `/admin/users`) : table paginée (LimitOffsetPagination), filtres source/raison/statut, vue JSON brute, modale résoudre (note + email pré-rempli depuis `useAuth`). Aucun bouton « ré-injecter ». Lien sidebar + breadcrumb (admin-only) dans `AppShell`.
- **Rapport final `report.py` (§8.8).** `build_report_data()` agrège en live ; les compteurs **créés/maj + durée** viennent du **checkpoint** d'orchestration (seul endroit où ils sont enregistrés ; sinon onglet le signale). Workbook openpyxl 6 onglets (Synthèse/Fournisseurs/Attributs/Quarantaine/Dérivations/Simulation) + corps de mail FR. **PV moyen par gamme** = `SimulationLine` des simulations `finalized` groupées par `product__range` ; « anomalies » = lignes `status in (warning,error)`. Commande `migration_report` (`--email`/`--to`/`--output-dir`) ; `EmailMessage` joint le xlsx. Sortie défaut `migration/reports/` (gitignoré). Module placé dans `apps/data_migration/report.py` (pas `app/migration/report.py` du ticket — même écart de chemin assumé que l'orchestrateur).
- **Vérif live** : data-path bout-en-bout validé via le proxy `:3000` (login admin → list/facets/filtres → resolve persiste → email invalide 400 → DELETE 405). Backend : 217 tests verts (dont perf, rapport, API quarantaine). Frontend : eslint OK, `tsc` propre **sur les fichiers livrés** ; le reste de `tsc`/`next build` échoue sur des erreurs **préexistantes** (lib/api.ts désynchronisé des composants catalog/attributes/SupplierManager — état WIP hors périmètre, non touché).

## 2026-06-22 · [P] Offres — génération offre tarifaire Excel multi-clients (CDC §7.2)
Playbook : `docs/agent/offers.md`. Endpoint `POST /api/simulations/{id}/generate-tariff-offers/` (action sur `SimulationViewSet`) + tâche Celery + builder Excel + UI wizard. Décisions :
- **Async Celery, pas la réponse synchrone du ticket.** Le ticket décrit un endpoint renvoyant directement le tableau d'offres. **AGENTS.md §4 impose Celery** pour tout export ⇒ l'endpoint renvoie `202 + task_id`, le front poll `/api/tasks/{task_id}/`, le résultat porte `{count, currency, offers:[…]}`. Même précédent que l'export catalogue. La tâche (`offers/tasks.py:generate_tariff_offers_task`) crée N offres + N Excel (1 par client).
- **Champs : le code fait foi.** Le ticket cite `offer.excel_file_path` et `offer_lines.line_snapshot` — **ces champs n'existent pas**. On écrit l'URL dans `Offer.generated_file_url` (champ réel) et le snapshot vit déjà dans `SimulationLine.product_snapshot` (lié via `OfferLine.simulation_line`). Pas de nouvelle migration de modèle.
- **`incoterm` requis sur `Offer`** mais absent du wizard 5 étapes du ticket → param optionnel, défaut **EXW**. **MOQ** : aucun champ produit correspondant → colonne omise (pas d'invention). Colonnes réelles seulement (SKU, nom, hiérarchie, marque, PV, devise, incoterm, conditionnements, poids, HS, GTIN, client).
- **FX extrait dans le moteur (DRY, règle §2).** `apps/simulations/services/engine/context.py` expose désormais une fonction `fx_rate(from, to, market_params)` (pivot EUR, §6.3.2) ; `SimulationContext.get_fx_rate` délègue. L'offre convertit le PV EUR → devise de vente au moment de la génération (CDC §6.8.2/§7.2.5) via cette même fonction. `final_price` stocké en devise de l'offre (quantize 4dp ROUND_HALF_UP). `_eur_to` (méthode morte) retirée. Engine tests verts.
- **En-têtes Excel multilingues FR/EN/ES** via dictionnaire en code (`services/excel.py`, CDC §10.5.4) ; note de taux en pied de page si devise ≠ EUR (§7.2.5). Logo Syskern = **en-tête texte stylé** (l'asset charte n'est pas au repo — CDC §7.7). Catalogue de colonnes exposé via `GET /api/offers/tariff-columns/?lang=` (source unique, le front ne hardcode pas).
- **Stockage fichier = volume export local** `/tmp/syskern_exports/offers/{offer_id}.xlsx` (réutilise le volume monté du catalogue), téléchargé via `GET /api/offers/{id}/download/`. Supabase Storage = prod (non câblé en local MVP1).
- **Wizard** `/offers/new-tariff?simulation_id=` (5 étapes, dnd-kit pour l'ordre des colonnes, écran de chargement + polling, redirect `/offers?generated=N`). Garde : 400 si simulation non finalisée ou type ≠ tarif. Lint+tsc propres sur les fichiers livrés. **Worker Celery à redémarrer** après ajout de `offers/tasks.py` (autodiscovery au boot). Vérif live : POST→worker→2 offres USD→download xlsx (560.86 = 487.70×1.15), puis nettoyage.

## 2026-06-22 · [P] Offres — génération offre projet Gamma + OpenAI (CDC §7.3 / §7.6)
Devis projet Gamma 5 sections, argumentaires OpenAI, quantités. Playbook `offers.md`, intégration `docs/integrations/gamma.md`. Décisions :
- **Async Celery** (§4) : `POST /api/simulations/{id}/generate-project-offer/` → `202 + task_id` ; `generate_project_offer_task` crée l'offre+lignes puis appelle OpenAI+Gamma ; le front poll (génération Gamma 1-3 min). Retry : `POST /api/offers/{id}/regenerate/` → `regenerate_project_offer_task` (rejoue `run_generation`, idempotent).
- **httpx, pas le SDK openai.** Convention projet = httpx pour tout externe ; on étend `OpenAIClient.generate_json` (response_format json_object, `OPENAI_MODEL` configurable, déf. gpt-4o-mini). Pas de nouvelle dépendance.
- **Contrat Gamma vérifié (réécriture du stub).** Base `https://public-api.gamma.app`, header **`X-API-KEY`** (pas Bearer), `POST /v1.0/generations` (le ticket disait v0.2) → `generationId` ; poll `GET /v1.0/generations/{id}`. **Facturable** (Pro+, 1-3 crédits/carte). Retry 5xx (backoff), pas sur 4xx, timeout 60s. **Pas d'export HTML natif** (`exportAs`=pdf/pptx/png) → snapshot HTML = fetch best-effort de la page publique (cf. note du ticket) ; PDF dans `exportUrl`.
- **Champs modèle ajoutés** (migration `offers/0002`) : `generation_status` (pending/generating/ready/**error**) + `generation_error` + `ai_arguments` (cache JSON). Le ticket citait `gamma_doc_id` → on réutilise le champ réel `gamma_document_id` ; URL Gamma dans `generated_file_url`, PDF dans `project_info.gamma_export_url`.
- **Erreurs (CDC §7.6.3)** : OpenAI échoue → `generate_arguments` renvoie **None**, l'offre est générée quand même (sans copy + warning). Gamma échoue → offre `generation_status=error` + retry possible (l'offre + lignes persistent déjà). Argumentaires cachés par `instructions_hash` → pas de re-génération OpenAI au retry.
- **DeepL non appelé** : la sortie est rédigée directement dans la langue cible (OpenAI + `textOptions.language` Gamma) ; abonnement DeepL pas encore actif (différé, cf. demande client).
- **Clés en `.env`** (gitignoré) : `GAMMA_API_KEY`, `OPENAI_API_KEY` renseignées ; jamais dans le code ni commitées.
- **Vérif live (2026-06-22)** : OpenAI → 3 argumentaires FR (~1050 car.) ; Gamma `POST /v1.0/generations` (1 carte, noImages) → `completed`, gammaUrl + PDF, **3 crédits** déduits. Backend : 24 tests offers verts (OpenAI/Gamma mockés ; succès, échec OpenAI, échec Gamma+retry, payload 5 sections, quantités, 400). UI wizard `/offers/new-project` lint+tsc propres sur les fichiers livrés.
- **Vérif e2e flux complet (worker réel)** : après correctif env (cf. ci-dessous), `POST generate-project-offer` puis `regenerate` → worker → OpenAI + Gamma 5 sections → offre `ready`, **gammaUrl réel** `https://gamma.app/docs/ut6bk0qo5pmo8w6` (~60 s). Le chemin retry est donc validé en vrai.
- **Piège env (corrigé)** : `docker compose restart` ne recharge pas `env_file` → le worker n'avait pas `GAMMA_API_KEY` (échec « not configured »). Correctif : `docker compose up -d --force-recreate backend celery-worker`. Noté dans `offers.md`.
- **UI `/offers` (remplace le placeholder « Module à venir »)** : liste réelle (dashboard statuts + tarifs actifs + conversion projets, filtres type/statut, table) ; bouton « Nouvelle offre » → modale de sélection d'une simulation finalisée → route vers le wizard tarif/projet ; actions par ligne : télécharger Excel (tarif), ouvrir Gamma (projet `ready`), « Réessayer » (projet `error`) ; auto-refresh SWR tant qu'une génération tourne. `OfferListSerializer` enrichi (`generation_status`, `generated_file_url`, `client_ids`, …). Lint+tsc propres sur les fichiers livrés.

## 2026-06-23 · [P] Offres — bibliothèque de documents + purge (CDC §7.4 / §3.2)
Tables `offers`/`offer_lines` **déjà existantes** (modèles Django + migrations) → non recréées ; le ticket les décrit en SQLAlchemy/Alembic (obsolète, cf. stack Django). `DocumentLibrary` existait (CDC §3.2) — **étendu**, pas refait. Playbook : `docs/agent/offers.md`. Décisions :
- **Stack = Django/DRF/Celery, pas SQLAlchemy/Alembic/apscheduler.** Le ticket vise l'ancienne stack FastAPI. Migrations Django (`documents/0002` champs, `0003` schedule Beat). Cron purge = **Celery Beat** (`documents.purge_deleted_documents`, 04:00 UTC), pas apscheduler.
- **Modèle étendu** : ajout `product` (FK SET_NULL), `file_name`, `version`, `uploaded_by`, `deleted_at`. Le ticket cite `storage_path` → on garde le champ réel `file_url` (chemin storage). Champs `offers` du ticket (`client_id`/`excel_file_path`/`total_amount_eur`) déjà tranchés dans les entrées offres précédentes — le code fait foi.
- **Storage = `default_storage`** (local `MEDIA_ROOT/documents/<uuid>/<nom>`). Supabase Storage + bucket privé/RLS = prod (non câblé en local MVP1) ; le bucket `offer-documents` se crée côté infra, pas dans le code app.
- **Endpoints sous `document-library`** (existant + CDC §7.8), pas `library` comme le ticket — page front `/library` mais appelle `/api/document-library/`. Upload valide ≤20 Mo + PDF/JPG/PNG/DOCX/XLSX ; versionne par (product, language, file_name) ; `download` stream (`?inline=1` pour aperçu) ; `DELETE` = soft-delete + purge 30 j ; `versions` = chaîne.
- **FK** : `document_library.product → SET_NULL` (testé) ; `offer_lines.offer → CASCADE` et `offers.simulation → PROTECT` (= RESTRICT, 409 dans le viewset destroy) déjà en place.
- **Tests (11)** : upload OK/rejet (taille, type, manquant), versioning, versions, download stream, soft-delete + recovery, purge 31 j → purgé / 29 j → conservé, product delete → SET_NULL. UI `/library` lint+tsc propres ; `next build` vert. Vérif live : upload→list→download inline→soft-delete via `:8000`, puis nettoyage.

## 2026-06-23 · [P] Offres — cycle de vie, versioning, expiration cron (CDC §7.5 / §7.6)
Beaucoup préexistait (`set_status`, `duplicate`/`versions`, dashboard, expiring-soon, page `/offers`) → complété, pas refait. Décisions :
- **Validation des transitions** ajoutée à `set_status` (`ALLOWED_TRANSITIONS` dans views.py) : `draft→sent`, `sent→won/lost` ; tout le reste rejeté (`draft→won` → 400, doit passer par `sent`). `won/lost` projet uniquement (déjà en place). `expired` n'est posé que par le cron.
- **`new-version`** = nouvelle action (url_path), logique factorisée `_create_next_version` (réutilisée par `duplicate`, gardé en alias rétro-compat). Projet only. **`extend-expiration`** : new_date > today+7, réactive `expired`→`sent`.
- **Cron = Celery Beat, pas apscheduler** (le ticket dit apscheduler — obsolète, cf. stack). Tâche `offers.daily_expiration_check` (08:00 UTC, migration `offers/0003`) : auto-expire les `sent` dépassés (won/lost intacts), email J-7 via `send_mail`. Killswitch `EXPIRATION_CRON_ENABLED`. Note : le ticket dit 08:00, le CDC §7.5.4 disait 06:00 → on suit le ticket (08:00).
- **Email** : settings `EMAIL_*` ajoutés (backend console en dev, SMTP en prod) + `OFFERS` dict (`EXPIRATION_CRON_ENABLED`, `FRONTEND_BASE_URL`). Tests via fixture `mailoutbox`.
- **Destinataires de l'alerte = en base, éditables depuis l'UI (pas en env)** — correction demandée par le dev. Modèle singleton `OfferAlertConfig.recipients` (ArrayField d'emails, migration `offers/0004`, accès via `OfferAlertConfig.load()`), endpoint admin `GET/PUT /api/offers/alert-settings` (validation email → 400), UI onglet « Alertes offres » dans Paramètres. Le cron lit `OfferAlertConfig.load().recipients`. `OFFER_ALERT_RECIPIENTS` retiré des settings/`.env.example`. 4 tests ajoutés (GET défaut vide, PUT persiste + singleton, email invalide 400, pas d'email sans destinataire) + vérif live `:8000`.
- **Champs : code fait foi** — pas de `total_amount_eur` sur `Offer` (le total est calculé depuis les lignes côté front/serializer) ; `expiration_date` du ticket = champ réel `valid_to` ; `gamma_doc_id` = `gamma_document_id`.
- **UI** : page détail `/offers/[id]` (statut/version, compte à rebours expiration coloré J-7, document, chaîne de versions, lignes lecture seule, actions cycle de vie + prolonger + nouvelle version) ; liste `/offers` (label → détail, stat « CA gagné » via `won_total`). Lint+tsc propres ; `next build` vert.
- **Tests (14)** : transitions (draft→sent OK, draft→won 400, sent→won projet, tariff→won 400), versioning V1→V2→V3 + chaîne, extend (OK, <7j 400, réactivation), cron (auto-expire sent, won intact, alerte J-5 envoyée, J-10 non, killswitch). Vérif live `:8000` (transitions + new-version + extend), puis nettoyage. Worker+beat redéployés (tâche + schedule enregistrés).

## 2026-06-18 · [P] PIM — régression attributs dynamiques (merge pricing/offres)
Régression post-merge : `getProducts`/`buildCatalogQuery` dans `lib/api.ts` avaient été simplifiés (plus de `attrs`, `q`, stock, ordering) → filtres catalogue EAV inopérants ; `SettingsNav` déconnecté de `/settings` (retour Radix in-page, onglet Attributs inaccessible) ; filtre API `is_filterable` absent du `filterset_fields` backend. Correctifs :
- **`lib/api.ts`** : restauration `ProductListParams extends CatalogFilters`, `buildCatalogQuery`, `getProducts` complet ; export `HierarchyLevel` ; `getFilterableAttributes` filtre côté client en secours.
- **`/settings`** : retour à `SettingsNav` + `?tab=` (marche/transport/odoo/alerts) + `<Suspense>` ; onglet Alertes conservé dans la nav partagée.
- **Backend** : `is_filterable` ajouté à `AttributeRegistryViewSet.filterset_fields` + test `?is_filterable=true`.
- **Tests** : 15 tests attributes verts (`uv run pytest apps/attributes/tests/test_api.py`).

## 2026-06-23 · [P] Palette UI = brand guidelines Unikkern (refonte visuelle frontend)
Modernisation UI Syskern alignée sur les brand guidelines Unikkern (PDF officiel). Décisions :
- **Palette** : navy `#162F56`, vert `#649E5F` (CTA primaire + identité syskern), orange `#F78F26` (accent pricing/warm), bleu `#09B0E6` (info), rose `#C92359` (destructif). Les anciennes couleurs code (`#0F2137`, `#E07200`) étaient hors charte → remplacées par tokens CSS (`brand-*`, `primary`, `warm`) dans `globals.css`.
- **Typo** : Nunito (guideline §5), via `next/font/google`. Remplace Inter/Plus Jakarta.
- **Design system** : shadcn/ui (style base-nova) + Tailwind 4 `@theme`. Composants dans `components/ui/` ; wrappers métier (`BrandLogo`, `PageHeader`, `EmptyState`, `FormField`, `StatusBadge`, `KpiCard`).
- **Logos** : `public/syskern-logo.png`, `public/unnikkern-logo.png` ; composant `BrandLogo`. Login dual-brand (syskern + mention Unikkern).
- **Périmètre** : refonte visuelle uniquement — pas de changement logique métier MVP1. Dark mode hors scope (tokens préparés).

## 2026-06-24 · [P] Refonte UI phase 1 — Plus Jakarta Sans, Phosphor, dashboard d'accueil
Suite audit UI et modernisation démo :
- **Typo** : **Plus Jakarta Sans** remplace Nunito pour un rendu SaaS B2B plus contemporain. Écart assumé aux brand guidelines Unikkern (§5 Nunito) — palette couleurs inchangée.
- **Icônes** : `@phosphor-icons/react` + wrapper `AppIcon` (duotone nav/dashboard). Lucide conservé pour primitives shadcn internes.
- **Accueil** : `/` = tableau de bord simplifié (KPIs Catalogue/Simulations/Offres/Bibliothèque, raccourcis, activité récente) au lieu de `redirect("/catalog")`. Post-login → `/`.
- **Composants** : primitives shadcn ajoutées (`slider`, `sheet`, `popover`, `accordion`, `command`, `radio-group`) ; wrappers `FilterSection`, `FilterCheckboxGroup`, `MixSlider`.
- **Ombres** : tokens `--shadow-soft`, `--shadow-card`, `--shadow-elevated` dans `globals.css`.
- Dark mode et vue carte mobile catalogue : **hors scope** explicite.

## 2026-06-24 · [P] Corrections UI post-redesign — fil d'Ariane, modales, compare, logo sidebar
Retours utilisateur après refonte complète :
- **Compare** : retrait option « Métriques détaillées en mode heatmap » (doublon onglet Détail) ; légende « Écart PV » aussi en vue Détail.
- **Fil d'Ariane** : premier crumb → Tableau de bord `/` ; auto-crumb sans UUID/id brut ; overrides simulation/offre/produit avec titres métier.
- **Logo sidebar** : pastille fond blanc derrière logo syskern (lisibilité sur dégradé navy — pas de filtre CSS sur l'asset).
- **Modales denses** : recalcul détail `max-w-6xl`, breakdown/bulk `max-w-4xl`, `AppModal` taille `2xl` ; règles playbook `frontend.md`.
- **Libellés UI** : `recalcTriggerLabel` — plus de `trigger_type` brut en interface.
- **Docs** : `product.md` + `design.md` déplacés dans `docs/agent/` (racine réservée à `AGENTS.md`).

## 2026-06-24 · [P] Refonte UI phase 0b/2 — catalogue filtres, listes, composants interactifs
Suite modernisation UI (plan refonte) :
- **Filtres catalogue** : sidebar refondue (`FilterSection`, cascade hiérarchie lazy, sliders PAMP/stock dynamiques). Endpoint `GET /api/products/filter-bounds` pour bornes min/max — **écart** à la règle « UI seule » du plan initial, justifié par besoin UX sliders (tracé ici).
- **Hiérarchie API** : `hierarchy/distinct` accepte parents CSV (`universe=U1,U2`) — un appel par niveau au lieu de N requêtes.
- **Phase 0b** : `MixSlider` branché (alias `StockPurchaseMixSlider`), composants `SearchInput`, `FilterSelect`, `RangeFilterSlider`. **Fait** : `Field.tsx` (Switch/Select/Input shadcn), filtres statut `SimulationTable` (Checkbox), `library/page.tsx` (FilterSelect, PageHeader, EmptyState), `HierarchyFilterPanel` (FilterSelect).
- **Phase 2** : `catalog/page.tsx` et `offers/page.tsx` migrés vers tokens + shadcn (`Checkbox`, `Button`, `EmptyState`, `StatusBadge`, `FilterSelect`, `Dialog`). Offres : table HTML conservée (migration `DataTable` = prochain lot).
- **Hors scope** : phase 3 (simulation détail, compare, fiche produit), phase 4 (virtualisation).

## 2026-06-24 · [P] Refonte UI phase 0-1 — tokens, shell, login, dashboard
Fondations design system + premiers écrans refondus (plan refonte UI) :
- **Tokens sémantiques** (`globals.css`) : `surface-elevated`, `surface-inset`, `data-positive`, `data-negative`, `data-dirty` ; `brand-navy-dark` pour dégradés sidebar/login (remplace `#0f2444` hardcodé).
- **Typo données** : **JetBrains Mono** (`--font-mono`, `layout.tsx`) pour SKU, montants, codes attributs.
- **Composants** : `AppModal` (wrapper Dialog tailles sm→xl), `PageHeader` variants CVA (`default`, `dense`, `hero`).
- **AppShell** : logo intégré sur sidebar navy (suppression bande `bg-white`), nav active pill + rail `primary`, toggle `Sidebar`/`SidebarSimple` Phosphor, dégradé `from-brand-navy to-brand-navy-dark`.
- **Login** : split desktop (panneau navy + tagline « Pricing câble, une ligne. » + formulaire Card), stack mobile ; dual-brand conservé.
- **Dashboard** : KPI `motion-safe` hover + `tabular-nums`, activité timeline + `StatusBadge`, quick actions hover `border-primary/30`.

## 2026-06-24 · [P] Refonte UI phases 2-6 — plateforme complète (redesign exhaustif)
Migration visuelle complète des 18 routes frontend (plan redesign UI) :
- **Phase 2 PIM** : catalogue liste/fiche/wizard → tokens shadcn, `StatusBadge` univers, tabs shadcn fiche SKU, graphiques `--chart-*`.
- **Phase 3 simulateur** : détail simulation (écran héros), wizard, compare → `Dialog`/`Sheet`, `density="compact"` DataTable, `font-data` prix, tokens `data-dirty`, Phosphor.
- **Phase 4 offres/bibliothèque** : listes `DataTable`, modals → Dialog/Sheet.
- **Phase 5 admin** : `settings/page.tsx` découpé composants + `AppModal`/`FormField`, admin users/quarantaine → `DataTable`.
- **Phase 6** : composants partagés tokenisés (`BreadcrumbContext`, `AttributeRenderer`, `SupplierManager`), `docs/agent/product.md` + `docs/agent/design.md` (pas à la racine — seul `AGENTS.md` y reste), `DataTable` sélection + densité compacte, `universeBadgeVariant`.
- **Hors scope inchangé** : dark mode, virtualisation catalogue.

## 2026-06-29 · [P] Catalogue — filtre statut produit + login épuré + diagnostics pricing multi-erreurs

- **Catalogue** : filtres sidebar **Actif / Non actif** (`active_in` / `active_out` → `?is_active=`,
  exclusifs, défaut = tous). Chips, favoris `localStorage`, export et `filter-bounds` alignés ;
  `CatalogFilterBoundsView` part de `Product.objects.all()` (plus de masquage implicite des inactifs).
- **Login** (`/login`) : page minimale fond blanc — logos Syskern + Unikkern, carte connexion
  uniquement (suppression panneau marketing latéral).
- **Pricing — messages FR** : `engine/errors.py` + `lib/humanize-errors.ts` — plus de texte technique
  (`Missing FX rate fx_eur_usd…`) côté utilisateur ; `humanizeApiError` pour toasts/modales simulateur.
- **Pricing — pré-vol FX** : `engine/validation.py` accumule **toutes** les erreurs de taux manquants
  avant d'exécuter la chaîne ; `SimulationTable` affiche la liste complète dans la colonne Statut.
- Tests : `test_engine_errors.py`, `test_engine_validation.py`. Aucune migration.

## 2026-06-29 · [P] Comparaisons — objets de première classe + wizard
Extension UX post `SavedComparison` (CDC §6.9.8) :
- **Module `/comparator`** : liste paginée, wizard création (nom → simulations + aperçu SKU communs → aperçu live), fiche `/comparator/{id}` avec modifier/supprimer. Les comparaisons sont des objets persistés réutilisables (comme les simulations), pas seulement une URL éphémère.
- **API** : `GET /api/saved-comparisons/` paginé (`DefaultLimitOffsetPagination`, `?q=` sur label/note) ; PATCH étendu (`simulation_ids`, `recalculation_ids`).
- **`/simulator/compare`** conservé pour comparaison ad-hoc rapide ; `?saved=` redirige vers `/comparator/{id}`. Entrées principales : nav Comparaisons, multi-select simulations → `/comparator/new?sims=`, drawer recalc → `/comparator/new?sims=&recalc=`.

## 2026-06-29 · [P] Tableau de bord — endpoint agrégé + refonte UI

- **API** : `GET /api/dashboard/summary` (`apps/core/dashboard.py`, `DashboardSummaryView`) — remplace 6 appels SWR front (produits, univers, simulations×200, offers/dashboard, bibliothèque, recent offers). Payload : `catalog`, `simulations`, `offers` (métriques factorisées via `apps/offers/dashboard_metrics.py`), `comparisons`, `library`, `market` (cuivre LME + FX), `todo[]` (sims dirty / jamais calculées / erreurs lignes, offres expirantes, Gamma error), `recent[]` (top 8 sims/offres/comparaisons).
- **Frontend** : layout 2 colonnes, KPIs clarifiés (5 cartes dont Comparaisons), section « À traiter », timeline unifiée, carte marché, raccourcis création uniquement, onboarding état vide, personnalisation rôle (`viewer` sans CTAs), « Reprendre » via `last-visited.ts`. Admin : quarantaine + statut Odoo (SWR séparé).
- **Tests** : `apps/core/tests/test_dashboard.py`.

## 2026-06-29 · [P] Monitoring & logs MVP1 (CDC §9.6) + email SMTP noreply@syskern.com
Implémentation du ticket monitoring minimal. Runbook : `docs/runbooks/monitoring.md`. Décisions :
- **`/api/health` enrichi** : passe d'un `{"status":"ok"}` statique à un check BDD réel (`SELECT 1`) → `200 {"status":"ok","database":"ok"}` ou `503 {"status":"error",…,"detail":…}`. Reste une **plain Django view** (`apps/core/health.py`, `@never_cache`) hors stack DRF → public sans auth, < 100 ms (mesuré ~47 ms). Ne sonde **pas** les services externes (Odoo/Gamma/DeepL) — objectif = la plateforme elle-même (§9.6). Le champ `status` est conservé (superset) pour ne pas casser un check externe existant. Tests `apps/core/tests/test_health.py`.
- **Redaction secrets dans les logs** : filtre `apps.core.logging.SensitiveDataFilter` branché sur le handler `console` de `settings.LOGGING` (`filters: ["redact_secrets"]`). Masque en-têtes (`Authorization`/`Cookie`/…, valeur jusqu'à EOL), champs `password`/`token`/`api_key`/`secret`/… (valeurs sans espace) et formes brutes (`Bearer …`, `sk-…`). Sur-redaction tolérée (jamais d'under-redaction). Extensible via `SENSITIVE_KEYS`/`SENSITIVE_HEADERS`/`SENSITIVE_PATTERNS` (doc dans le module + runbook §4). Tests `apps/core/tests/test_logging_redaction.py`.
- **Slow queries Postgres** : `log_min_duration_statement=500` (ms) — local via `command:` du service postgres dans `docker-compose.yml` ; prod via `postgresql.conf`. Vérifié (`pg_sleep(0.6)` → `LOG: duration: 610 ms`).
- **logrotate** : `infra/logrotate/syskern-pricing` (nouveau dossier `infra/`), 3 stanzas (app gunicorn/Django + nginx + postgres), quotidien / rétention 30 j / compression J+1. App+pg en `copytruncate`, nginx en `USR1`. Validé `logrotate -d` (la stanza postgres exige l'utilisateur système `postgres`, présent sur le VPS).
- **Uptime monitoring = externe, non codé** : UptimeRobot/BetterStack sur `/api/health`, 5 min, alerte email `yassine@`/`karim@` si downtime > 5 min. Procédure dans le runbook §2 (pas d'API/MCP du service → config manuelle).
- **Email SMTP réel = Microsoft 365** : MX `syskern.com` = `*.mail.protection.outlook.com` → `smtp.office365.com:587` STARTTLS. Compte `noreply@syskern.com` (creds dans `backend/.env` gitignoré, placeholders dans `.env.example`). `DEFAULT_FROM_EMAIL` défaut base passé à `noreply@syskern.com` + ajout `SERVER_EMAIL`. **Auth SMTP M365 active** sur la boîte (vérifié : `get_connection().open()` OK + mail de test livré au compte lui-même). Sert aux alertes offres (`offers.daily_expiration_check`) et au rapport migration. ⚠️ Si M365 désactive l'« Authenticated SMTP » côté tenant → `SMTPAuthenticationError` (réglage admin, pas un bug app — noté runbook §6).
- **Suite de tests réparée (préexistant, corrigé dans ce lot à la demande)** : (1) `pytest` sans argument plantait à la **collection** sur `backend/scripts/test_adapters.py` (script smoke standalone avec `sys.exit(1)` à l'import, capté car match `test_*.py` sans `testpaths`) → ajout `testpaths = ["apps"]` dans `[tool.pytest.ini_options]`. (2) **23 erreurs** dans `apps/offers/tests` (`test_tariff_offers`, `test_project_offers`) + `apps/data_migration/tests/test_report` : fixtures créant une `Simulation(status="finalized")` **puis** insérant des `SimulationLine` → bloqué par le trigger `simulation_lines_guard_finalized_parent`. Correctif : fixtures créées en `draft`, lignes insérées, **puis** `Simulation.objects.filter(pk=…).update(status="finalized")` (transition draft→finalized autorisée par le guard). Résultat : **`pytest` (sans arg) = 608 passed, 0 erreur**.

## 2026-06-30 · [P] Sécurité — résolution des 10 alertes Dependabot (backend uv + frontend npm)
GitHub Dependabot signalait 10 vulnérabilités (4 high, 5 moderate, 1 low) sur `main`. Correctifs :
- **Backend (`uv.lock`)** : `pyjwt` 2.12.1 → **2.13.0** (5 alertes : GHSA-xgmm-8j9v-c9wx high + 4 autres) et `cryptography` 48.0.0 → **49.0.0** (GHSA-537c-gmf6-5ccf, fix ≥48.0.1). Floor `PyJWT[crypto]` relevé à `>=2.13.0` dans `pyproject.toml` (documente le pourquoi, évite un relock à la baisse). `uv lock --upgrade-package` exécuté **sur l'host** (uv absent de l'image runtime, qui fait `pip install .`). Rebuild image + **608 tests verts** avec crypto 49 (la crypto n'est tirée que par PyJWT[crypto] pour le JWT Supabase prod, stub MVP1 — non exercé par les tests, mais import vérifié).
- **Frontend (`package-lock.json`)** : `js-yaml` → **4.3.0** et `postcss` → **8.5.16** via bloc `overrides` (transitifs). `npm audit` = **0 vulnérabilité**. tsc + lint + `next build` OK.
- **xlsx — revirement assumé de la décision 2026-06-18** : cette décision imposait « xlsx via npm registry (0.18.5), **pas** le tarball CDN SheetJS (corrompt package.json) ». Mais les CVE xlsx (GHSA-5pgg-2g8v-p4x9 ReDoS, GHSA-4r6h-8v6p-xvw6 prototype pollution) **n'ont aucun correctif sur le registre npm** (`first_patched_version = null`) : SheetJS ne distribue les versions patchées que via son CDN. Donc xlsx `^0.18.5` (npm) → **`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`** dans `package.json` (URL dep, résolue + intègre dans le lock). Le risque « corruption package.json » de 2026-06-18 **ne s'est pas reproduit** (install OK, JSON valide, 0 vuln, build vert). ⚠️ Conséquence build : `npm ci` (Coolify) doit pouvoir **fetch le CDN SheetJS** au build (réseau requis). API xlsx inchangée pour l'usage (`XLSX.read` / `sheet_to_json` dans `ImportFilePanel.tsx`).
- **Local** : recréer `backend`/`celery-worker`/`celery-beat` (nouvelle image) et réinstaller les deps du conteneur `frontend` pour aligner le stack qui tourne sur les versions patchées.

## 2026-06-30 · [P] Offres — génération : état terminal garanti (fix « offres qui tournent toutes seules »)
Bug remonté : des offres semblent « tourner toutes seules » en génération Gamma. Diagnostic :
- **Tarifaires** : `generation_status` défaut `PENDING` **jamais** mis à jour (les tarifs produisent un Excel, pas de
  flux Gamma) → restaient `pending` à vie ; le front pollait la liste toutes les 5 s tant qu'une offre était
  `generating` **ou** `pending` → rafraîchissement infini.
- **Projet** : `run_generation` ne rattrapait que `GammaError` ; un échec OpenAI (`_resolve_arguments`/
  `build_gamma_payload` étaient **hors** du `try`), un timeout httpx non-Gamma, un `SoftTimeLimitExceeded` ou un
  worker tué laissaient l'offre bloquée en `generating`.
Correctifs :
- `run_generation` : tout le travail dans un `try` → **toute** exception donne un état terminal `error`
  (`_mark_generation_error`, message FR) ; `SoftTimeLimitExceeded` → `error` + re-raise ; snapshot HTML dans son
  propre `try` (n'inverse jamais un `ready`). Ne sort **jamais** en `generating`.
- `tasks.py` : tarif → `READY` après l'Excel ; `soft_time_limit`/`time_limit` sur les 3 tâches (330/360 s projet,
  120/180 s tarif) ; tâche **`offers.reap_stuck_generations`** (Beat 15 min, migration `offers/0005`, `IntervalSchedule`)
  passant en `error` les offres `generating` + `updated_at` trop vieux (worker tué).
- Front `offers/page.tsx` : poll **uniquement** sur `generating`.
- **Tests** (`test_project_offers.py`, `test_tariff_offers.py`) : exception générique/pré-Gamma → `error` ;
  `SoftTimeLimitExceeded` → `error` + re-raise ; snapshot KO → reste `ready` ; reap (vieux→`error`, récent intact) ;
  tarif → `READY`. ruff + mypy propres ; 30 tests offres verts.
- ⚠️ **Dette front préexistante (issue du merge pull, PAS ce lot)** : `npx tsc --noEmit` rouge (11 erreurs dans
  `simulator/wizard-draft.ts`, `MarketParamsModal.tsx`, `humanize-errors.ts` — `copper_base_price_rmb` renommé, flag
  regex es2018). Confirmé via git stash. À corriger séparément.

## 2026-06-30 · [P] Sync Odoo — import de TOUS les fournisseurs (fix « seul Symea au catalogue »)
Bug remonté : à la création/édition d'un fournisseur produit, seul « Symea » apparaît. Diagnostic (données réelles) :
- Base locale : 784 produits (782 `odoo_id`), fournisseurs **uniquement** Symea (2 variantes ×660), **quarantaine vide**.
- `/api/supplier-names` (`DistinctSupplierNamesView`) est **sans filtre** → correct, ne pas y toucher.
- Cause code : `odoo_sync/services/runner.py` importait **`op.suppliers[0]` seulement** (« multi-supplier arbitration
  pending ») alors que l'adapter (`v19._fetch_supplier_map`) récupère **tous** les `product.supplierinfo`. Le sync
  jetait donc les fournisseurs secondaires.
- Vérif Odoo impossible en live : staging v19 = **404** (instance expirée) ; les 2 MCP Odoo pointent sur **travelbook**
  (autre client) ; fichiers sources migration **absents** (`migration/sources/` = `.gitkeep`).
Correctif : `_upsert_supplier` (un seul) → **`_sync_suppliers`** — importe tous les fournisseurs distincts, garde
**exactement un actif** (le premier, lu par le moteur pricing), les autres inactifs ; activation atomique
(respecte l'index partiel `one_active_supplier_per_product`). Tests `test_supplier_sync.py` (4) : tous importés +
premier actif ; re-sync bascule le primaire, 1 seul actif ; dédup ; liste vide = no-op. ruff propre, 21 tests odoo_sync verts.
**⚠️ Volet données/ops (hors code, non reproductible localement)** : les fournisseurs AYP/Infoks/Mirsan ne viennent pas
d'Odoo mais de **fichiers PO Excel** chargés par les loaders `loader_po_*` (corrects) via `run_migration` + manifest.
Ces fichiers ne sont pas au repo → il faut les charger sur l'environnement réel pour que ces fournisseurs apparaissent.
Le « tout en quarantaine » (A3) n'est pas reproductible ici (quarantaine vide) — probablement un run de migration passé.

## 2026-06-30 · [P] Quarantaine — résolution automatique + sortie du JSON brut (A2/A3 UX)
Retour terrain : la résolution de quarantaine était « très non intuitive et non automatique » (affichage JSON brut +
message « créez le produit manuellement via Catalogue → Nouveau produit, puis marquez résolu »).
- **Backend** : nouveau `ResolutionAction` (`ignore`/`create`/`delete`) + champ `resolution_action` sur
  `MigrationUnmatched` (migration `data_migration/0002`). L'action `resolve` (`views.py`) **exécute** désormais
  l'arbitrage : `create` construit et **persiste réellement** un `Product` depuis la ligne (SKU requis, `name`/desc
  optionnels ; `factory_code`/`parent_reference` dérivés via `parse_sku` partagé), `delete`/`ignore` marquent résolu
  (soft — pas de hard-delete, audit §8.7 conservé). `resolved_by` devient optionnel → repli sur l'email de
  l'utilisateur connecté puis « système » (fini la saisie manuelle de l'email). `ResolveSerializer` : `action` +
  `product` (validé, requis si create). SKU dupliqué → 400 (ligne non résolue).
- **Front** (`admin/migration-quarantine/page.tsx`) : le `<pre>` JSON → **affichage structuré clé/valeur** de
  `raw_data` ; modale à **3 actions** (Ne rien faire / Créer le produit / Supprimer) qui déclenchent l'action backend
  en un clic. Pour « Créer » : champs SKU + désignation **pré-remplis** par heuristique (`guessProduct` scanne la ligne).
  Bandeau résolu affiche l'action choisie.
- **A1 (playbook)** : le tri était inerte (state `sort` non transmis) → ajout de `sortField` sur les colonnes +
  paramètre `?ordering=` dans la requête (le ViewSet expose déjà `ordering_fields`). Table alignée sur `admin/users`.
- **Tests** : 6 nouveaux (ignore/delete/create exécutés, create requiert product, SKU dupliqué 400, resolved_by
  par défaut) — 15 tests quarantaine verts, ruff + mypy propres. Front tsc + eslint clean (fichier livré).
  **Vérif live** (`:8000`) : POST resolve `create` → produit créé (factory/parent dérivés) + ligne résolue, puis nettoyage.
