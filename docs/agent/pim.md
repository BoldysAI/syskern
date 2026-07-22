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
  Propriété **`designation`** : libellé lisible = `description_marketing.fr` → `name` →
  `sku_code` (souvent `name` = SKU en base migrée). Exposée sur les lignes simulation
  (`product_designation`) et les exports pricing.
- **`products.ProductSupplier`** — sources d'achat. Contrainte : **un seul fournisseur
  actif par produit** (partial unique index `one_active_supplier_per_product`). Porte désormais
  une **FK `supplier` → `suppliers.Supplier`** (entité, module Fournisseurs → `suppliers.md`) ;
  `supplier_name` **conservé dénormalisé** (compat Odoo sync / filtres / exports). Reste la source
  de vérité pour le pricing (prix/devise/incoterm par lien). Changements de PO tracés dans
  `products.SupplierPriceHistory`.
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
- Table `incoterms` = référentiel (`GET /api/incoterms`, admin Django).
- Enum `apps.products.models.Incoterm` = validation des CharField `incoterm` sur
  `ProductSupplier`, `OfferLine`, `Client` (pas de FK en MVP1).

**Vérifier après `migrate`** :
- Frontend : **Paramètres → Modes de transport** (7 lignes).
- API : `/api/incoterms`, `/api/transport-modes/`.
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
| `default_value` | valeur par défaut ; backfill sur tous les produits **à la création** de l'attribut |
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
Miroir frontend : `components/AttributeRenderer.tsx` (`validateAttributeValue`,
`isAttributeValueEmpty`, `formatAttributeDisplayValue`, `localize`) — garder backend et front alignés.

### Valeur par défaut + backfill (migration `attributes/0005`)

- **`default_value`** optionnel sur le registre ; **obligatoire** si `is_required=True` (validation API).
- **À la création** d'un attribut avec `default_value` renseigné : backfill des lignes
  `product_attribute_values` pour **tous** les produits (actifs + inactifs) qui n'ont pas encore
  de valeur pour cet attribut.
- **Service** : `apps/attributes/services/backfill.py::backfill_attribute_defaults`.
- **Async** : `attributes.backfill_attribute_defaults_task` (Celery) si catalogue **> 100** produits ;
  sinon synchrone dans `AttributeRegistryViewSet.perform_create`.
- **Édition** du registre : modifier `default_value` **ne relance pas** le backfill et n'écrase pas
  les valeurs déjà saisies.
- **UI admin** : interrupteur « Valeur par défaut » ; le champ typé (`AttributeRenderer`) n'apparaît
  que si activé. Cocher « Obligatoire » active automatiquement la valeur par défaut.
- **Tests** : `apps/attributes/tests/test_backfill.py`, `apps/products/tests/test_attr_columns.py`.

---

## Endpoints (montés sous `/api/`)

