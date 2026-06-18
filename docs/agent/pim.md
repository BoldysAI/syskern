# docs/agent/pim.md — Domaine PIM (catalogue produit + attributs)

> Playbook du domaine **PIM** (CDC §3.2, §4). Règles transverses → `/AGENTS.md`.
> Mécanique : backend → `backend.md` + `drf-resource.md` · frontend → `frontend.md`.
> Référence code : `apps/products/`, `apps/attributes/`, `frontend/src/app/catalog/`.

Le PIM = deux apps backend (`products`, `attributes`) + l'écran catalogue / fiche
produit côté frontend. Ce fichier documente ce qui est **spécifique au domaine** ;
pour ajouter une ressource DRF générique, suis `drf-resource.md`.

---

## Modèles (backend)

- **`products.Product`** — l'SKU. Champs first-class : hiérarchie 4 niveaux
  (`universe`/`family`/`range`/`sub_range`), `brand`, descriptions multilingues JSONB
  (`description_marketing`, `description_technical`), identifiants (`gtin`, `hs_code`,
  `dop_number`), indexation cuivre, conditionnement, `pamp_eur`/`stock_quantity`
  (snapshots Odoo), liens Odoo (`odoo_id`, `odoo_v16_id`, `odoo_v19_id`).
- **`products.ProductSupplier`** — sources d'achat. Contrainte : **un seul fournisseur
  actif par produit** (partial unique index `one_active_supplier_per_product`).
- **`attributes.AttributeRegistry`** — définitions d'attributs dynamiques (EAV).
- **`attributes.ProductAttributeValue`** — valeurs par produit, `UNIQUE(product, attribute)`.

### Données de référence seedées (CDC §3.3)

Chargées au `migrate` via **data migrations idempotentes** (`get_or_create` sur `code`).
Logique réutilisable dans `apps/market/seeds.py` et `apps/attributes/seeds.py`.

| Donnée | Table / registre | Quantité | Migration |
|---|---|---|---|
| Incoterms ICC 2020 | `market.Incoterm` (`incoterms`) | 11 | `market/0003_seed_reference_data` |
| Modes de transport | `market.TransportMode` | 7 | `market/0003_seed_reference_data` |
| Attributs minimaux | `attributes.AttributeRegistry` | 5 | `attributes/0003_seed_minimal_attributes` |

Codes attributs seedés : `hs_code`, `gtin`, `dop_number`, `unit_weight_kg`, `pallet_qty`.
`market_parameters` (cuivre/FX) **non seedés** — saisie manuelle.

**Incoterms — double représentation (cf. `decisions.md`)** :
- Table `incoterms` = référentiel (`GET /api/market/incoterms`, admin Django).
- Enum `apps.products.models.Incoterm` = validation des CharField `incoterm` sur
  `ProductSupplier`, `OfferLine`, `Client` (pas de FK en MVP1).

**Vérifier après `migrate`** :
- Frontend : **Paramètres → Modes de transport** (7 lignes).
- API : `/api/market/incoterms`, `/api/transport-modes/`.
- Tests : `pytest apps/market/tests/test_seed.py`.

### Pattern EAV (attributs dynamiques, CDC §4.5)

Les clients ajoutent des attributs **sans migration de schéma**. Le registre porte le
type ; la valeur est en JSONB.

| `AttributeRegistry.field` | Rôle |
|---|---|
| `code` | clé technique, **immuable** après création |
| `label` | JSONB multilingue `{"fr": ..., "en": ..., "es": ...}` (`fr` requis) |
| `category` | `structural` \| `technical` \| `marketing` \| `commercial` \| `logistic` |
| `data_type` | `text` \| `number` \| `boolean` \| `date` \| `select` \| `multiselect` |
| `options` | pour `select`/`multiselect` : `[{"value": ..., "label": {...}}]` |
| `unit` | unité affichée (ex. `mm`, `kg`) pour `number` |
| `is_filterable` | expose l'attribut comme **filtre sidebar catalogue** (`attr_<code>=…`) |
| `display_order` | ordre d'affichage (réordonnable via `/api/attributes/reorder/`) |

**Encodage `ProductAttributeValue.value` selon `data_type`** (validé serveur ET client) :

| `data_type` | shape JSON |
|---|---|
| `text` | string |
| `number` | nombre (validé `Decimal`) |
| `boolean` | `true` / `false` (bool strict, pas `"true"`) |
| `date` | string ISO `"YYYY-MM-DD"` |
| `select` | string ∈ `options[].value` |
| `multiselect` | array de strings, chacun ∈ `options[].value` |

