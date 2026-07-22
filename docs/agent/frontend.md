# docs/agent/frontend.md — Conventions frontend (Next.js + TypeScript)

> Lis ce fichier avant toute tâche frontend.
> Règles transverses → `/AGENTS.md` §7 (Context7 obligatoire).
> Référence : `frontend/src/lib/api.ts`, `frontend/src/lib/auth.ts`,
> `frontend/src/contexts/AuthContext.tsx`, `frontend/src/app/catalog/page.tsx`.

---

## ⚠️ Warning — stack post-training

**Next.js 16 / React 19 / Tailwind CSS 4 sont tous postérieurs au training des modèles IA.**
Les APIs, conventions et structures de fichiers DIFFÈRENT de ce que tu connais.
**Récupère la documentation à jour via Context7 avant d'écrire du code framework.**
Tiens compte de toutes les dépréciations.

---

## Stack exacte (voir `frontend/package.json` pour les versions)

| Lib | Rôle |
|---|---|
| Next.js 16 (App Router) | Routing, SSR/RSC, middleware |
| React 19 | UI |
| TypeScript 5 | Typage |
| Tailwind CSS 4 | Styles (config PostCSS — PAS de `tailwind.config.js`) |
| shadcn/ui (base-nova) | Composants UI (`components/ui/`) — Button, Card, Dialog, etc. |
| SWR 2 | Data fetching / cache client |
| Radix UI / Base UI | Primitives headless sous shadcn |
| Lucide React | Icônes |
| Recharts | Graphiques (PA/PR/PV) |
| `clsx` + `tailwind-merge` | `cn()` utilitaire dans `lib/utils.ts` |

---

## Appeler l'API

**Toutes les requêtes passent par `lib/api.ts`.** Jamais de `fetch()` brut dans un composant.

### Ajouter un endpoint

```typescript
// 1. Interface dans lib/api.ts (si nouveau type de réponse)
export interface MyResource {
  id: string;
  name: string;
  amount: string;   // Decimal → toujours string depuis l'API
}

// 2. Fonction dans lib/api.ts
export function getMyResource(id: string): Promise<MyResource> {
  return apiFetch<MyResource>(`/api/my-resources/${encodeURIComponent(id)}/`);
}

export function createMyResource(data: Partial<MyResource>): Promise<MyResource> {
  return apiFetch<MyResource>("/api/my-resources/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

**Règles :**
- Les champs `Decimal` du backend arrivent comme `string` → ne jamais les utiliser dans des calculs
  arithmétiques côté front. `parseFloat()` uniquement pour affichage.
- Les IDs sont des UUID en `string`.
- `credentials: "include"` et `X-CSRFToken` sont gérés par `apiFetch` — ne pas les répéter.

### Tâches Celery async → `dispatchAndPoll`

```typescript
// Dispatch une tâche et attend le résultat — ne pas réimplémenter le polling dans les composants.
export function myAsyncAction(id: string): Promise<MyResource> {
  return dispatchAndPoll<MyResource>(
    `/api/my-resources/${id}/my-action/`,
    { method: "POST" },
    { timeoutMs: 60_000 },
  );
}
```

---

## Ajouter une page

Structure App Router : `src/app/<route>/page.tsx`.

```typescript
"use client";                         // toutes les pages actuelles sont client components

import useSWR from "swr";
import { getMyResource, type MyResource } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

export default function MyPage() {
  const { role, isLoading: authLoading } = useAuth();

  // Cache key = tableau des params qui font varier la requête
  const { data, isLoading, error } = useSWR<MyResource>(
    ["my-resource", id],
    () => getMyResource(id),
  );

  if (isLoading || authLoading) return <Skeleton />;
  if (error) return <div className="text-red-500">Erreur de chargement.</div>;

  return <div>{data?.name}</div>;
}
```

**Règles :**
- Data fetching = **SWR**. Pas de `useEffect + useState` pour fetcher.
- Cache key SWR = tableau de tous les params qui font varier la requête.
- `"use client"` en tête si le composant utilise des hooks React ou des événements.
- Path alias : `@/` = `src/`. Toujours utiliser `@/lib/api`, `@/lib/auth`, etc.

---

## Auth et contrôle d'accès

```typescript
import { useAuth } from "@/contexts/AuthContext";
import { canEdit, isAdmin } from "@/lib/auth";

const { user, role, isLoading } = useAuth();

// Roles : "admin" | "commercial" | "viewer"
if (canEdit(role)) { /* admin ou commercial */ }
if (isAdmin(role)) { /* admin uniquement */ }
```

Ne jamais comparer `role === "admin"` inline — utiliser `canEdit(role)` / `isAdmin(role)`.

---

## Édition en place & autosave

Pattern pour l'édition en place (fiche produit, CDC §4.3). Référence :
`hooks/useAutosave.ts`, `app/catalog/[sku]/page.tsx`.

```typescript
import { useAutosave } from "@/hooks/useAutosave";