| Méthode | Path | Note |
|---|---|---|
| `GET`/`POST` | `/api/products/` | liste compacte. Chaque ligne peut inclure `attribute_values` (dict `code → valeur`) si `?attr_columns=code1,code2` (max 10 codes, prefetch ciblé). POST déclenche push Odoo async |
| `GET` | `/api/products/?q=…` | **recherche full-text** `tsvector` (FR `french` + EN/ES/codes `simple`), tri `SearchRank` |
| `GET` | `/api/products/?attr_<code>=…` | filtre par attribut dynamique (**seulement** si `is_filterable=True`) |
| `GET` | `/api/products/?is_active=true\|false` | filtre statut produit (soft-delete) ; omis = actifs + inactifs |
| `GET` | `/api/products/?supplier=…` | produits ayant **au moins une** source fournisseur avec ce nom (active ou inactive) ; multi CSV ; `__none__` = aucune source liée |
| `GET` | `/api/products/?active_supplier=…` | source **active** uniquement ; multi CSV ; `__none__` = pas de fournisseur actif |
| `GET` | `/api/products/?simulation_id=…` | enrichit chaque ligne avec `catalog_pv` (EUR + USD + RMB via `market_params` de la simulation) pour les produits présents dans cette simulation |
| `GET` | `/api/products/` (sans `simulation_id`) | `catalog_pv` = dernier PV d'une simulation **finalisée** par produit (même logique que price-history) |
| `GET` | `/api/products/?i18n_incomplete=true` | au moins une langue manquante (CDC §10.7.3 → `i18n.md`) |
| `GET` | `/api/products/?lang_{fr,en,es}_{in,out}=true` | avec / sans contenu par langue (description marketing ou technique) |
| `POST` | `/api/products/bulk-translate/` | traduction bulk async (DeepL) `{ids, target_langs, content_fields}` → `202 + task_id` (§10.3.2) |
| `GET` | `/api/products/filter-bounds` | min/max PAMP, stock, attributs numériques — mêmes query params que la liste (sauf bornes sliders) ; queryset de base = tous les produits |
| `GET` | `/api/brands` · `/api/factory-codes` | valeurs distinctes (filtres sidebar). **`/api/brands`** : tous les produits (actifs + inactifs), hors marque vide et typo legacy `unnikern` |
| `POST` | `/api/products/export` | export Excel **async** ; body `{filters, columns, ids}` → `202 + task_id` |
| `GET` | `/api/products/exports/{task_id}` | download du `.xlsx` produit par la tâche |
| `POST` | `/api/products/parse-sku` | utilitaire wizard → `{sku, parent_reference, factory_code}` (service `sku_parser`) ; 400 si `sku` absent |
| `GET` | `/api/products/attribute-completeness` | **complétude catalogue (FEEDBACK 1)** — `{total_products, average_percent, fields[]}` sur les produits **actifs** ; champs cœur + attributs dynamiques, triés du moins au plus complet. Service `services/completeness.build_attribute_completeness`. Alimente le tableau `/settings/attributes` + le widget dashboard (`DashboardCompletenessCard`) |
| `GET` | `/api/products/` (liste) | chaque ligne inclut **`completeness_pct`** (taux de remplissage **par produit**, même jeu de champs que le widget) — `build_product_completeness_map(items)` dans `list()` (2 requêtes/page), passé au serializer via `context["completeness_map"]`. Colonne **« Complétude »** du catalogue (opt-in, `DEFAULT_VISIBLE`), rendu barre+% (`CompletenessCell`) |
| `GET` | `/api/products/?ordering=[-]completeness_pct` | **tri serveur par complétude** — `ProductOrderingFilter` annote `completeness_sort_expression()` (count de champs remplis, monotone avec le %, subquery corrélée, NULLS LAST) ; `completeness_pct` ajouté aux `ordering_fields`. La colonne « Complétude » est triable comme les autres |
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
| CRUD | `/api/attributes/` (+ `POST /reorder/`) | registre des définitions (paginé). Réponses incluent `value_count` (nb de valeurs liées, pour la modale de suppression). `reorder` body `{ids:[…]}` → `display_order = position` |
| CRUD | `/api/attribute-values/?product={uuid}` | accès plat aux valeurs (legacy) |

**Gotchas** :
- `ProductDetailSerializer` **n'embarque pas** `attribute_values` → les charger via
  `/attributes/`. Le frontend fusionne registre (définitions) + valeurs (par produit).
- `i18n_coverage` (`{languages, percent, complete}`) est exposé sur la liste **et** le détail
  (calculé sur `description_marketing`/`technical`). Multilingue → `i18n.md`.
- Pas de `pv_eur` sur `Product` : le « prix de vente actuel » = dernier point de
  `price-history` (simulations finalisées uniquement), affiché en **EUR + USD + RMB**
  (taux `fx_eur_usd` / `fx_eur_rmb` de la simulation source). Liste catalogue :
  champ `catalog_pv` (idem) ; `?simulation_id=` pour cadrer sur une simulation en cours.
- Upsert attribut = **PUT** (pas PATCH), body = juste `{"value": ...}`.
- `refresh-pamp` / `translate` exigent un `odoo_id` / une description FR.

---

## Catalogue frontend (`/catalog`, CDC §4.1.1 / §4.3 Écran 1)

Page : [frontend/src/app/catalog/page.tsx](../../frontend/src/app/catalog/page.tsx) +
composants privés dans `frontend/src/app/catalog/_components/`.

Shell : `bg-background`, sidebar `bg-card border-r`, toolbar `bg-card`. Colonne univers =
`StatusBadge` (`universeBadgeVariant`). Icônes Phosphor dans le code app catalogue.

