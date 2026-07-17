# docs/agent/suppliers.md — Domaine Fournisseurs (entité + import batch PO)

> Playbook du domaine **Fournisseurs** (Épic FEEDBACK 1, écart CDC §11.3 assumé — cf. `decisions.md` 2026-07-13).
> Règles transverses → `/AGENTS.md`. Backend → `backend.md` + `drf-resource.md` · frontend → `frontend.md`.
> Référence code : `apps/suppliers/`, `apps/products/` (`ProductSupplier`, `SupplierPriceHistory`),
> `frontend/src/app/suppliers/`.

Le module « Fournisseurs » transforme le fournisseur (avant : champs texte répétés sur `product_suppliers`)
en **entité de première classe** avec CRUD, gestion des SKU liés, import Excel batch des PO et historique
des prix. **Décision fondatrice** : l'entité porte des **valeurs par défaut** ; le lien `ProductSupplier`
reste la **source de vérité pour le pricing**. Détail dans `decisions.md` (2026-07-13).

---

## Modèles

- **`suppliers.Supplier`** (`db_table="suppliers"`, `BaseModel`) — l'entité fournisseur.
  | Champ | Rôle |
  |---|---|
  | `name` | raison sociale (affichée, dénormalisée sur `ProductSupplier.supplier_name`) |
  | `code` | clé courte **unique** (lookup UUID-ou-`code`) |
  | `factory_code_default` | code usine par défaut pré-rempli à la liaison d'un SKU |
  | `currency_default` | devise PO par défaut (`core.Currency`) |
  | `incoterm_default` | incoterm achat par défaut (enum `products.Incoterm`) |
  | `location` | localisation (ville/pays usine) |
  | `notes`, `is_active` | libre ; `is_active=False` = soft-deleted |

- **`products.ProductSupplier`** — le lien produit↔fournisseur (inchangé côté pricing). Ajouts :
  - `supplier` = **FK nullable** `on_delete=PROTECT` → `suppliers.Supplier` (`related_name="product_links"`).
  - `supplier_name` **conservé** (dénormalisé) : compat Odoo sync (`update_or_create` sur le nom), filtres
    catalogue `?supplier=`, exports, `/api/supplier-names`. Maintenu en phase avec la FK à chaque écriture.
  - Contrainte inchangée : **un seul fournisseur actif par produit** (`one_active_supplier_per_product`).