// `draft` doit être référentiellement stable tant qu'il ne change pas (useMemo).
const draft = useMemo(() => ({ core: coreDraft, attrs: attrDraft }), [coreDraft, attrDraft]);
const { status, error } = useAutosave(draft, persist, { delay: 2000, enabled: !!data });
// status: "idle" | "saving" | "saved" | "error" → indicateur visuel
```

**Règles :**
- Debounce **2s** ; un burst d'édits = **un seul** appel (`onSave` reçoit la dernière valeur).
- **Update optimiste** : refléter le draft immédiatement, puis `mutate(key, next, { revalidate: false })`.
- **Rollback** sur erreur backend : purger le draft + `mutate(key)` (refetch), afficher un message FR.
- **Pas d'appel si la validation client échoue** (typage par champ avant submit).
- Ne jamais `setState` directement dans un effet, ni lire/écrire un `ref.current` pendant le render
  (règles `react-hooks/refs` + `set-state-in-effect`) — sinon `next build` casse.

---

## Brouillon de formulaire long (localStorage)

Pour les formulaires multi-étapes (ex. wizard de création produit `/catalog/new`) :

- Restaurer le brouillon via un **initializer paresseux** `useState(loadDraft)` (lit
  `localStorage` une seule fois, retourne un défaut si SSR / vide). **Ne pas** restaurer via
  `useEffect + setState` (règle `set-state-in-effect`).
- Persister via un **effet qui écrit seulement** `localStorage.setItem` (aucun `setState`).
  **Ne pas persister l'étape / onglet actif** du wizard — seulement les données de formulaire
  (cf. wizard `/catalog/new` : réouverture toujours sur l'étape Identification).
- Purger (`removeItem`) après succès. Clé versionnée (ex. `syskern:new-product-draft:v1`).
- Toujours `try/catch` les accès `localStorage` (mode privé / quota).

## Champs multilingues (`MultilingualField`)

Composant réutilisable `components/MultilingualField.tsx` pour tout contenu JSONB
`{fr,en,es}` (CDC §10.7.1). Onglets FR/EN/ES, `kind="input"|"textarea"`, indicateur d'état
par onglet (rempli/vide), bouton « Traduire depuis FR » (EN/ES) → `translateText()`
(`/api/translate`, synchrone + cache). Erreurs API (`503`, quota…) affichées sous le champ.
`mode="read"|"edit"`, `requiredSource` marque FR d'un `*`.
Props : `{ value, onChange, mode, kind, label, requiredSource, rows }`. Utilisé par
`DescriptionsEditor` (fiche produit) et `AttributeFormModal` (label + valeur par défaut). Domaine i18n complet
(couverture catalogue, bulk translate, langue offre) → `docs/agent/i18n.md`.

## `AttributeRenderer` (attributs dynamiques)

Référence : `components/AttributeRenderer.tsx` — rendu typé selon `data_type` (text, number,
boolean, date, select, multiselect). Props :
`{ attribute, value, mode: "read"|"edit", lang, onChange(value, valid) }`.

Exports utiles (garder alignés avec `apps/attributes/serializers.py::_validate_attribute_value`) :
- `validateAttributeValue` — validation client avant submit ;
- `isAttributeValueEmpty` — détection valeur vide (wizard `is_required`, admin) ;
- `formatAttributeDisplayValue` — affichage lecture catalogue ;
- `localize` — libellé FR depuis JSONB multilingue.

Réutilisé : fiche produit, wizard `/catalog/new`, modale admin attributs.

## Catalogue : favoris, sélection multi-pages, colonnes, filtres actifs

Patterns réutilisables introduits par l'écran catalogue (`app/catalog/_components/`) :

- **Filtres favoris (`localStorage`)** : `filters-storage.ts` (clé `syskern:catalog-filters:v1`).
  Charger via initializer paresseux `useState(loadSavedFilters)` ; persister via un **effet
  d'écriture seule** (`useEffect(() => persistSavedFilters(x), [x])`, aucun `setState`).
  `normalizeCatalogFilters` migre les anciennes valeurs string → `string[]`.
- **Chips filtres actifs** : `active-filters.ts` (`buildFilterChips`, `countActiveFilters`,
  `removeFilterChip`) + `ActiveFilterBar.tsx` au-dessus du tableau.
- **Statut produit** : toggles exclusifs `active_in` / `active_out` (section « Statut produit »,
  même pattern que stock) → `buildCatalogQuery()` envoie `is_active=true|false` ; aucun des deux =
  pas de filtre (actifs + inactifs). Chips « Actif » / « Non actif » ; persisté dans les favoris.
- **Filtres mobile** : `CatalogFilterTrigger` + `CatalogFilterSheet` (Sheet shadcn, panneau gauche).
- **Bornes sliders** : `GET /api/products/filter-bounds` via `getCatalogFilterBounds()` — min/max PAMP, stock et attributs numériques contextualisés aux filtres actifs (hors fourchettes PAMP/stock ; queryset de base = **tous** les produits, le filtre `is_active` de la requête s'applique via `ProductFilter`). Helpers `slider-bounds.ts`, composant `RangeFilterSlider`.
- **Hiérarchie cascade** : `HierarchyFilterCascade` — niveaux repliables, fetch lazy par niveau, parents CSV (`hierarchy/distinct?universe=U1,U2`).
- **Sélection persistée à travers les pages** : garder un `Set<string>` d'ids en state, **ne pas**
  le réinitialiser au changement de page (le faire seulement après une action groupée réussie).
  Sur clic de ligne interactif (checkbox, lien) : `onClick={(e) => e.stopPropagation()}` pour ne
  pas déclencher l'ouverture du drawer.
- **Recherche debouncée** : timer dans un `ref`, `setState` planifié dans le callback `setTimeout`
  (jamais directement dans un effet — règle `set-state-in-effect`).
- **Drawer slide-over** : `Dialog` Radix positionné `fixed right-0 top-0 h-full` (cf.
  `ProductDrawer.tsx`).
- **`apiFetch` et DELETE** : réponses `204 No Content` → retourner `undefined` (soft-delete produit,
  fournisseurs, etc.).

### Colonnes visibles catalogue (modale)

Référence : `catalog/_components/CatalogColumnsDialog.tsx`, `catalog-column-registry.ts`,
`catalog-column-storage.ts`, `catalog-columns.tsx`.

- **Bouton « Colonnes »** (page `/catalog` uniquement, pas en `embedded`) → modale avec deux sections
  à cases à cocher (libellé FR uniquement, jamais le code technique) :
  - **Colonnes produit** : SKU (verrouillé), Désignation, Univers, Famille, Gamme, Sous-gamme,
    Marque, Fournisseur actif, PAMP, Stock, Indexé cuivre, Actif, Langues.
  - **Attributs dynamiques** : tout le registre (`listAttributes`).
- **Actions** : Réinitialiser (défaut = `DEFAULT_VISIBLE_CATALOG_COLUMNS`), Annuler, Appliquer.
- **Persistance** : `localStorage` clé `syskern:catalog-visible-columns:v2` ; migration automatique
  depuis `syskern:catalog-attr-columns:v1`. `ensureLockedColumns` injecte le SKU puis trie via
  `orderVisibleColumnKeys` (pas de récursion entre les deux helpers).
- **Rendu** : `useCatalogColumns({ visibleColumnKeys, attributeColumns })` fusionne colonnes cœur +
  dynamiques ; les clés `attr:*` déclenchent `?attr_columns=` dans `buildCatalogQuery`.
- **Export Excel** : choix de colonnes **indépendant** (`ExportButton` / `columns.ts`) — ne pas
  confondre avec la visibilité tableau.
- **Piège évité** : `ensureLockedColumns` ne doit pas rappeler `orderVisibleColumnKeys` qui
  rappellerait `ensureLockedColumns` (stack overflow).

### Panneaux de filtres — sections fermées par défaut (playbook UX)

**Règle plateforme** : toute catégorie de filtre (sidebar catalogue, simulations, modales catalogue
embarquées, etc.) s’affiche **repliée** au premier rendu. L’utilisateur ouvre explicitement les
sections dont il a besoin.

- **Composant canonique** : `FilterSection` (`components/FilterSection.tsx`) — `defaultOpen` vaut
  `false` ; **ne jamais** l’ouvrir automatiquement selon le contenu (ex. favoris déjà enregistrés,
  filtres actifs, etc.).
- **Sous-niveaux** : cascades hiérarchie (`HierarchyFilterCascade`), attributs dynamiques, etc. —
  même règle (`useState(false)` sur chaque repliable).
- **Badge `activeCount`** : indique qu’un filtre est appliqué **sans** déplier la section.
- **Ordre des options** : l’ordre d’affichage des cases à cocher (`FilterCheckboxGroup`) reste
  **fixe** (ordre fourni par l’appelant / API) — cocher une valeur **ne la remonte pas** en tête de
  liste. La recherche locale filtre uniquement, sans réordonner selon la sélection.
- **Exceptions** : **une seule** — « Arborescence produit » du catalogue (`CatalogSidebar`) passe
  `defaultOpen` (FEEDBACK 2 : c’est le filtre que le client utilise à chaque recherche). Ne pas
  étendre à d’autres sections sans demande client explicite. Le panneau filtres latéral peut rester
  visible/ouvert en entier, seules les **sections internes** restent fermées.
- **Filtres par défaut du catalogue** : `CatalogBrowser.withDefaultFilters()` applique `active_in:
  true` au premier rendu **et** après « Tout effacer » — les produits soft-deletés sont masqués par
  défaut (FEEDBACK 2). Un appelant passant explicitement `active_out` garde la main. Le chip
  « Statut · Actif » reste retirable par l’utilisateur.

Consommateurs actuels : `CatalogSidebar`, `SimulationFiltersSidebar`, `OffersFiltersSidebar`,
`QuarantineFiltersSidebar`, `ComparisonFiltersSidebar`, `LibraryFiltersSidebar`, + les
`*FilterSheet` mobiles associés, `AddProductsModal`. **Catalogue** : section **Fournisseur** avec
sous-filtre repliable **Fournisseur actif** (`?supplier=` toute source · `?active_supplier=`
source active ; option **Pas de fournisseur** = `__none__`). **Tous** les modules de liste
(catalogue, simulations, offres, comparaisons, bibliothèque, quarantaine) adoptent désormais ce
pattern (sidebar gauche repliable/redimensionnable + `FilterSection` + chips actifs + favoris
`localStorage` + sheet mobile). Nouveau module de liste → suivre ce même pattern.

### Wizards (produit + offres) — stepper partagé

`components/WizardStepper.tsx` (2026-07-06) : barre d'étapes commune (étapes cliquables,
badge numéro/coche, états actif/fait/erreur, séparateurs `CaretRight`). Utilisée par le wizard
produit (`catalog/new`) et les wizards d'offre (`offers/new-project`, `offers/new-tariff`) → même
look & effet. Props : `steps: {label, hasError?}[]`, `current`, `onStepClick?`.

### Sélecteur de simulation « Nouvelle offre »

`offers/_components/SimulationPickerModal.tsx` (2026-07-06) — miroir du flux d'ajout produit
(`AddProductsModal` ↔ `CatalogBrowser`) : modale large avec **sidebar filtres** (réutilise
`SimulationFiltersSidebar` avec `hideStatus`/`hideDirty`/`hideSaved` → section **Type** seule),
**recherche** (debounce → `q`) et **tableau paginé** des simulations **finalisées** (statut forcé).
Clic sur une ligne → wizard `new-project`/`new-tariff`. `SimulationFiltersSidebar` a gagné des props
optionnelles `hideStatus`/`hideDirty`/`hideSaved` + handlers de favoris optionnels (rétro-compatible).

### Liste offres (`/offers`)

Aligné sur `/simulator` (2026-07-06). `app/offers/_components/` : `OffersFiltersSidebar`
(sections **Type** / **Statut** / **Document** [= `generation_status`] / **Filtres enregistrés**),
`OffersFilterSheet` (+ `OffersFilterTrigger`), `OffersActiveFilterBar`, `offer-filters.ts`
(type `OfferFilters`, options, `buildOfferQuery`, chips, `normalize`), `filters-storage.ts`
(`syskern:offer-filters:v1`). Largeur (`syskern:offer-filters-width`) + repli
(`syskern:offer-filters-collapsed`) persistés. Multi-select CSV côté backend via
`apps.offers.filters.OfferFilter` (`?status=draft,sent` → `__in`), branché en `filterset_class`.
Les KPI (dashboard offres) restent en bandeau au-dessus du tableau. **Pagination serveur**
(2026-07-06, comme le catalogue) : `page`/`offset` + `ordering` serveur (PAGE_SIZE 50), tri
serveur (plus de tri client), prop `pagination` du `DataTable`. `OfferViewSet.ordering_fields`
whiteliste `label/status/valid_to/created_at/updated_at`.

### Quarantaine migration (`/admin/migration-quarantine`)

Aligné sur `/offers` (2026-07-06). `app/admin/migration-quarantine/_components/` :
`QuarantineFiltersSidebar` (sections **Fichier source** [options dynamiques via `facets/`,
searchable] / **Motif** / **Statut** [`resolved`, single-select via checkbox : la dernière
cochée gagne] / **Filtres enregistrés**), `QuarantineFilterSheet`, `QuarantineActiveFilterBar`,
`quarantine-filters.ts` (`buildQuarantineQuery`, `REASON_LABELS`), `filters-storage.ts`
(`syskern:quarantine-filters:v1`). Multi-select CSV backend via `MigrationUnmatchedFilter`
(`source_file`/`reason` → `__in`, rétro-compatible mono-valeur ; `resolved` booléen). Pagination
serveur (offset/limit) + KPI facets (Total / À traiter / Résolues) conservés. Modale de résolution
(3 actions ignore/create/delete) inchangée. Page **admin-only** (`useRequireAdmin`).

### Comparaisons (`/comparator`)

Aligné sur `/simulator` (2026-07-06). `app/comparator/_components/` : `ComparisonFiltersSidebar`
(sections **Type de comparaison** [`has_recalculations`, single-select via checkbox : avec recalculs /
simulations seules] / **Simulations comparées** [`sim_type` tarif/projet, multi] / **Filtres
enregistrés**), `ComparisonFilterSheet`, `ComparisonActiveFilterBar`, `comparison-filters.ts`
(`toComparisonParams` → params `getComparisonsList`), `filters-storage.ts`
(`syskern:comparison-filters:v1`). Backend `SavedComparisonFilter` : `has_recalculations`
(bool sur `recalculation_ids`) + `sim_type` (CSV → sous-requête `Simulation` puis
`simulation_ids__overlap`). Sélection multiple + suppression en masse conservées.

### Bibliothèque (`/library`)

Aligné sur `/offers` (2026-07-06). `app/library/_components/` : `LibraryFiltersSidebar`
(sections **Catégorie** [cgv/warranty/quality/project_reference/company/other] / **Langue**
[fr/en/es] / **Filtres enregistrés**), `LibraryFilterSheet`, `LibraryActiveFilterBar`,
`library-filters.ts` (`buildLibraryQuery`), `filters-storage.ts` (`syskern:library-filters:v1`).
Multi-select CSV backend via `DocumentLibraryFilter` (`category`/`language` → `__in`,
`product`/`is_active` exacts conservés), branché en `filterset_class`. Modales upload / aperçu /
versions inchangées. **Pagination serveur** (2026-07-06) : `offset`/`ordering` (PAGE_SIZE 50) ;
le tri « Document » ordonne par `file_name` (le `name` JSONB n'est pas triable), taille par
`file_size_bytes` — `DocumentLibraryViewSet.ordering_fields` les whiteliste.

## Filtres de liste — style unique (OBLIGATOIRE)

**Tous les filtres de liste utilisent le même style que le catalogue** — jamais de barre de
`FilterSelect`/dropdowns ni de `<select>` custom pour les facettes. Le standard, décliné dans **chaque**
domaine (`catalog`, `offers`, `library`, `comparator`, `simulator`, `suppliers`) :

- **Sidebar de filtres** = sections repliables `components/FilterSection` (titre + icône Phosphor
  `duotone` + badge `activeCount`, **fermées par défaut**) contenant `components/FilterCheckboxGroup`
  (multi-checkbox, `searchable` si > 4 options). Une par domaine : `XFiltersSidebar.tsx`.
- **Recherche plein-texte** = `components/SearchInput` dans la barre d'outils (debounce ~250 ms → `q`).
- **Chips de filtres actifs** = barre `XActiveFilterBar` au-dessus du tableau (catégorie + label + `X`
  pour retirer, bouton « Tout effacer »). Compteur `countActiveXFilters`.
- **Layout** = shell pleine hauteur `flex h-full` : `aside` sidebar gauche (repliable via
  `usePersistedBoolean`, largeur `useResizableWidth` si besoin) + colonne principale (toolbar recherche +
  active bar + `DataTable`).
- **Modèle de filtres produit** = `CatalogFilters` + `buildCatalogQuery()` — **source unique** pour
  catalogue, lignes simulation (`getSimulationLines`), bulk-edit et export produits.
- **Lignes simulation (`SimulationTable`)** : `SimulationLinesFilterSidebar` =
  `SimulationLineStatusFilterSection` + **`CatalogSidebar`** (mêmes sections que le catalogue) ;
  `ActiveFilterBar` + `CatalogFilterSheet` mobile (`prependContent` = statut calcul). **Interdit** :
  barre de `FilterSelect` / dropdowns pour filtrer les SKU. L'édition groupée reprend les filtres
  actifs du tableau (sidebar), pas de second panneau de filtres dans `BulkEditModal`.
- `FilterSelect` (dropdown) est réservé aux **formulaires** (ligne de transport, modale) — **pas** aux
  filtres de liste. Réf. domaine hors produit :
  `suppliers/_components/{SuppliersFiltersSidebar,SuppliersActiveFilterBar,supplier-filters}`.
- **Sélection de produits/SKU** (picker, wizard, panneau embarqué) = **réutiliser `CatalogBrowser`**
  (`variant="embedded"`, `selectedIds`/`onToggleProduct`, `disabledRowIds`, `extraColumns`,
  `initialFilters` pour scoper) — le vrai tableau catalogue avec tous ses filtres. Ne jamais recréer un
  mini-tableau de sélection. Réfs : `simulator/[id]/_components/AddProductsModal`,
  `suppliers/_components/{AddSkusDialog,BatchPriceWizard}`, fiche `/suppliers/[id]` (SKU liés).
  **Sélection en masse** : en-tête de colonne = case à cocher + chevron, **un seul bouton** ;
  chaque clic ouvre un menu (« Toute la page », « Tous les résultats filtrés », désélection).
  `fetchAllCatalogProducts` pour la portée filtrée. Implémenter
  `onTogglePageProducts` + `onToggleFilteredProducts` côté parent.
- **Taille des wizards/modales embarquant `CatalogBrowser` = quasi plein écran** (le catalogue a besoin
  de place) : `AppModal size="full"` (→ `h-[92vh] w-[95vw]`) **ou** `DialogContent` en
  `h-[92vh] w-[95vw] max-w-[95vw]`. Le `CatalogBrowser` doit **remplir** la hauteur (`flex min-h-0 flex-1`),
  pas de hauteur fixe en `px`. Fiche fournisseur : layout `flex h-full` — le bloc SKU liés prend
  l'espace restant sous l'en-tête / paramètres par défaut.

## Tableau de données partagé (`components/data-table/`)

**Source unique** pour le shell UI des grands tableaux (catalogue produits, lignes simulation).
Ne pas dupliquer le markup `<table>` — déclarer uniquement les colonnes métier.

Référence : `components/data-table/DataTable.tsx`, `types.ts`, `useColumnWidths.ts`,
`DataTablePagination.tsx`.

```typescript
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";