| Composant | Rôle |
|---|---|
| `CatalogSidebar.tsx` | Filtres desktop (sections `Collapsible`, multi-checkbox, recherche locale) |
| `CatalogFilterSheet.tsx` | Même filtres en panneau latéral mobile/tablette |
| `ActiveFilterBar.tsx` + `active-filters.ts` | Chips des critères actifs (retrait unitaire + tout effacer) |
| `CatalogPagination.tsx` | Pagination style Google (100 lignes/page) |
| `ProductDrawer.tsx` | Aperçu rapide au clic ligne |
| `ExportButton.tsx` | Export async (split button + choix colonnes export — **indépendant** du choix colonnes tableau) |
| `CatalogColumnsDialog.tsx` | Modale choix colonnes **visibles** (produit + attributs dynamiques) |
| `catalog-column-registry.ts` | Métadonnées colonnes cœur + `DEFAULT_VISIBLE_CATALOG_COLUMNS` |
| `catalog-column-storage.ts` | Persistance visibilité (`syskern:catalog-visible-columns:v2`, migre `v1`) |
| `catalog-columns.tsx` | `useCatalogColumns({ visibleColumnKeys, attributeColumns })` |
| `useColumnWidths.ts` | Largeurs redimensionnables (`syskern:catalog-col-widths:v1`) |
| `filters-storage.ts` | Filtres favoris (`syskern:catalog-filters:v1`) |
| `columns.ts` | Registre colonnes export (miroir `exports.py`) |

- **Recherche full-text** : champ global → param `?q=` (tsvector backend). Debounce 300 ms
  (timer en `ref`, pas de `setState` en effet).
- **Sidebar filtres** : hiérarchie (univers / famille / gamme / sous-gamme), marque, section
  **Fournisseur** (toute source liée + sous-filtre repliable **Fournisseur actif** pour la source
  `is_active=true` uniquement — miroir colonne tableau) en **multi-checkbox**. **Statut produit** : toggles exclusifs Actif / Non actif
  (`active_in` / `active_out` → `?is_active=true|false` ; défaut = les deux visibles). Stock :
  toggles en stock / rupture + quantité min. Attributs dynamiques `is_filterable` (rendus selon
  `data_type`, section sidebar « Attributs dynamiques » — toutes catégories confondues ;
  `date` → `<input type="date">`). État = `CatalogFilters` (tableaux `string[]` pour les multi)
  → `buildCatalogQuery()` dans `lib/api.ts` (partagé liste **et** export).
- **Tri serveur** : param `ordering` (`field` / `-field`). En-têtes = cycle UI **asc → desc →
  défaut (SKU ↑)**. Backend : `ProductOrderingFilter` (`NULLS LAST` sur `pamp_eur` /
  `stock_quantity`) — cf. `ordering.py`.
- **Pagination** : `limit=100` ; composant `CatalogPagination`.
- **Sélection multiple** : `Set<string>` d'ids **persistée à travers les pages** → barre d'actions
  groupées (export sélection, **`AddToSimulationDialog`** `productIds[]` — cf. § catalogue → simulation,
  **« Traduire »** → `BulkTranslateDialog` bulk DeepL avec progress — cf. `i18n.md`).
- **Colonnes visibles** : bouton « Colonnes » → modale `CatalogColumnsDialog` (page catalogue
  uniquement ; pas en mode `embedded`). Deux sections à cases à cocher (libellé FR uniquement, pas
  de code technique) :
  - **Colonnes produit** : SKU (verrouillé), Désignation, Univers, Famille, Gamme, Sous-gamme,
    Marque, Fournisseur actif, PAMP, **PV** (EUR/USD/RMB si simulation), Stock, Indexé cuivre, Actif, Langues.
  - **Attributs dynamiques** : tout le registre (`listAttributes`).
  Boutons **Réinitialiser** (défaut = SKU, Désignation, Univers, Famille, Fournisseur, PAMP, Stock,
  Actif, Langues), **Annuler**, **Appliquer**. Persistance `localStorage`
  (`syskern:catalog-visible-columns:v2`). Les attributs cochés déclenchent `?attr_columns=` côté API.
  Pas de tri serveur sur colonnes attributs (v1).
- **Langues** (sidebar § « Langues ») : colonne « Langues » activable via la modale colonnes (plus
  « toujours visible »). Filtres `i18n_incomplete`, `lang_*_{in,out}` inchangés → `i18n.md`.
- **Détail** : clic ligne → drawer ; cellule SKU = lien `/catalog/[sku]`.
- **Export** : `exportProducts({filters, columns, ids})` → tâche Celery ; **redémarrer le worker**
  si la signature de `export_products_task` change.

## Fiche produit frontend (`/catalog/[sku]`, CDC §4.1.2 / §4.3)

Page : [frontend/src/app/catalog/[sku]/page.tsx](../../frontend/src/app/catalog/[sku]/page.tsx).
Layout **2 colonnes** : carte identité sticky (gauche) + **6 onglets** shadcn `Tabs` (droite) :
Général, Technique, Marketing, Logistique, Commercial, Médias (placeholder MVP2).