- **`products.SupplierPriceHistory`** (`db_table="supplier_price_history"`, `BaseModel`) — trace des PO.
  FK `product_supplier` (CASCADE), `old_po_base_price`, `new_po_base_price`, `po_currency`,
  `source` (`import`/`manual`/`odoo`). Placé dans `apps/products` pour éviter la circularité de migrations
  `suppliers ↔ products`. Écrit à chaque changement de PO (import batch + édition CRUD d'un lien).

---

## Endpoints (montés sous `/api/`)

| Méthode | Path | Note |
|---|---|---|
| `GET`/`POST` | `/api/suppliers/` | liste (compact + `linked_skus_count`) / création |
| `GET`/`PATCH`/`DELETE` | `/api/suppliers/{id\|code}/` | lookup **UUID ou `code`** ; DELETE = soft-delete, **409** si SKU liés |
| `GET` | `/api/suppliers/{id}/skus/` | liens `ProductSupplier` du fournisseur (avec produit) |
| `POST` | `/api/suppliers/{id}/skus/` | lier un SKU (`{sku}` ou `{product_id}`) → crée un `ProductSupplier` pré-rempli des défauts |
| `POST` | `/api/suppliers/{id}/skus/bulk-link/` | **lier plusieurs SKU** (`{product_ids}`, catalog picker) → `{created, skipped}` |
| `DELETE` | `/api/suppliers/{id}/skus/{ps_id}/` | retirer le lien |
| `POST` | `/api/suppliers/{id}/skus/bulk-po/` | **màj PO en batch** (wizard) : `{link_ids \| product_ids, mode: set\|pct\|abs, value}` → `{updated, skipped}` |
| `GET` | `/api/suppliers/{id}/price-history/` | historique PO des liens du fournisseur |
| `POST` | `/api/suppliers/import-po/` | **multipart** upload `.xlsx` → `202 + task_id` (Celery) |
| `GET` | `/api/suppliers/imports/{task_id}/report/` | download du rapport d'erreurs (lignes rejetées) |

---

## Import batch PO (`suppliers.import_po_task`)

Contrat async standard (AGENTS §4, calqué sur l'export catalogue) : l'endpoint sauve le fichier
(`IMPORT_DIR = /tmp/syskern_imports`) et dispatch la tâche ; le client poll `/api/tasks/{task_id}/`.

- **Colonnes attendues** : `SKU` / `fournisseur` / `PO` (une ligne = un couple SKU-fournisseur + prix).
- **Matching par SKU existant uniquement** — **jamais** de création de produit.
- **Rejet + rapport** : SKU introuvable **ou** fournisseur introuvable → la ligne est rejetée avec sa
  raison (FR), **sans bloquer** le reste. Le rapport listant les rejets est téléchargeable.
- **Création de lien** : SKU + fournisseur existent mais pas encore liés → le lien `ProductSupplier` est
  **créé** (pré-rempli des défauts fournisseur) puis le PO écrit.
- **Historique** : chaque PO écrit produit une entrée `SupplierPriceHistory` (`source="import"`).
- **Progression** : `self.update_state(state="PROGRESS", meta={"current", "total"})` (barre côté front).
- **Résultat** : `{updated, created, rejected, report_url}`.

---

## Frontend (`/suppliers`, `/suppliers/[id]`)

Aligné sur le design system (`frontend.md`) : tokens sémantiques, icônes Phosphor, shadcn/ui, toasts
`sonner`. Édition gardée par `canEdit(role)` (admin/commercial) ; viewer = lecture seule.

- **Tout tableau = `components/data-table/DataTable`** (règle `frontend.md` : jamais de `<table>` custom).
  Liste, SKU liés d'une fiche, historique, sélection du wizard → tous via `DataTable`.
- **Filtres = style unique de la plateforme** (cf. `frontend.md` § « Filtres de liste »). La **liste**
  `/suppliers` a sa propre sidebar (`SuppliersFiltersSidebar` + chips `SuppliersActiveFilterBar`,
  module `supplier-filters.ts`). **Toute sélection de SKU réutilise directement `CatalogBrowser`**
  (le vrai tableau catalogue, avec tous ses filtres) — jamais un tableau ad-hoc.
- **`/suppliers`** : shell `aside` **`SuppliersFiltersSidebar`** (Devise / Incoterm / Statut / SKU liés,
  multi-checkbox, repliable `usePersistedBoolean`) + toolbar `SearchInput` + **`SuppliersActiveFilterBar`**
  (chips) + `DataTable` (nom, code, devise, incoterm, localisation, nb SKU, actif) + création/édition
  (`AppModal`), suppression (409 → toast FR). Boutons **« Prix en batch »** (wizard), **« Importer des
  PO »**, **« Nouveau fournisseur »**.
- **`/suppliers/[id]`** : paramètres par défaut + section **« SKU liés » = `CatalogBrowser`** (`variant
  "embedded"`) **scopé au fournisseur** (`initialFilters={{ supplier: [name] }}`) → tous les filtres
  catalogue + colonnes `extraColumns` **PO base** (via une map `product_id → lien`) et **Retirer**.
  Clic SKU → fiche produit avec `productNavigationContext` fournisseur (`buildProductHref`) pour fil
  d'Ariane : Tableau de bord · Fournisseurs · {nom} · {produit}. Bouton **« Lier des SKU »** → `AddSkusDialog`. **Historique des prix = bouton → side panel `Sheet`**
  (`DataTable`). Boutons « Modifier les prix » (wizard) et « Modifier ».
- **Ajout de SKU** (`_components/AddSkusDialog.tsx`) : modale `CatalogBrowser` (multi-select, produits
  déjà liés désactivés) → `bulkLinkSkus`.
- **Wizard prix en batch** (`_components/BatchPriceWizard.tsx`) : 4 étapes — (1) choisir le fournisseur
  [ignorée si pré-rempli], (2) **sélection via `CatalogBrowser`** scopé au fournisseur (product_ids),
  (3) mode `set`/`pct`/`abs` + valeur (signée pour pct/abs), (4) récap → `bulkUpdatePo({product_ids})`.
  Lancé **globalement** depuis `/suppliers` ou **pré-rempli** depuis une fiche.
- **Règle** : toute vue de sélection/affichage de SKU = **`CatalogBrowser`** (embedded), jamais un
  `DataTable` ad-hoc ni des filtres maison — cohérence totale avec le catalogue.
- **API client** (`lib/api.ts`) : `listSuppliers`, `getSupplier`, `createSupplierEntity`, `updateSupplier`,
  `deleteSupplier`, `getSupplierSkus`, `addSupplierSku`, `removeSupplierSku`, `startPoImport`,
  `getSupplierPriceHistory`, `bulkUpdatePo`. ⚠️ Ne pas confondre avec les fonctions **product-scoped**
  existantes (`createSupplier`, `updateProductSupplier`, `deleteProductSupplier`, `activateProductSupplier`).

---

## Odoo sync

`apps/odoo_sync/services/runner.py::_sync_suppliers` `get_or_create` désormais le `Supplier`
(par `name`) et pose `ProductSupplier.supplier`, en plus de `supplier_name`. Garde l'entité cohérente
quand un fournisseur apparaît d'abord via Odoo.

---

## Checklist Fournisseurs

- [ ] Entité = **défauts** ; le lien `ProductSupplier` reste la vérité pricing (ne pas déplacer les champs)
- [ ] `supplier_name` **conservé** et maintenu en phase avec la FK à chaque écriture
- [ ] Suppression = soft-delete, **409** si SKU liés (jamais de hard-delete)
- [ ] Filtres = style unique plateforme (`FilterSection` + `FilterCheckboxGroup` + chips), jamais de dropdown
- [ ] Import = Celery async (`202 + task_id`), matching SKU existant only, rejet + rapport, create-link
- [ ] Chaque PO écrit (import + CRUD) alimente `SupplierPriceHistory`
- [ ] Migrations générées + committées ; `ruff`/`mypy`/`pytest` verts
- [ ] Frontend : tokens sémantiques, `canEdit`, toasts FR ; `lint`/`tsc`/`build` verts
- [ ] Clic SKU catalogue embarqué → `productNavigationContext` fournisseur (`buildProductHref`) pour fil d'Ariane contextuel