const DEFAULT_SORT: DataTableSortState = { field: "sku_code", dir: "asc" };
const [sort, setSort] = useState(DEFAULT_SORT);

const columns: DataTableColumnDef<Product>[] = [
  {
    key: "sku_code",
    label: "SKU",
    sortField: "sku_code",   // champ backend `ordering`
    width: 160,
    render: (row) => row.sku_code,
  },
  // …
];

<DataTable
  columns={columns}
  rows={products}
  rowKey={(p) => p.id}
  storageKey="syskern:catalog-col-widths:v1"   // une clé par écran
  sort={sort}
  defaultSort={DEFAULT_SORT}
  onSort={(field) => setSort((s) => cycleSortField(field, s, DEFAULT_SORT))}
  isLoading={isLoading}
  pagination={{ page, totalPages, totalCount, pageSize, onPageChange, itemLabel: "produit" }}
  renderLeadingHeader={() => <CheckboxHeader />}
  renderLeadingCell={(row) => <CheckboxRow row={row} />}
  onRowClick={(row) => openDrawer(row)}
/>
```

**Comportement unifié (catalogue + simulation)** :
- **Tri cyclique** : asc → desc → tri par défaut (`cycleSortField`).
- **Colonnes redimensionnables** : poignée à droite de chaque en-tête ; largeurs persistées
  dans `localStorage` via `storageKey` (catalogue : `syskern:catalog-col-widths:v1` ;
  simulation : `syskern:simulation-col-widths:v1`).
- **Colonnes réordonnables (DnD, FEEDBACK 1)** : prop `reorderable` (opt-in) → poignée de
  glissement (`DotsSixVertical`, visible au survol) sur chaque en-tête ; `@dnd-kit` horizontal
  (`DataTableHeader.tsx` + `useColumnOrder.ts`). Ordre persisté sous `${storageKey}:col-order` ;
  colonnes nouvelles ajoutées en fin, colonnes retirées ignorées. Activé sur **catalogue**
  (`variant==="page"` uniquement, pas embedded) et **simulation**. Les colonnes
  `renderLeadingHeader`/`renderTrailingCell` (checkbox / kebab) restent fixes (hors `SortableContext`).
- **Pagination** : `DataTablePagination` (numéros de page, ellipses, champ « Aller à »).
- **Styles** : en-tête sticky `bg-slate-100/95`, lignes zebra + hover orange, SKU en
  `font-mono text-orange-600`, skeleton loading intégré.
- **Colonnes optionnelles** : `renderLeadingHeader`/`renderLeadingCell` (checkbox catalogue),
  `renderTrailingCell` (menu kebab simulation), `rowClassName` (surlignage warning/error).

Les consommateurs actuels : `CatalogBrowser` (`catalog/_components/`), `SimulationTable`.
Le catalogue partagé expose `useCatalogColumns` (colonnes) + `CatalogBrowser` (filtres + tableau) +
`CatalogColumnsDialog` (visibilité colonnes) ; réutilisé par `/catalog`, le wizard
(`WizardCatalogPicker`) et `AddProductsModal`.
Les anciens `catalog/_components/useColumnWidths.ts` et `CatalogPagination.tsx` ré-exportent
depuis `components/data-table/` (dépréciés — importer directement le module partagé).

## Drag-and-drop (réordonnancement) — `@dnd-kit`

Réordonnancement de listes/tableaux via `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`
(API stable : `DndContext`/`SortableContext`/`useSortable`/`arrayMove` — **pas** `@dnd-kit/react`).
Référence : `app/settings/attributes/_components/rows.tsx` + `page.tsx`.

- `DndContext` (sensors `PointerSensor` distance 5 + `KeyboardSensor` `sortableKeyboardCoordinates`,
  `collisionDetection={closestCenter}`) → `SortableContext` (`items={ids}`,
  `verticalListSortingStrategy`).
- Ligne sortable : `useSortable({id})`, appliquer `transform`/`transition` via
  `CSS.Transform.toString`. **Drag handle** dédié (`{...attributes} {...listeners}` + `touch-none`).
- `onDragEnd` → `arrayMove` local → **update optimiste** `mutate(KEY, next, {revalidate:false})`
  → appel API persistance → `mutate(KEY)` (revalidate) au succès, **rollback** (`mutate(KEY)`) +
  message FR sur erreur.
- Activer le DnD seulement quand le périmètre est cohérent (ex. une seule catégorie isolée) ;
  sinon rendre des lignes statiques (deux composants distincts pour respecter les règles de hooks).

## Sous-navigation des Paramètres (`SettingsNav`)

`/settings` et `/settings/attributes` partagent `app/settings/_components/SettingsNav.tsx`
(onglets = **liens** Next, état actif via `usePathname` + `useSearchParams`). Les sections de
`/settings` (Marché / Modes transport / **Presets transport** / Odoo / **Alertes offres**) sont
pilotées par le query-param `?tab=` au lieu d'onglets Radix in-page ; **Attributs dynamiques**
reste une route dédiée (`/settings/attributes`). **`useSearchParams` impose une frontière
`<Suspense>`** côté Next 16 (sinon `next build` échoue) — encapsuler le composant qui le lit.

Onglet **Presets transport** (`?tab=transport-presets`) : `TabTransportPresets` — CRUD
`TransportPreset` (nom unique, mode, coût, palettes, lieux ; partagés PA et PV). Aucun preset
pré-installé — création admin ou depuis une simulation (signet).

Onglet **Marché** : CRUD paramètres cuivre/FX via `listMarketParameters` / `createMarketParameter`
/ `updateMarketParameter` / `deleteMarketParameter` ; champ optionnel `source` (LME, BCE, manual).
Pour récupérer le paramètre actif côté simulation : `getCurrentMarketParameter({ parameter_type, … })`
→ `GET /api/market-parameters/current/`.

## Fil d'Ariane contextuel (`BreadcrumbContext`)

Référence : `components/layout/BreadcrumbContext.tsx`, consommé par `AppShell`.
**Navigation produit** : `lib/product-navigation.ts` (`buildProductHref`, `parseProductNavigationContext`, `buildProductBreadcrumbs`).

### Règle stricte (plateforme entière)

Le fil d'Ariane doit **toujours refléter le parcours réel** de l'utilisateur — pas le pathname seul ni une hiérarchie « logique » inventée.

1. **Liens entrants** : toute navigation vers une page « détail » (fiche produit, simulation, offre, etc.) depuis un autre module doit passer un **contexte de navigation** (query `?from=…` + ids/labels métier) ou un override breadcrumb explicite.
2. **Page cible** : lit ce contexte et appelle `useBreadcrumbOverride` avec la chaîne complète (chaque segment intermédiaire cliquable).
3. **Jamais** d'UUID, SKU seul ou clé technique visible dans les libellés.
4. **Helper unique fiche produit** : `buildProductHref(sku, ctx)` depuis listes catalogue embarquées (`CatalogBrowser.productNavigationContext`), simulation (`productEditHref`), etc. ; la fiche lit le même contrat via `parseProductNavigationContext`.

Contextes produit supportés : `catalog` (défaut), `simulation` (`?from=simulation&simulation_id&simulation_label`), `supplier` (`?from=supplier&supplier_id&supplier_name`).

**Navigation simulation** : `lib/simulation-navigation.ts` — depuis une comparaison (`?from=compare&return_href&return_label`) → fil d'Ariane : Tableau de bord · Comparaisons · {comparaison} · {simulation}.

- Crumbs par défaut dérivés du pathname (segments cliquables) — **fallback uniquement** quand aucun contexte n'est fourni.
- Une page peut **surcharger** via `useBreadcrumbOverride(crumbs | null)` (cleanup au démontage).
- Exemples :
  - Simulation → produit : Tableau de bord · Simulations · {label sim} · {produit}
  - Fournisseur → produit : Tableau de bord · Fournisseurs · {nom fournisseur} · {produit}
  - Catalogue → produit : Tableau de bord · Catalogue · {univers?} · {produit}

## Liste simulations (`/simulator`)

Référence : `app/simulator/page.tsx` + `app/simulator/_components/` — même ergonomie que le catalogue.

- **Layout** : panneau filtres gauche (fermable, redimensionnable) · toolbar (recherche, actions) ·
  `DataTable` paginé (50/page).
- **Recherche** : debounce 300 ms → `q` (nom, nom de projet).
- **Filtres sidebar** : type (tarif/projet), statut (brouillon/finalisé/archivé), recalcul nécessaire ;
  filtres favoris en `localStorage` (`syskern:simulation-filters:v1`). Sans filtre statut, toutes
  les simulations sont listées (y compris archivées).
- **Tri** : colonnes nom, type, lignes, statut, dernier calcul, modifié → `ordering` DRF.
- **Sélection** : cases + barre d’actions « Comparer la sélection » (2–4 sims → `/simulator/compare?sims=…`).
- **API** : `getSimulationsList({ q, simulation_type, status, is_dirty, ordering, page, limit })` ;
  `getSimulations()` reste un raccourci (200 premiers résultats, ex. page comparer).

## Wizard création simulation (`/simulator/new`)

Référence : `app/simulator/new/` (CDC §6.9.2). Trois étapes : type/contexte → SKU → paramètres+chaîne.

- **Brouillon** : clé `syskern:new-simulation-draft:v1`, initializer paresseux + effet
  d'écriture seule (cf. pattern `/catalog/new`). L'étape active n'est **pas** persistée.
- **Étape 1** : `TypeStep` — toggle Tarif/Projet, multi-select clients (`getClients`), projet =
  1 client + `project_name` obligatoire.
- **Étape 2** : `SkuStep` — plein écran (`h-[calc(100dvh-3.5rem)]`) ; 2 onglets (catalogue /
  import fichier) ; panneau droit = SKU sélectionnés ; bannière d'erreur repliable pour les SKU
  non trouvés ; confirmation à la création si des SKU importés sont introuvables :
  - `WizardCatalogPicker` : délègue à `CatalogBrowser` (même tableau / colonnes que `/catalog`).
  - `ImportFilePanel` : drag-and-drop `.xlsx`/`.csv`, `lookupBulkProducts` → `notFoundSkus`.
  - `SelectedSkuList` : liste cumulative sticky à droite ; colonne **Qté** (simulations **Projet**
    uniquement, entiers ≥ 1, défaut 1) — pas de coefficient par SKU.
  - *(Retiré)* onglet « filtre de gamme » — couvert par les filtres hiérarchie du catalogue.
- **Entrée catalogue** : `?from=catalog&product_ids=` (cf. `AddToSimulationDialog`) — brouillon
  `localStorage` **non lu** ; seed one-shot `sessionStorage` (`CATALOG_SEED_KEY`) + résolution API
  des SKU manquants ; à la sortie du wizard, seed purgé.
- **Étape 3** : `ParamsStep` délègue à **`SimulationParamsFields`** (disposition canonique — cf. § « Paramètres simulation »). `MarketParamsModal` (sélecteur **LME/SHE** + **devise cuivre** RMB/USD/EUR ;
  `getCurrentMarketParameter` + `listMarketParameters` filtrés par `copper_market` ; pré-remplissage dans la
  devise choisie ; à l'enregistrement `buildMarketParams` convertit en RMB/tonne pour le moteur ;
  FX EUR→RMB/USD),
  **incoterm de vente** (`SaleIncotermFields` + prefill PV semi-auto), mix/marges, `ChainBuilder` PA/PV,
  `ChainBuilder` DnD (`@dnd-kit`) pour chaînes PA/PV (douane = **taux %** `rate_pct`, transports avec
  sélecteur mode FR), mix/marges/position Symea, preset import Chine. **Transport (CDC Feedback 1)** :
  toggle **Modules détaillés** / **Coefficient** par chaîne PA et PV (`transportPricingMode`,
  `transportCoefficient` → `transport_pricing` + leg `COEF` en API) ; alternative globale aux modules
  détaillés, **pas par SKU**. **Presets transport** : bouton « Ajouter un transport » + dropdown
  presets (`GET /api/transport-presets/?is_active=true`, liste vide au départ — création utilisateur) ; montants indicatifs, **modifiables après insertion**. Icône signet sur une ligne
  transport → `SaveTransportPresetModal` (création preset nommé, visible pour tous). Admin :
  `/settings?tab=transport-presets` (`TabTransportPresets` — CRUD). Helpers : `lib/transport-presets.ts`.
- **Soumission** : `createSimulation` + `addSimulationLines` → redirect `/simulator/[id]` (draft).
- **Validation étape 3** : `collectWizardStep3Issues` (cuivre si variation PA, FX requis selon
  chaînes, palettes transports) + bannière `WizardStep3IssuesBanner` dans `ParamsStep`.
  À la création : `collectWizardCreateWarnings` → modale `WizardCreateWarningsDialog` (cartes
  colorées par type : paramètres / SKU / import).
  `validateTransportChains` reste pour l'autosave sidebar (premier problème palettes).
- **Helpers partagés** (`wizard-draft.ts`) : `buildSimulationPatch`, `simulationToEditDraft`, `step1Valid`,
  `buildMarketParams`, `validateTransportChains`, `collectTransportIssues` (valide aussi le coefficient
  transport), `buildCalculationChain` / `parseChainDraft` (modes transport détaillé/coefficient).
- **Dépendance** : `xlsx@0.18.5` (npm registry) pour le parsing Excel côté client.
- **npm** : installer les deps **uniquement** dans `frontend/` (`cd frontend && npm ci`). Jamais à la racine du repo (cf. `decisions.md`).

## Catalogue → simulation (`AddToSimulationDialog`)

Référence : `components/AddToSimulationDialog.tsx` — catalogue liste (`/catalog`) et fiche produit.

- Modale **2 onglets** :
  - **Simulation existante** (brouillon uniquement) → `POST /api/simulations/{id}/lines/` avec `product_ids`.
  - **Nouvelle simulation** → redirect wizard `/simulator/new?from=catalog&product_ids=…`.
- Seed one-shot : `sessionStorage` (`syskern:wizard-catalog-seed:v1`, `writeCatalogSeed` /
  `peekCatalogSeed` / `clearCatalogSeed` dans `wizard-draft.ts`) + résolution API des SKU manquants
  (`resolveSelectedSkusByProductIds`). **Le brouillon wizard `localStorage`** (`DRAFT_KEY`) **n'est
  ni lu ni écrasé** sur l'entrée catalogue — `emptyDraft()` + SKU pré-remplis.
- Détail fiche produit : peut passer `prefilledSkus` pour éviter un fetch inutile.

## Vue principale simulation (`/simulator/[id]`)

Référence : `app/simulator/[id]/page.tsx` + `_components/` (CDC §6.9.3–5). Layout **3 zones** :
sidebar paramètres collapsible (360px) · tableau résultats `flex-1` · drawer historique droit.
Lecture seule si `status !== "draft"` (finalized/archived).

- **`SimulationSidebar`** : header (libellé + statut + Finaliser/Dupliquer/Archiver/Supprimer + bouton
  « contexte » → modale `TypeStep` pour type/clients/`project_name` ; **groupe Réduire / Plein écran**
  → `SimulationParamsSheet` `AppModal size="full"`, même UX que comparaison). **Finaliser** → `FinalizeModal`
  (liste des conséquences + saisie du libellé exact pour confirmer ; affiche la liste des SKU en erreur
  renvoyée par le 400). **Dupliquer** → `DuplicateModal` (libellé pré-rempli `"<label> (copie)"`,
  modifiable) puis redirect vers la copie ; toujours actif (même finalized). Sections Marché
  (`MarketParamsModal` — **sauvegarde immédiate** à la fermeture via `saveMarketParamsNow`, en plus
  de l'autosave 1s ; `onMarketParamsChange` alimente le recalc), **Incoterm de vente**
  (`SaleIncotermFields` + `GET /api/incoterms` ; modale confirmation prefill chaîne PV ;
  bouton « Adapter la chaîne PA depuis les fournisseurs » → skeleton PA depuis incoterm achat
  majoritaire des lignes), Paramètres globaux (mix/marges/position Symea), Chaîne PA + PV
  (`ChainBuilder` — toggle transport détaillé/coefficient identique au wizard). **Autosave `useAutosave(draft, persist, {delay: 1000})`** →
  `updateSimulation(id, buildSimulationPatch(draft))`. ⚠️ **Déviation assumée : 1s** (vs convention
  2s) car exigé par le CDC §6.9.3 ; validation `step1Valid` + `validateTransportChains` **avant** le
  PATCH (jamais de chaîne invalide persistée). Draft réhydraté via `simulationToEditDraft(sim)`,
  monté avec `key={sim.id}`.
- **`SimulationTable`** : bandeau contexte (dernier calcul, cuivre base/actuel, FX, **incoterm vente**,
  snapshot Odoo,
  boutons **Recalculer** (split-button FEEDBACK 2 — clic = `params_only` immédiat ; chevron =
  Odoo / full refresh ; proéminent si `is_dirty`) / **Ajouter des produits** (`AddProductsModal` —
  catalogue filtré, multi-sélection, `POST /api/simulations/{id}/lines/`) / Édition groupée / Exporter Excel / Historique / **Colonnes** ;
  **grille via `DataTable` partagé** (`components/data-table/`, clé largeurs
  `syskern:simulation-col-widths:v1`) avec colonnes métier : SKU, Désignation (`product_designation`),
  Gamme, Stock, PAMP, PAMP prév., **Quantité** (Projet), Mix eff., PA net, PR, Marge eff.,
  **Dernier PV** (`previous_pv_eur`, triable), PV, **Prix total** (Projet, `pv_total_eur`), Statut + menu kebab ;
  **Visibilité colonnes** (style catalogue) : `SimulationColumnsDialog` +
  `simulation-column-storage.ts` (`syskern:simulation-visible-columns:v1`, SKU verrouillé,
  Quantité/Prix total seulement en Projet ; défaut = toutes visibles ; migration depuis
  `syskern:simulation-optional-columns:v1`) ;
  **Colonnes Projet uniquement** (CDC Feedback 1) : **Quantité** (éditable → `quantity`, pilote le mix auto),
  **Prix total** (= PV × quantité) ; cellule **Mix** = `MixCell` : mode **auto** (badge « auto », piloté par la
  quantité) ou **manuel** (slider/override) via le toggle `force_manual_mix`.   **Coefficient transport** (chaîne PA/PV,
  mode « Coefficient » dans `ChainBuilder`) : alternative aux modules détaillés, au niveau simulation ;
  **surcharge par ligne** : `pa_coefficient_override` via édition groupée (filtre gamme/marque…) ou PATCH
  ligne — `NULL` = hérite la chaîne (comportement inchangé).
  **sélection multiple** (cases à gauche, barre d'actions : modifier / réinitialiser surcharges /
  recalculer la sélection / retirer la sélection) ;
  menu ⋮ → **Retirer de la simulation** ; `DELETE /api/simulation-lines/{id}/` et
  `POST /api/simulations/{id}/lines/bulk-delete/` ; édition groupée sur sélection via
  `filter.line_ids` ;
  surlignage jaune (warning) / rouge (error), badge « surchargé », cellules éditables Marge/Mix →
  `updateSimulationLine` au blur (ligne dirty, PV non recalculé). **Filtres lignes** : sidebar gauche
  (repliable/redimensionnable) = **`CatalogSidebar`** + section **Statut calcul** ; `SearchInput` +
  `ActiveFilterBar` + sheet mobile — **même style que le catalogue** (pas de dropdowns). Tri cyclique
  + pagination identiques au catalogue. **Filtres statut calcul** : multi-checkbox OK / Avertissements /
  Erreurs dans la sidebar (défaut = les trois). **Filtres produits** : hiérarchie, marque, fournisseur,
  stock, PAMP, langues, attributs dynamiques — identiques au catalogue (`buildCatalogQuery` → API) ;
  l'édition groupée reprend ce filtre actif (bulk sur tout l'ensemble filtré, pas la page).
  Liste fetchée séparément (clé SWR `["sim-lines", simId, statusIn, ordering, page, productFiltersKey]`).
- **Diagnostics & breakdown ligne** :
  - Colonne **Statut** : liste **toutes** les erreurs (rouge) et, si pas d'erreur, tous les
    avertissements (ambre) — plus de troncature « 1ʳᵉ ligne (+N) ». Clic → `LineDiagnosticsDrawer`
    (n'ouvre pas le breakdown ; `stopPropagation`).
  - **Clic sur une ligne** (hors SKU, statut, surcharges, menu ⋮) → `CalculationBreakdownDrawer`
    directement (`DataTable.onRowClick`).
  - Messages via `lineDiagnostics()` (`sim-format.ts`) qui passe par `humanizeEngineMessage()`
    (`lib/humanize-errors.ts`) — texte FR utilisateur, y compris pour diagnostics legacy anglais
    déjà persistés en base.
  - Toasts / simulateur (`RecalculateButton`, `SimulationTable`, `SimulationSidebar`) :
    `humanizeApiError()` extrait le `detail` DRF ou humanise les erreurs moteur.
  - Colonne Statut : erreurs (rouge) **puis** avertissements (ambre) affichés ensemble.
  - Menu kebab **⋮** → **Détail du calcul** → `CalculationBreakdownDrawer` (**4 onglets** :
    Synthèse — formules PR + **chaîne PV** (ordre d'application + déroulé PR → étapes → PV), snapshot marché,
    incoterms ; Chaîne PA ; **Chaîne PR** ; Chaîne PV). Lit `calculation_breakdown` +
    `formatBreakdownStepDetails` pour narrations FR par module ; titres d'étape via **`stepModuleLabel`**
    (`syskern_margin` / `symea_margin`, rétrocompat `margin` + `metadata.label`). Onglet Chaîne PV : texte
    explicite « marge Syskern en premier sur le PR ». Modes transport résolus via
    `lib/transport-modes.ts` + `listTransportModes`. **Lignes non recalculées** depuis Feedback 1 peuvent
    encore montrer l'ancien ordre/PV — déclencher un recalcul global ou par ligne.
  - Menu kebab visible aussi en **lecture seule** (recalcul / reset désactivés).
- **Liens produit depuis simulation** : **SKU uniquement** → `/catalog/{sku}?edit=1&from=simulation&…`
  via `productEditHref()` (`sim-format.ts`, `stopPropagation` sur le lien). Désignation = texte simple
  (le clic ouvre le breakdown via la ligne). Fil d'Ariane surchargé (`useBreadcrumbOverride`) :
  Accueil · Simulations · {label sim} · {SKU}.
- **`StockPurchaseMixSlider`** (`app/simulator/_components/StockPurchaseMixSlider.tsx`) :
  composant partagé mix stock/achat. **`value` = part stock (PAMP) dans le PR** (0 = 100 % achat à
  gauche, 100 = 100 % stock à droite). Barre bicolore + libellés « Achat (PA) » / « Stock (PAMP) » +
  répartition `X % achat · Y % stock`. Utilisé dans `SimulationParamsFields`, `BulkEditModal`.
- **Paramètres simulation — disposition canonique (règle stricte)** : toute édition des paramètres de
  calcul (marché, mix, marges, incoterm vente, chaînes PA/PV) **réutilise `SimulationParamsFields`**
  (`app/simulator/_components/SimulationParamsFields.tsx`) — même grille que l'étape wizard 3
  « Paramètres et chaîne » : (1) **Marché** (1 col) + **Paramètres globaux** (2 cols) en
  `lg:grid-cols-3` ; (2) **Incoterm de vente** pleine largeur ; (3) **Chaînes PA / PV** côte à côte
  en `lg:grid-cols-2`. Consommateurs : `ParamsStep` (création), `SimulationSidebar` (détail),
  `SimulationParamsSheet` / `CompareSimulationParamsSheet` (plein écran détail + comparaison),
  `CompareSimulationParamsSheet` (comparaison). **Ne pas** recréer une mise en page ad hoc.
  Modales comparaison denses : `ComparisonEditDialog` + `CompareSimulationParamsSheet` → `AppModal`
  `size="full"`.
- **Sidebar simulation redimensionnable** : `useResizableWidth` (280–640 px, défaut 360, clé
  `syskern:simulation-sidebar-width`) + poignée drag sur `SimulationSidebar`. **Sidebar app**
  repliable : `usePersistedBoolean` (`syskern:main-sidebar-collapsed`) + toggle dans `AppShell`.
- **`RecalculateButton`** (FEEDBACK 2) : split-button — clic principal → `params_only` immédiat
  (pas de Dialog) ; menu chevron → `with_odoo_refresh` / `full_refresh` ;
  `recalculateSimulation(id, {scope, market_params})` (`dispatchAndPoll`) ; toast si
  `odoo_refresh_error`. Remplace l'ancien `RecalculateModal`.
- **`BulkEditModal`** : mode sélection (`lineIds`) ou filtre tableau (`initialFilter` = filtres sidebar
  actifs). Aperçu `{count}` débouncé (`bulkEditPreview`). Pas de panneau filtres dans la modale —
  ajuster la sidebar avant d'ouvrir. Mode **Définir** (marge, mix, quantité/mode mix projet) ou reset.
- **`RecalcHistoryDrawer`** : `getRecalculations(id, {limit})` **paginé** (LimitOffset, « Charger plus »
  par tranches de 10) — tag de scope coloré + paramètres figés (cuivre, FX, mix, marges, chaîne,
  snapshot Odoo) + agrégats (PA/PR/PV moyens, **marge moyenne**, PV min/max). 2 actions par entrée :
  **Voir détail** → `RecalcDetailModal` (lecture seule : agrégats + params figés + **breakdown par ligne**
  via `getRecalculation` + `line_snapshots`) ; **Comparer avec actuel** →
  `/simulator/compare?sims=<simId>&recalc=<recalcId>`.
- **Comparaison (`/simulator/compare`)** : page legacy comparaison ad-hoc (sélection rapide via URL `?sims=` / `?recalc=`). **`?saved=<uuid>`** redirige vers `/comparator/<uuid>`. Préférer le module **Comparaisons** (`/comparator`) pour les objets persistés.
- **Comparaisons (`/comparator`)** — objets `SavedComparison` de première classe (comme les simulations) :
  - **Liste** `app/comparator/page.tsx` — `DataTable` paginé (`getComparisonsList`), recherche, tri, **multi-sélection** (checkbox par ligne + tout sélectionner sur la page) et barre d’actions « Supprimer la sélection ».
  - **Wizard** `app/comparator/new/page.tsx` — 3 étapes : (1) nom + note, (2) sélection 2–4 simulations + **aperçu SKU communs** (`SkuOverlapPreview`), (3) aperçu live (`CompareWorkspace`) puis `createSavedComparison` → redirect `/comparator/{id}`. Draft `localStorage` `syskern:new-comparison-draft:v1`. Préremplissage URL `?sims=` / `?recalc=` (depuis liste simulations ou drawer recalc).
  - **Détail** `app/comparator/[id]/` — header (modifier / supprimer) + `CompareWorkspace` (onglets Synthèse / Paramètres / Lignes SKU). **`ComparisonEditDialog`** : nom, note, re-sélection simulations (`updateSavedComparison` incl. colonnes).
  - Nav principale : entrée **Comparaisons** dans `AppShell`. Depuis `/simulator` : multi-select → `/comparator/new?sims=…` ; bouton Comparaisons → liste.
  - Composants partagés : `CompareWorkspace`, `compare-diff.ts`, `CompareOverview`, `CompareContextDiff`, `CompareSkuTable`, **`CompareSimulationParamsSheet`**, **`SimulationParamsFields`** (dossier `simulator/compare/_components/` et `simulator/_components/`).
  - **Édition paramètres depuis la comparaison** : onglet **Paramètres** → bouton **Modifier** par colonne « simulation » (pas les snapshots recalc). Ouvre `CompareSimulationParamsSheet` (`AppModal size="full"`) avec **`SimulationParamsFields`** (disposition canonique — cf. § Paramètres simulation ; **pas** libellé/type/clients). **Enregistrer et recalculer** → `updateSimulation` + `recalculateSimulation` (`params_only`). **Simulation finalisée/archivée** : bannière + confirmation → `duplicateSimulation` (brouillon) puis PATCH + recalc ; la **nouvelle** simulation remplace l'ancienne colonne dans la comparaison (`updateSavedComparison` si objet persisté). **`ComparisonEditDialog`** : même taille `full`. Fil d'Ariane retour comparaison : `lib/simulation-navigation.ts`.
  - **Sensibilité / normalisation paramètres marché (spec client, parcours officiel)** — pas de panneau what-if en UI
    (cf. `decisions.md` 2026-07-15). Pour tester l'impact d'une base cuivre (ou FX) commune sur les écarts affichés
    **sans toucher une simulation finalisée** : onglet Paramètres → **Modifier** → ajuster **Paramètres marché**
    → **Enregistrer et recalculer** (fork automatique si finalisée). Répéter **par colonne** à aligner. Les onglets
    Synthèse et Lignes SKU se rafraîchissent après remplacement d'ID (`CompareWorkspace` / SWR `compare`). Ne pas
    brancher `compareSimulationsWhatIf` sur de nouveaux écrans — API legacy uniquement.
  - **API** : `compareSimulations` (calcul live) ; CRUD comparaisons ; `duplicateSimulation` / `updateSimulation` /
    `recalculateSimulation` pour l'édition depuis compare. `compare/what-if` : conservé backend, **sans UI**.
- Helpers d'affichage partagés dans `_components/sim-format.ts` (`fmtEur`, `fmtPrice`, `decToPct`, `LINE_STATUS`,
  `lineDiagnostics`, `parseLineBreakdown`, `moduleLabel`, **`stepModuleLabel`**, `productEditHref`, `MODULE_LABELS`,
  `formatBreakdownStepDetails`, `PASSTHROUGH_REASONS`, **`prChainSteps`** fallback PR). Erreurs moteur / API :
  `lib/humanize-errors.ts` (`humanizeEngineMessage`, `humanizeApiError`). **Montants EUR = 2 décimales à l'affichage**
  (`displayMoneyOptions` dans `fmtEur` / `fmtPrice` / narrations breakdown) ; autres devises jusqu'à 4.
  Le moteur backend conserve 4 décimales — ne jamais arrondir côté front pour calculer.
- **Libellés modes transport** : `lib/transport-modes.ts` — `localizeLabel`, `transportModeLabel`,
  `transportModeLabelMap` (API `TransportMode.label.fr` + fallback seeds `TRUCK_FULL` → « Camion complet », etc.).
  Utilisé par `ChainBuilder` (select), `CalculationBreakdownDrawer` (breakdown).
- SKU : ajout via **`AddProductsModal`** (catalogue filtré, `POST /lines/`) ; suppression via menu
  ligne ou bulk-delete. L'ancien `SimulationEditModal` est **supprimé** (remplacé par la sidebar autosave).

## Dev Next.js — racine Turbopack

`frontend/next.config.ts` : `turbopack.root` pointe sur `frontend/` pour éviter que Next détecte un
`package-lock.json` parasite à la racine du monorepo et scanne `backend/`, `data/`, etc.

## Variables d'environnement

- Côté **serveur** (BFF/rewrites) : `BACKEND_URL`. Côté **client** : préfixe `NEXT_PUBLIC_*`.
- ⚠️ `NEXT_PUBLIC_*` est **inliné au build** → changer la valeur impose un rebuild
  (un restart ne suffit pas). Ex. `NEXT_PUBLIC_ODOO_BASE_URL` (lien « Voir dans Odoo »).
- Toujours gérer le cas « variable vide » (feature désactivée proprement, pas de crash).
- Documenter toute nouvelle variable dans `frontend/.env.example` + service frontend de
  `docker-compose.yml`.

---

## Identité visuelle (Unikkern brand guidelines)

### Palette officielle

| Token Tailwind | HEX | Usage |
|---|---|---|
| `brand-navy` | `#162F56` | Sidebar, texte principal |
| `brand-navy-dark` | `#0F2444` | Dégradés sidebar app |
| `brand-green` / `primary` | `#649E5F` | CTA primaire, nav active, succès |
| `brand-orange` / `warm` | `#F78F26` | Accent pricing, liens SKU, KPIs cuivre |
| `brand-blue` | `#09B0E6` | Info, états en cours |
| `brand-pink` / `destructive` | `#C92359` | Erreur, actions destructives |