**UI (Phase 2 redesign)** : tokens sémantiques (`bg-background`, `bg-card`, `text-foreground`,
`text-muted-foreground`) — pas de `slate`/`bg-white`. Liste catalogue : badge univers via
`StatusBadge` + `universeBadgeVariant`. Fiche : `Button`/`Card` shadcn, icônes Phosphor.
Onglet Commercial : graphiques Recharts avec `--chart-1..3`, montants en `font-data`.
Wizard `/catalog/new` : `FormField` + `Input`/`Select`/`Switch` shadcn, sections `Card`.

- Onglets dans `_tabs/` (dossier `_` privé, non routé). Un composant par onglet.
- État d'édition partagé via `EditContext` (`_tabs/edit-context.tsx`) → pas de prop-drilling.
  La page possède le draft ; les onglets lisent via `coreValue`/`attrValue`/`descValue`
  et commitent via `setCore`/`setAttr`/`setDesc`.
- Champs cœur → `Field.tsx` (mappé sur `keyof ProductDetail`). Attributs dynamiques →
  `AttributeRenderer` via `AttributeSection.tsx` (un bloc par `category`).
- **Placement des champs (arbitré en recette, FEEDBACK 2 — ne pas redéplacer sans demande)** :
  - `item_code` (« Code article ») → **juste sous le SKU** dans « Informations générales » (fiche +
    wizard). ⚠️ non alimenté par Odoo à ce jour (en v16 `default_code` est vide).
  - `factory_code` (« Code usine ») → **absent** du panneau « Identifiants » : il appartient à la
    relation produit-fournisseur (onglet Commercial / module Fournisseurs). Le champ existe toujours
    en base (matching migration §8.6) et reste dans le wizard de création (dérivé auto).
  - `unit_weight_kg` → onglet **Logistique** (« Unité, poids & approvisionnement »). Le round 1
    l'avait déplacé en Technique, le client a fait marche arrière.
  - Le libellé « Hiérarchie » est devenu **« Arborescence »** partout (données inchangées).
- **Unité affichée avec le stock** : toujours via `productUnitLabel` (`lib/product-units.ts`) →
  `uom` (Odoo) sinon libellé `base_unit` sinon « u ». Ne pas réintroduire de « u »/« unités » en dur.
- **Descriptions multilingues** (marketing/technique) → `DescriptionsEditor` rend
  `components/MultilingualField` (onglets FR/EN/ES + « Traduire depuis FR » via `/api/translate`).
  Détail multilingue → `i18n.md`.
- Édition gardée par `canEdit(role)` (admin/commercial). Viewer = lecture seule.
- **Supprimer** (soft-delete) : bouton sur la fiche pour `canEdit` → `deleteProduct(idOrSku)`
  (`DELETE /api/products/{id|sku}/`) puis redirection `/catalog`.
- Actions pied de page : **Voir dans Odoo** (`NEXT_PUBLIC_ODOO_BASE_URL`, désactivé si
  `odoo_id` null), **Ajouter à une simulation** (`AddToSimulationDialog` — modale 2 onglets :
  simulation brouillon existante `POST /lines` ou wizard `/simulator/new?from=catalog` ; cf.
  `frontend.md` § Catalogue → simulation), **Historique** (placeholder MVP2).

### `AttributeRenderer` (réutilisable)

`components/AttributeRenderer.tsx` — rendu adaptatif read/edit d'**un** attribut selon
`data_type` (text→input/textarea, number→input+unité, boolean→toggle, date→picker
DD/MM/YYYY, select→Radix Select, multiselect→tags). Props :
`{ attribute, value, mode: "read"|"edit", lang, onChange(value, valid) }`.
Réutilisé : fiche produit, wizard création, modale admin (label + valeur par défaut).
Exporte `validateAttributeValue`, `isAttributeValueEmpty`, `formatAttributeDisplayValue`, `localize`.

### API client (`lib/api.ts`)