Validation backend : `apps/attributes/serializers.py::_validate_attribute_value`.
Miroir frontend : `components/AttributeRenderer.tsx::validateAttributeValue`
(garder les deux alignés — le backend fait foi).

---

## Endpoints (montés sous `/api/`)

| Méthode | Path | Note |
|---|---|---|
| `GET`/`POST` | `/api/products/` | liste (compact, filtrable+recherche+tri) / create. POST déclenche le push Odoo async (cf. `_push_to_odoo_async`). Tri via `ProductOrderingFilter` (`ordering.py`) |
| `GET` | `/api/products/?q=…` | **recherche full-text** `tsvector` (FR `french` + EN/ES/codes `simple`), tri `SearchRank` |
| `GET` | `/api/products/?attr_<code>=…` | filtre par attribut dynamique (**seulement** si `is_filterable=True`) |
| `GET` | `/api/brands` · `/api/factory-codes` | valeurs distinctes (filtres sidebar) |
| `POST` | `/api/products/export` | export Excel **async** ; body `{filters, columns, ids}` → `202 + task_id` |
| `GET` | `/api/products/exports/{task_id}` | download du `.xlsx` produit par la tâche |
| `POST` | `/api/products/parse-sku` | utilitaire wizard → `{sku, parent_reference, factory_code}` (service `sku_parser`) ; 400 si `sku` absent |
| `GET` | `/api/hierarchy/distinct?level=…` | valeurs distinctes par niveau (cascade wizard : universe → family → range → sub_range) |
| `GET` | `/api/supplier-names` | noms fournisseurs distincts déjà utilisés dans le catalogue |
| `GET` | `/api/supplier-names/template?name=…` | pré-remplissage commercial depuis la dernière ligne `ProductSupplier` de ce nom ; 404 si inconnu |
| `GET`/`PATCH`/`PUT`/`DELETE` | `/api/products/{id\|sku}/` | lookup **UUID ou `sku_code`** ; DELETE = soft-delete |
| `GET` | `/api/products/{id}/attributes/` | valeurs EAV du produit (array, **non paginé**) |
| `PUT`/`DELETE` | `/api/products/{id}/attributes/{attribute_id}/` | upsert (body `{"value": ...}`) / suppression |
| `GET` | `/api/products/{id}/price-history/?period=3m\|6m\|12m` | PA/PR/PV des simulations finalisées |
| `POST` | `/api/products/{id}/refresh-pamp/` | async (Odoo) → `202 + task_id` |
| `POST` | `/api/products/{id}/translate/` | async (DeepL) `{target_lang: en\|es}` |
| `GET`/`POST` | `/api/products/{id}/suppliers/` | fournisseurs imbriqués (list / create) |
| `PATCH`/`DELETE` | `/api/products/{id}/suppliers/{pk}/` | update / delete d'un fournisseur |
| `POST` | `/api/products/{id}/suppliers/{pk}/activate/` | active ce fournisseur, désactive les autres **dans une transaction** (mutex `one_active_supplier_per_product`) |
| CRUD | `/api/attributes/` (+ `POST /reorder/`) | registre des définitions (paginé) |
| CRUD | `/api/attribute-values/?product={uuid}` | accès plat aux valeurs (legacy) |

**Gotchas** :
- `ProductDetailSerializer` **n'embarque pas** `attribute_values` → les charger via
  `/attributes/`. Le frontend fusionne registre (définitions) + valeurs (par produit).
- Pas de `pv_eur` sur `Product` : le « prix de vente actuel » = dernier point de
  `price-history` (simulations finalisées uniquement).
- Upsert attribut = **PUT** (pas PATCH), body = juste `{"value": ...}`.
- `refresh-pamp` / `translate` exigent un `odoo_id` / une description FR.

---

## Catalogue frontend (`/catalog`, CDC §4.1.1 / §4.3 Écran 1)

Page : [frontend/src/app/catalog/page.tsx](../../frontend/src/app/catalog/page.tsx) +
composants privés dans `frontend/src/app/catalog/_components/`.

| Composant | Rôle |
|---|---|
| `CatalogSidebar.tsx` | Filtres desktop (sections `Collapsible`, multi-checkbox, recherche locale) |
| `CatalogFilterSheet.tsx` | Même filtres en panneau latéral mobile/tablette |
| `ActiveFilterBar.tsx` + `active-filters.ts` | Chips des critères actifs (retrait unitaire + tout effacer) |
| `CatalogPagination.tsx` | Pagination style Google (100 lignes/page) |
| `ProductDrawer.tsx` | Aperçu rapide au clic ligne |
| `ExportButton.tsx` | Export async (split button + choix colonnes) |
| `useColumnWidths.ts` | Colonnes redimensionnables (`localStorage`) |
| `filters-storage.ts` | Filtres favoris (`syskern:catalog-filters:v1`) |
| `columns.ts` | Registre colonnes export (miroir `exports.py`) |