Tokens sémantiques shadcn dans `globals.css` (`:root` + `@theme`). **Ne pas** hardcoder les anciennes
couleurs legacy (`#0F2137`, `#E07200`, `#0f2444`) — utiliser les tokens ci-dessus.

**Tokens surface & données** (en plus de shadcn) :

| Token | Usage |
|---|---|
| `surface-elevated` | Cartes/modales au-dessus du fond (`bg-surface-elevated`) |
| `surface-inset` | Zones en retrait (filtres, champs groupés) |
| `data-positive` / `data-negative` / `data-dirty` | Variations chiffrées (vert / rose / orange) |

### Typographie

- Police UI : **Plus Jakarta Sans** (`next/font/google`, weights 400/500/600/700/800) — variable CSS `--font-sans`.
- Police données : **JetBrains Mono** (`--font-mono`) — SKU, montants, codes ; combiner avec `tabular-nums` sur les KPI.
- Écart assumé aux brand guidelines Unikkern (Nunito) : tracé dans `decisions.md` (2026-06-24).
- Titres page : `font-bold` ; labels/boutons : `font-semibold` ; corps : `font-normal`.
- Données tabulaires : `tabular-nums` ou `font-mono` pour les colonnes prix.

### Icônes

- **Navigation / dashboard / empty states / listes** : `@phosphor-icons/react` via `components/AppIcon.tsx` (poids `duotone` ou `regular`, tailles tokenisées `sm|md|lg|xl`). Pages catalogue liste et offres : Phosphor direct.