`getProducts(params)` (filtres+`q`+`ordering`+pagination), `buildCatalogQuery`,
`exportProducts({filters,columns,ids})`, `getBrands`, `getFactoryCodes`,
`getFilterableAttributes`, `getHierarchyLevel`,
`getProduct`, `getProductAttributes`, `getAttributeRegistry(category?)`,
`setProductAttribute(productId, attributeId, value)`, `updateProduct(idOrSku, patch)`,
`deleteProduct(idOrSku)`, `createProduct(data)`, `parseSku(sku)`, `getProductSuppliers`, `createSupplier`,
`updateSupplier`, `deleteSupplier`, `activateSupplier`,
`getPriceHistory`, `refreshPamp`, `translateProduct`. Édition en place → voir le pattern
autosave dans `frontend.md`. Registre admin :
`listAttributes()`, `createAttribute(data)`, `updateAttribute(id, patch)`,
`deleteAttribute(id)`, `reorderAttributes(ids)`.

---

## Admin registre d'attributs (`/settings/attributes`, CDC §4.1.4 / §4.3 Écran 3)

Page : [frontend/src/app/settings/attributes/page.tsx](../../frontend/src/app/settings/attributes/page.tsx)
(+ composants privés dans `_components/`). **Admin only** (redirige sinon). Permet à
Olivier d'ajouter / modifier / supprimer / réordonner les attributs **sans migration SQL**.

| Élément | Rôle |
|---|---|
| `SettingsNav.tsx` (`../_components/`) | Barre d'onglets de liens partagée par `/settings` (Marché/Transport/Odoo via `?tab=`) et `/settings/attributes` |
| `rows.tsx` | `AttributeRow` (statique) + `SortableAttributeRow` (`useSortable`, drag handle `GripVertical`) |
| `AttributeFormModal.tsx` | Création / édition : label **`MultilingualField`**, catégorie, type, options, unité ; interrupteur **Valeur par défaut** + saisie typée (`AttributeRenderer`, visible si activé) ; toggles Obligatoire / Recherchable / Filtrable. « Obligatoire » force l'activation de la valeur par défaut |
| `DeleteAttributeDialog.tsx` | Confirmation : affiche `value_count` + **saisie du code** pour activer la suppression |
| `constants.ts` | `CATEGORIES`/`DATA_TYPES` (labels FR), `CODE_REGEX`, `slugifyCode()` |

- **Tableau** : Code, Label FR, Catégorie, Type, Obligatoire, Ordre, Actions. Filtres par
  **chips de catégorie** au-dessus.
- **Drag-and-drop** (`@dnd-kit/core`+`sortable`) actif **uniquement quand une catégorie est
  isolée** (reorder intra-catégorie). Optimiste (`mutate(KEY, …, {revalidate:false})`) puis
  revalidation ; rollback + message FR sur erreur. Persiste via `reorderAttributes(ids)`.
- **Code** auto-généré depuis le label FR (`slugifyCode`), éditable à la création,
  **grisé/disabled en édition** (immuable — doublé serveur).
- **Création depuis un chip de catégorie** : la modale pré-sélectionne cette catégorie
  (`defaultCategory` ; onglet « Toutes » → défaut `technical`).
- **Suppression en cascade** : `ProductAttributeValue.attribute` est `on_delete=CASCADE` ;
  la modale annonce le nombre de valeurs supprimées (`value_count`).
- **Création avec défaut** : toast « Application de la valeur par défaut… » ; backfill async si
  catalogue > 100 SKU (**worker Celery requis**).

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
  Purgé après création réussie. **Clé + shape + helpers = source unique**
  [frontend/src/app/catalog/new/draft.ts](../../frontend/src/app/catalog/new/draft.ts)
  (`DRAFT_KEY`, `WizardDraft`, `loadDraft`, `seedProductDraft`, `buildDuplicateDraft`).
- **Duplication (FEEDBACK 1)** : bouton « Dupliquer » sur la fiche produit **et depuis la ligne
  catalogue** (drawer `ProductDrawer`), `canEdit` → même flux partagé →
  `buildDuplicateDraft(product, attrValues)` seede le brouillon avec hiérarchie, marque,
  descriptions, champs core logistique/technique **et tous les attributs dynamiques**, puis
  `router.push('/catalog/new')` (`fullForm=true`). **SKU vidé + requis** (unique/immuable) ;
  **ni l'historique de prix ni le fournisseur actif ne sont copiés** (nouveau produit sans
  fournisseur, décision Yassine). L'utilisateur renseigne un SKU puis enregistre.
