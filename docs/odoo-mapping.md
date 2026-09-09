# Mapping Odoo ↔ plateforme (spike ODO-1 / CDC §5)

Document **humain** : champs synchronisés, conventions Syskern, volumétrie.
Source de vérité runtime : adapters + schemas.

| Artefact | Chemin |
|---|---|
| DTO canoniques | `backend/apps/odoo_sync/schemas.py` |
| Adapter v16 | `backend/apps/odoo_sync/adapters/v16.py` |
| Adapter v19 | `backend/apps/odoo_sync/adapters/v19.py` |
| Runner upsert | `backend/apps/odoo_sync/services/runner.py` |
| Inventaire couverture | [`agent/odoo-sync.md`](agent/odoo-sync.md) |
| Rapport d’investigation | `backend/docs/odoo_investigation_report.md` |
| Volumétrie brute | `backend/docs/odoo-mapping.md` |

Factory (obligatoire) : `get_odoo_adapter()` /
`get_odoo_adapter_for("v16"|"v19")` — aucun code hors `odoo_sync` ne connaît
la version.

---

## 1. Périmètre synchronisé

Source de vérité (objets, sens, fréquence, scopes no-op) : [`agent/odoo-sync.md`](agent/odoo-sync.md).
Ne pas déduire le périmètre des valeurs de l'enum `SyncScope`.

| Modèle Odoo | Cible plateforme | Scope runner |
|---|---|---|
| `product.template` (+ packaging, supplierinfo) | `Product`, `ProductSupplier`, `Supplier` | `products` / `all` |
| `stock.quant` | `Product.stock_quantity` | `stock` / `all` (PAMP **non** rafraîchi ici) |
| `res.partner` (`customer_rank > 0`) | `Client` | `clients` / `all` |
| `product.supplierinfo` | liens + entité `Supplier` | **inclus dans** `products` — scope `suppliers` = no-op |
| `purchase.order.line` (qty non reçue) | PAMP prévisionnel **éphémère** | recalc simulation — scope `purchases_sales` = **no-op** |
| Push `product.template` | create/update depuis plateforme | on-demand + retry horaire (pas le cron pull) |

**Hors sync push** (CDC + code) : attributs EAV dynamiques, PV calculés → listes de
prix Odoo, `standard_price`, catégorie, brand, packaging, `seller_ids`.

---

## 2. Produit — `product.template` → `Product`

Convention runtime (code actuel) :

| Champ plateforme | Champ Odoo | Notes |
|---|---|---|
| `odoo_v16_id` / `odoo_v19_id` | `id` | selon adapter |
| `sku_code` | `default_code` **ou fallback `name`** | Chez Syskern `default_code` est souvent vide → SKU dans `name` |
| `name` (commercial) | `name` | |
| `item_code` | `item_code` | natif instance client (~8 car.) |
| `universe` / `family` / `range` / `sub_range` | `categ_id` / `parent_path` | parsé ; fallback split `" / "` sur `name` catégorie |
| `description_marketing` (FR) | `description_sale` | JSONB multilingue côté plateforme |
| `description_technical` (FR) | `description` / `description_purchase` | |
| `gtin` | `barcode` (v16) / `gtin_code` (v19) | |
| `hs_code` | `hs_code` | natif |
| `brand` | `brand_id` | surtout v19 |
| `dop_number` | `x_studio_num_dop_china` / `x_studio_num_dop_trkiye` | Studio |
| UoM → `base_unit` | `uom_id` label | mapping dans le runner |
| packaging PRIMARY…LOGISTIC | `product.packaging` | qtés bag/carton/… |
| `unit_weight_kg` | `weight` | |
| `pamp_eur` | `standard_price` | |
| `is_active` | `active` | soft-delete plateforme si inactif |

**Dérivés côté plateforme** (pas stockés Odoo) : `parent_reference`,
`factory_code` (regex sur le SKU).

**Cuivre** (`is_copper_indexed`, poids cuivre) : souvent **hors Odoo** —
enrichissement Excel / attributs plateforme (cf. investigation §2).

### Push plateforme → Odoo

| Payload | Notes |
|---|---|
| `default_code` = `sku_code`, `name` = commercial | |
| descriptions, weight, gtin/barcode | |
| v16 : `type=product` · v19 : `type=consu` + `is_storable` | divergence versions |

---

## 3. Fournisseurs — `product.supplierinfo` → `ProductSupplier`

| Plateforme | Odoo |
|---|---|
| produit lié | `product_tmpl_id` |
| nom fournisseur | `partner_id.name` |
| `factory_code` | `product_code` |
| `po_base_price` | `price` |
| `po_currency` | `currency_id` |
| actif | `date_end` null ou future |

Les prix staging ont parfois déjà été saisis en EUR dans Odoo — le moteur
attend idéalement devise d’origine (RMB) pour cuivre+FX ; arbitrage métier
historique dans le rapport d’investigation.

---

## 4. Clients — `res.partner` → `Client`

Champs DTO : `name`, `email`, `phone`, adresse, `preferred_language`,
`is_customer`, ids Odoo versionnés. Prospects locaux = hors Odoo
(`migration_source` / flag local).

---

## 5. Stock & PAMP

`stock.quant` → `Product.stock_quantity` (agrégat `quantity` des emplacements internes ;
`available_quantity` n'est pas persisté). Le DTO stock **ne porte pas** `standard_price` :
le PAMP courant vient de `product.template.standard_price` au **pull produits**, pas du
scope `stock`.

Lignes PO ouvertes (`get_pending_purchases`) alimentent le PAMP prévisionnel **au recalc**
simulation — elles ne sont pas persistées et le scope `purchases_sales` ne les tire pas.

---

## 6. Filtre SKU à connaître

Le runner ignore les templates dont le code ne matche pas
`^[A-Z0-9\-]+$` (lignes de service type *Air Shipment Fee*). **Effet de bord** :
quelques vrais SKU avec `,` `.` `/` ou minuscules sont aussi skippés — vérifier
les logs `Skipping non-SKU product` après sync majeure.

Matching upsert : **`sku_code`** (pas l’id Odoo seul) → stable cross-instance
après rebind.

---

## 7. Volumétrie (mesure 2026-06-17, v16 staging ~800 SKU)

| Opération | Ordre de grandeur |
|---|---|
| Pull `product.template` limit=500 | ~0.4 s total |
| Pull complet produits+stock+clients | &lt; 2.5 s |
| Reco batch | `limit≈500`, timeout HTTP `ODOO_TIMEOUT_SECONDS=60` |

Sizing VPS 4 vCPU / 8 Go : confortable tant que workers Celery non saturés.
Détail pages/latences → `backend/docs/odoo-mapping.md`.

---

## 8. Schedule & ops

| Job | Quand |
|---|---|
| Pull `scope=all` | 03:00 UTC (Beat `odoo_sync.sync_task`) |
| Retry pushes produits échoués | horaire (`retry_failed_product_pushes`) |
| `ODOO_SYNC_ENABLED` | **uniquement** `bootstrap_catalog` — **pas** un killswitch Beat |

Couper le cron = `PeriodicTask.enabled=False` (django-celery-beat). Détail → `agent/odoo-sync.md` §4.

Troubleshooting → [`runbooks/odoo-sync-troubleshooting.md`](runbooks/odoo-sync-troubleshooting.md).
Changement d’ERP → [`runbooks/bascule-odoo-prod.md`](runbooks/bascule-odoo-prod.md).