### Ombres (tokens CSS)

- `--shadow-soft`, `--shadow-card`, `--shadow-elevated` dans `globals.css` `@theme` — préférer ces tokens aux `shadow-md` ad hoc.

### Logos

- Assets : `public/syskern-logo.png`, `public/unnikkern-logo.png`, `public/favicon.png`.
- Composant : `components/BrandLogo.tsx` (`variant="syskern" | "unnikkern"`).
- Règles : largeur min 150px digital, pas de filtre CSS / recadrage / changement de couleur.

### Composants métier UI

| Composant | Fichier | Rôle |
|---|---|---|
| `BrandLogo` | `components/BrandLogo.tsx` | Logos syskern / Unikkern |
| `PageHeader` | `components/PageHeader.tsx` | Titre page + actions ; variants `default` \| `dense` \| `hero` |
| `AppModal` | `components/AppModal.tsx` | Modale standard (Dialog + tailles sm/md/lg/xl) |
| `EmptyState` | `components/EmptyState.tsx` | États vides |
| `FormField` | `components/FormField.tsx` | Label + erreur sous champ |
| `StatusBadge` | `components/StatusBadge.tsx` | Badges statut sémantiques |
| `KpiCard` | `components/KpiCard.tsx` | Cartes KPI |
| `AppIcon` | `components/AppIcon.tsx` | Icônes Phosphor (taille/poids/couleur) |
| `FilterSection` | `components/FilterSection.tsx` | Section filtre repliable — **fermée par défaut** (cf. playbook filtres) |
| `FilterCheckboxGroup` | `components/FilterCheckboxGroup.tsx` | Liste checkboxes filtre (shadcn) — ordre stable, pas de remontée des cochés |
| `FilterSelect` | `components/FilterSelect.tsx` | Select filtre avec option « Tous » |
| `SearchInput` | `components/SearchInput.tsx` | Recherche avec icône + clear |
| `RangeFilterSlider` | `components/RangeFilterSlider.tsx` | Slider simple ou fourchette (PAMP, stock, attributs) |
| `MixSlider` | `components/MixSlider.tsx` | Slider mix stock/achat (shadcn Slider) |
| `AppModal` | `components/AppModal.tsx` | Wrapper Dialog standard (remplace modals maison) |