- SKU `onBlur` → `parseSku` → pré-remplit `parent_reference` / `factory_code` (non écrasés
  si l'utilisateur les a édités).
- Hiérarchie : dropdowns en cascade (univers → famille → gamme → sous-gamme) via
  `GET /api/hierarchy/distinct`.
- **Attributs dynamiques (toutes catégories)** via `getAttributeRegistry()` + `AttributeRenderer` ;
  mapping étapes :
  | Étape | Catégories |
  |---|---|
  | Identification | `structural`, `marketing` |
  | Technique | `technical` |
  | Logistique | `logistic` |
  | Fournisseur(s) | `commercial` |
  Pré-remplissage lecture depuis `default_value` du registre (`attrValue()`). Validation
  `is_required` via `isAttributeValueEmpty`. Persistés **après** `createProduct` (`setProductAttribute`
  pour chaque attribut non vide).
- Création : `createProduct` → `setProductAttribute` (toutes catégories) → `createSupplier`
  (par fournisseur draft). Sync Odoo automatique côté serveur → création locale OK même si
  Odoo est down. Gardé par `canEdit(role)`.

## Gestion fournisseurs (`components/SupplierManager.tsx`)

Composant **réutilisable** (CRUD + toggle « Source active » mutex UI + suppression confirmée).
Wiring API + `mutate` SWR dans l'onglet Commercial (gardé par `canEdit`) ; wiring sur draft
local (ids `crypto.randomUUID()`) dans l'étape 4 du wizard. Props :
`{ suppliers, onCreate, onUpdate, onDelete, onActivate, readOnly?, maxSuppliers? }`.

À l'ajout : bascule **« Fournisseur existant »** (liste `GET /api/supplier-names` + pré-remplissage
via `GET /api/supplier-names/template`) vs **« Nouveau fournisseur »** (saisie libre du nom).

**Champ PO** : le libellé UI **« PO base »** correspond à `ProductSupplier.po_base_price`
(CDC : prix d'achat fournisseur de référence, devise d'origine). C'est l'entrée de la chaîne PA
(`PO base` → variation cuivre → … → PA net). Ne pas confondre avec PA net, PR ou PAMP.

**Incoterm achat** (`ProductSupplier.incoterm` + `incoterm_location`) : metadata du PO base —
exprime ce que le prix fournisseur inclut déjà (ex. FOB Shanghai = jusqu'au bord navire). Au recalc,
snapshoté dans `SimulationLine.supplier_snapshot` ; le runner l'expose dans
`calculation_breakdown.incoterm_context.purchase_incoterm` et émet des warnings si la chaîne PA
duplique des transports déjà couverts (cf. `incoterm_rules.check_purchase_chain_coherence`).
L'utilisateur **ajoute manuellement** les transports/douanes non couverts (§12.2) ; le preset
« Standard import Chine » du wizard est un exemple FOB-like (2 transports + douane, montants vides).

**Incoterm vente** : stocké sur `Simulation.sale_incoterm` (pas sur le produit) — hypothèse
commerciale figée au recalc, reprise par défaut à la création d'offre (`OfferWriteSerializer`).

---

## Décisions liées (cf. `decisions.md`)

- Couche modèle PIM déjà livrée (gap-only sur les tickets « migrations initiales »).
- Incoterms : table `incoterms` + enum `Incoterm` coexistent (pas de FK en MVP1).
- Seed référence : data migrations Django idempotentes (`seeds.py`).
- Chevauchement assumé colonnes first-class ↔ attributs registre (`hs_code`, `gtin`, …) — pas de synchro auto.
- `default_value` + backfill + colonnes catalogue configurables → `decisions.md` §2026-07-06.
- Fiche produit : `NEXT_PUBLIC_ODOO_BASE_URL`, édition gardée par `canEdit`, placeholders
  MVP2 (Médias, Historique).

---

## Checklist PIM

- [ ] Nouvelle ressource backend → `drf-resource.md` (modèle, 3 serializers, ViewSet, tests)
- [ ] Attribut dynamique : `data_type` géré côté **backend** (`_validate_attribute_value`)
      ET **frontend** (`AttributeRenderer` + `validateAttributeValue` + `isAttributeValueEmpty`)
- [ ] `default_value` : backfill à la création uniquement ; worker Celery si > 100 produits
- [ ] Colonnes catalogue : registre `catalog-column-registry.ts` ; visibilité `catalog-column-storage.ts` ;
      modale `CatalogColumnsDialog` ; export Excel reste séparé (`ExportButton` / `columns.ts`)
- [ ] Soft-delete produit (`is_active=False`), jamais de hard-delete
- [ ] Frontend : valeurs EAV chargées via `/attributes/`, fusionnées avec le registre
- [ ] Decimal (`pamp_eur`, prix) traités comme `string` côté front (jamais de calcul)
- [ ] Édition gardée par `canEdit(role)`