- **Recherche full-text** : champ global → param `?q=` (tsvector backend). Debounce 300 ms
  (timer en `ref`, pas de `setState` en effet).
- **Sidebar filtres** : hiérarchie (univers / famille / gamme / sous-gamme), marque, fournisseur
  en **multi-checkbox** (niveaux indépendants — pas de cascade UI obligatoire ; chaque niveau
  via `getHierarchyLevel(level)`). Stock : toggles en stock / rupture + quantité min.
  Attributs dynamiques `is_filterable` (rendus selon `data_type`). État = `CatalogFilters`
  (tableaux `string[]` pour les multi) → `buildCatalogQuery()` dans `lib/api.ts` (partagé liste
  **et** export).
- **Tri serveur** : param `ordering` (`field` / `-field`). En-têtes = cycle UI **asc → desc →
  défaut (SKU ↑)**. Backend : `ProductOrderingFilter` (`NULLS LAST` sur `pamp_eur` /
  `stock_quantity`) — cf. `ordering.py`.
- **Pagination** : `limit=100` ; composant `CatalogPagination`.
- **Sélection multiple** : `Set<string>` d'ids **persistée à travers les pages** → barre d'actions
  groupées (export sélection, `AddToSimulationDialog` `productIds[]`).
- **Détail** : clic ligne → drawer ; cellule SKU = lien `/catalog/[sku]`.
- **Export** : `exportProducts({filters, columns, ids})` → tâche Celery ; **redémarrer le worker**
  si la signature de `export_products_task` change.

## Fiche produit frontend (`/catalog/[sku]`, CDC §4.1.2 / §4.3)

Page : [frontend/src/app/catalog/[sku]/page.tsx](../../frontend/src/app/catalog/[sku]/page.tsx).
Layout **2 colonnes** : carte infos clés (gauche, 1/3) + **6 onglets** Radix (droite, 2/3) :
Général, Technique, Marketing, Logistique, Commercial, Médias (placeholder MVP2).

- Onglets dans `_tabs/` (dossier `_` privé, non routé). Un composant par onglet.
- État d'édition partagé via `EditContext` (`_tabs/edit-context.tsx`) → pas de prop-drilling.
  La page possède le draft ; les onglets lisent via `coreValue`/`attrValue`/`descValue`
  et commitent via `setCore`/`setAttr`/`setDesc`.
- Champs cœur → `Field.tsx` (mappé sur `keyof ProductDetail`). Attributs dynamiques →
  `AttributeRenderer` via `AttributeSection.tsx` (un bloc par `category`).
- Édition gardée par `canEdit(role)` (admin/commercial). Viewer = lecture seule.
- **Supprimer** (soft-delete) : bouton sur la fiche pour `canEdit` → `deleteProduct(idOrSku)`
  (`DELETE /api/products/{id|sku}/`) puis redirection `/catalog`.
- Actions pied de page : **Voir dans Odoo** (`NEXT_PUBLIC_ODOO_BASE_URL`, désactivé si
  `odoo_id` null), **Ajouter à une simulation** (`AddToSimulationDialog`), **Historique**
  (placeholder MVP2).

### `AttributeRenderer` (réutilisable)

`components/AttributeRenderer.tsx` — rendu adaptatif read/edit d'**un** attribut selon
`data_type` (text→input/textarea, number→input+unité, boolean→toggle, date→picker
DD/MM/YYYY, select→Radix Select, multiselect→tags). Props :
`{ attribute, value, mode: "read"|"edit", lang, onChange(value, valid) }`.
Conçu pour réemploi (fiche produit **et** futur wizard de création). Exporte
`validateAttributeValue` et `localize`.

### API client (`lib/api.ts`)

`getProducts(params)` (filtres+`q`+`ordering`+pagination), `buildCatalogQuery`,
`exportProducts({filters,columns,ids})`, `getBrands`, `getFactoryCodes`,
`getFilterableAttributes`, `getHierarchyLevel`,
`getProduct`, `getProductAttributes`, `getAttributeRegistry(category?)`,
`setProductAttribute(productId, attributeId, value)`, `updateProduct(idOrSku, patch)`,
`deleteProduct(idOrSku)`, `createProduct(data)`, `parseSku(sku)`, `getProductSuppliers`, `createSupplier`,
`updateSupplier`, `deleteSupplier`, `activateSupplier`,
`getPriceHistory`, `refreshPamp`, `translateProduct`. Édition en place → voir le pattern
autosave dans `frontend.md`.