`PageHeader` : variants `default` | `dense` | `hero` + slot `meta` (badges statut).

`DataTable` : prop `density="compact"` pour tables pricing ; `selectedRowKeys` pour sélection visuelle.

`StatusBadge` : variants univers câble (`copper`, `optical`, `oem`, …) via `universeBadgeVariant()`.

`StockPurchaseMixSlider` (`simulator/_components/`) = alias rétro-compat vers `MixSlider`.

**Fournisseurs** (`/suppliers`, `/suppliers/[id]`) — module Fournisseurs (Épic FEEDBACK 1). Entrée
**Fournisseurs** dans `NAV_ITEMS` (`AppShell`, icône `Truck`), section breadcrumb `suppliers`. **Tous
les tableaux (liste, SKU liés, historique, sélection wizard) utilisent `DataTable`** (règle : pas de
`<table>` custom) et **tous les filtres suivent le style unique** (`FilterSection` multi-checkbox +
chips `ActiveFilterBar`, cf. section « Filtres de liste »). Liste = shell `aside` (`SuppliersFiltersSidebar`)
+ toolbar `SearchInput` + `SuppliersActiveFilterBar` + `DataTable` + CRUD `AppModal` (`SupplierModal`) +
import PO (`PoImportDialog`) + **wizard prix en batch** (`BatchPriceWizard`). **Toute sélection de SKU
réutilise `CatalogBrowser`** (embedded) : SKU liés de la fiche (`CatalogBrowser` scopé au fournisseur +
`extraColumns` PO/Retirer), ajout de SKU (`AddSkusDialog`, multi-select), sélection du wizard (product_ids).
Historique = side panel `Sheet`. Édition gardée par `canEdit`. API `lib/api.ts` (`listSuppliers`,
`getSupplier`, `createSupplierEntity`, `updateSupplier`, `deleteSupplier`, `getSupplierSkus`,
`addSupplierSku`, `removeSupplierSku`, `bulkLinkSkus`, `startPoImport`, `getSupplierPriceHistory`,
`bulkUpdatePo`). Détail → `suppliers.md`.

**Page d'accueil** (`/`, `app/(home)/page.tsx`) : tableau de bord post-login (plus `/catalog`).

- **Données** : un seul `useSWR("dashboard-summary", getDashboardSummary)` → `GET /api/dashboard/summary` (agrégats catalogue, simulations, offres, comparaisons, bibliothèque, marché, `todo`, `recent`). Admin : `getSyncStatus` séparé dans `DashboardAdminLinks`.
- **Layout** : 2 colonnes (lg) — principale (2/3) : « À traiter » (`DashboardTodoPanel`), « Reprendre » (`DashboardResumeCard` + `localStorage` `syskern:last-visited:v1`, écrit sur détail simulation/comparaison/offre), activité (`DashboardActivityTimeline` unifiée sims/offres/comparaisons) ; latérale (1/3) : KPIs 5 cartes (`DashboardKpiGrid`), marché (`DashboardMarketCard` → `/settings?tab=marche`), raccourcis création (`DashboardQuickActions`), admin (`DashboardAdminLinks` si `isAdmin`).
- **Sous-titre** : nombre d'éléments `todo`, « Tout est à jour », ou message onboarding si vide.
- **Rôles** : `viewer` — pas de CTA création ni raccourcis ; `commercial` — vue complète ; `admin` — + bloc administration.
- **État vide** : `DashboardOnboarding` (catalogue → simulation → offre) quand aucune simulation ni offre.
- **Filtre dashboard → liste** : lien `/simulator?is_dirty=true` (lecture query param au mount sur `simulator/page.tsx`).