---

## Parsing SKU (`apps/products/services/sku_parser.py`, CDC §4.1.3)

Le suffixe de spécification d'un SKU est `-NN` ou `-ENN` (1-3 chiffres, préfixe `E`
optionnel), regex `r"-(E?\d{1,3})$"`.

- `extract_factory_code("KCFF6A4PZHDBL5-21") → "21"` / `"...-E02" → "E02"` / sinon `None`.
- `extract_parent_reference("KCFF6A4PZHDBL5-21") → "KCFF6A4PZHDBL5"` (retrait du suffixe via
  `re.sub` — **pas** le regex littéral du ticket qui était bugué, cf. `decisions.md`).
- `parse_sku(sku)` combine les deux ; alimente l'auto-suggestion du wizard via
  `POST /api/products/parse-sku`. L'utilisateur peut toujours surcharger les valeurs.

## Wizard de création (`/catalog/new`, CDC §4.1.3)

Page : [frontend/src/app/catalog/new/page.tsx](../../frontend/src/app/catalog/new/page.tsx)
(route statique, prioritaire sur `/catalog/[sku]`). 5 étapes (Identification, Technique,
Logistique, Fournisseur(s), Validation) + **toggle « Formulaire complet »**.

- Validation par étape : SKU (`^[A-Z0-9-]+$`) + nom + `description_marketing.fr` requis ;
  cohérence cuivre (miroir `ProductWriteSerializer`). Impossible d'avancer si erreurs.
- **Brouillon `localStorage`** (`syskern:new-product-draft:v1`) : champs + fournisseurs draft
  restaurés au montage ; **l'étape du wizard n'est pas persistée** (réouverture = Identification).
  Purgé après création réussie.
- SKU `onBlur` → `parseSku` → pré-remplit `parent_reference` / `factory_code` (non écrasés
  si l'utilisateur les a édités).
- Hiérarchie : dropdowns en cascade (univers → famille → gamme → sous-gamme) via
  `GET /api/hierarchy/distinct`.
- Attributs `technical` via `AttributeRenderer` (draft local, persistés **après** création).
- Création : `createProduct` → `setProductAttribute` (par attribut) → `createSupplier`
  (par fournisseur draft). Sync Odoo automatique côté serveur → création locale OK même si
  Odoo est down. Gardé par `canEdit(role)`.

## Gestion fournisseurs (`components/SupplierManager.tsx`)

Composant **réutilisable** (CRUD + toggle « Source active » mutex UI + suppression confirmée).
Wiring API + `mutate` SWR dans l'onglet Commercial (gardé par `canEdit`) ; wiring sur draft
local (ids `crypto.randomUUID()`) dans l'étape 4 du wizard. Props :
`{ suppliers, onCreate, onUpdate, onDelete, onActivate, readOnly?, maxSuppliers? }`.

À l'ajout : bascule **« Fournisseur existant »** (liste `GET /api/supplier-names` + pré-remplissage
via `GET /api/supplier-names/template`) vs **« Nouveau fournisseur »** (saisie libre du nom).

---

## Décisions liées (cf. `decisions.md`)

- Couche modèle PIM déjà livrée (gap-only sur les tickets « migrations initiales »).
- Incoterms : table `incoterms` + enum `Incoterm` coexistent (pas de FK en MVP1).
- Seed référence : data migrations Django idempotentes (`seeds.py`).
- Chevauchement assumé colonnes first-class ↔ attributs registre (`hs_code`, `gtin`,
  `dop_number`, `unit_weight_kg`, `pallet_qty`) — pas de synchro auto.
- Fiche produit : `NEXT_PUBLIC_ODOO_BASE_URL`, édition gardée par `canEdit`, placeholders
  MVP2 (Médias, Historique).

---

## Checklist PIM

- [ ] Nouvelle ressource backend → `drf-resource.md` (modèle, 3 serializers, ViewSet, tests)
- [ ] Attribut dynamique : `data_type` géré côté **backend** (`_validate_attribute_value`)
      ET **frontend** (`AttributeRenderer` + `validateAttributeValue`)
- [ ] Soft-delete produit (`is_active=False`), jamais de hard-delete
- [ ] Frontend : valeurs EAV chargées via `/attributes/`, fusionnées avec le registre
- [ ] Decimal (`pamp_eur`, prix) traités comme `string` côté front (jamais de calcul)
- [ ] Édition gardée par `canEdit(role)`