**Page de connexion** (`/login`) : fond blanc plein écran, logo Syskern, carte formulaire (email /
mot de passe), logo Unikkern en bas — pas de panneau marketing latéral. Hors `AppShell` ; session
via `AuthProvider` + `proxy.ts` (routes publiques : `/login`, `/api`, assets statiques).

- **Primitives shadcn** (checkbox, dialog…) : Lucide (interne au design system) — ne pas mélanger dans les primitives.
- Migration progressive : shell + dashboard + catalogue/offres listes ; simulateur détail et fiche produit en cours.

**Listes catalogue / offres** (phase 2 refonte UI) : tokens sémantiques (`border-border`, `text-muted-foreground`, `bg-card`), `EmptyState`, `StatusBadge`, `Checkbox` shadcn, `Button` shadcn, `SearchInput` / `FilterSelect`. Catalogue : toolbar + sidebar filtres (`FilterSection` icônes `primary`, pas `warm`), pagination/tri `DataTable` en `primary` (plus d’orange legacy), `ExportButton` / `ProductDrawer` shadcn, CTA verts. **SKU et PAMP** : `text-primary`. **Orange (`warm`)** : graphiques / accents pricing avancés (onglet Commercial) uniquement.

**Filtres / formulaires** : préférer `Checkbox`, `Select`, `Switch`, `Slider` shadcn — pas de `<select>` / `<input type="range">` / checkbox HTML natifs sur les écrans principaux. Fiche produit : `catalog/[sku]/_tabs/Field.tsx` utilise Switch, Select, Input, Textarea shadcn. Wizard simulation : filtres catalogue via `WizardCatalogPicker` / `CatalogSidebar`. **Lignes simulation** : `SimulationLinesFilterSidebar` (= statut calcul + `CatalogSidebar`). Bibliothèque : filtres liste + upload modal → `FilterSelect` / `Input` / `Button` (formulaires uniquement pour `FilterSelect`).

Toasts : `sonner` via `<Toaster />` dans `layout.tsx`. Confirmations : `AlertDialog` shadcn (pas `confirm()`).

### Fils d'Ariane

- Premier crumb : **Tableau de bord** (`href="/"`), pas « Accueil » ni lien catalogue.
- **Règle stricte** : le fil d'Ariane reflète **d'où l'utilisateur est arrivé** (parcours réel), pas seulement l'URL. Voir `lib/product-navigation.ts` + section « Fil d'Ariane » dans `frontend.md`.
- **Jamais** d'UUID, SKU seul ou clé technique dans le fil d'Ariane visible : `buildAutoBreadcrumbs` fournit des libellés génériques ; les pages entité chargent un titre via `useBreadcrumbOverride`.
- Overrides obligatoires : simulation (`sim.label`), offre (`offer.label`), fiche produit (`product.name` + hiérarchie contextuelle), fournisseur (`supplier.name` quand on vient de `/suppliers/[id]`).

### Modales et contenu dense

- **`DialogFooter` / `AlertDialogFooter`** : ne pas surcharger avec marges négatives ; le composant primitif (`components/ui/dialog.tsx`) gère `border-t`, `p-4`, `shrink-0` — compatible `DialogContent` avec `p-0 gap-0`.
- Contenu riche (historique recalcul, breakdown calcul, édition groupée, formulaires admin) : **`AppModal` `size="xl"` ou `2xl`**, ou `DialogContent` avec `max-w-4xl` / `max-w-6xl`, `max-h-[90vh]`, corps scrollable (`overflow-y-auto`).
- Formulaires simples (confirmation, doublon, 1–2 champs) : `md` / `lg` suffisent.
- **Aucune variable interne visible** (`trigger_type`, `simulation_type`, ids, codes attributs bruts) : toujours un libellé français (`recalcTriggerLabel`, maps statut/type, `StatusBadge`).

---

## Styles

```typescript
import { cn } from "@/lib/utils";     // clsx + tailwind-merge — toujours cn() pour les classes conditionnelles

<div className={cn("base-class", condition && "conditional-class", props.className)} />
```

- **Tailwind 4** : config via `postcss.config.mjs`, pas de `tailwind.config.js`. Tokens dans `globals.css`
  (`@theme` + variables CSS shadcn). Consulte Context7 pour la syntaxe Tailwind 4.
- **shadcn/ui** : `npx shadcn@latest add <component>` pour ajouter des composants. Config dans `components.json`.
- CTA primaire : `bg-primary` (vert brand). Accent pricing : `text-warm` / `border-warm`.
- Composants primitifs → shadcn/ui (`components/ui/`). Icônes métier → Phosphor via `AppIcon` (Lucide réservé aux primitives shadcn).
- Skeleton loading → `<Skeleton />` shadcn ou `animate-pulse bg-muted rounded`.

---

## Conventions TypeScript

- Interfaces pour les shapes d'objets, `type` pour les unions/aliases.
- Exporter les interfaces depuis `lib/api.ts` ; les importer avec `import type { ... }`.
- Ne jamais utiliser `any` — préférer `unknown` et narrowing si le type est vraiment inconnu.
- Les champs nullable du backend → `field: string | null`.

---

## Interdits

- ❌ `fetch()` brut dans un composant — toujours `apiFetch` via `lib/api.ts`.
- ❌ `useEffect + setState` pour fetcher — utiliser SWR.
- ❌ Arithmetic sur les `string` Decimal (`pamp_eur`, `pa_net_eur`…) — le moteur de calcul est backend.
- ❌ Implémenter le polling manuellement — utiliser `dispatchAndPoll`.
- ❌ Comparer les rôles inline — utiliser `canEdit` / `isAdmin`.
- ❌ `text-slate-*` / `bg-white` dans les pages — utiliser tokens sémantiques (`foreground`, `muted-foreground`, `bg-card`).
- ❌ Modals maison `fixed inset-0` — utiliser `AppModal`, `Dialog` ou `Sheet` shadcn.

---

## Checklist

- [ ] Nouvel endpoint : interface + fonction dans `lib/api.ts`
- [ ] Data fetching via SWR, cache key en tableau
- [ ] Decimal API fields traités comme `string`, jamais de calcul front
- [ ] Nouveau tableau paginé : réutiliser `components/data-table/DataTable` (pas de `<table>` custom)
- [ ] Filtres de liste : style unique (`FilterSection` + `FilterCheckboxGroup` + chips, cf. § « Filtres de liste »)
- [ ] Filtres lignes simulation → **`CatalogSidebar`** + `ActiveFilterBar` (jamais `FilterSelect` en barre)
- [ ] Tailwind 4 : vérifier syntaxe via Context7 si doute
- [ ] `cn()` pour toutes les classes conditionnelles
- [ ] `canEdit(role)` / `isAdmin(role)` pour les guards de permission
- [ ] `"use client"` si hooks/events, sinon Server Component si possible
- [ ] Édition en place : `useAutosave` (debounce 2s par défaut ; **1s** sur la sidebar simulation, cf. CDC §6.9.3), update optimiste + rollback, validation avant submit
- [ ] Nouvelle var d'env documentée (`.env.example` + `docker-compose.yml`) ; `NEXT_PUBLIC_*` = rebuild
- [ ] Travail PIM (catalogue / fiche produit / attributs) → lire `pim.md`
- [ ] Colonnes catalogue visibles → `CatalogColumnsDialog` + `catalog-column-storage.ts` (v2) ;
      export Excel séparé ; `attr_columns` API dérivé des clés `attr:*`
- [ ] Wizard / édition simulation → `SimulationParamsFields` pour les paramètres (jamais de layout custom) ;
      `validateTransportChains` + `buildSimulationPatch` ; modes transport détaillé/coefficient via `ChainBuilder`
- [ ] Mix stock/achat → `MixSlider` (alias `StockPurchaseMixSlider`)
- [ ] Breakdown calcul → `CalculationBreakdownDrawer` + helpers `sim-format.ts` (pas de calcul prix front)
- [ ] Fil d'Ariane → reflète le parcours utilisateur (`useBreadcrumbOverride` + `lib/product-navigation.ts` pour les fiches produit ; `lib/simulation-navigation.ts` depuis comparaison)
