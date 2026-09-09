# docs/agent/odoo-sync.md — Couverture réelle de la synchro Odoo

> Inventaire **code = vérité**. Pattern factory / ABC → `odoo-adapter.md`.
> Mapping champs humain → `docs/odoo-mapping.md`. Ops → `docs/runbooks/odoo-sync-troubleshooting.md`.
> Référence : `apps/odoo_sync/` (`services/runner.py`, `services/push.py`, `tasks.py`, `models.py`).

**Périmètre « synchro complète » (MVP2) : non défini.** Ce fichier décrit uniquement
ce qui est branché aujourd’hui. Ne pas y lire un backlog ni un delta à chiffrer.

---

## 1. Trois familles de flux (ne pas les confondre)

| Famille | Point d’entrée | Persiste en BDD plateforme ? |
|---|---|---|
| **Pull bulk** | `odoo_sync.services.runner.sync()` via `odoo_sync.sync_task` | Oui (`Product`, `ProductSupplier`, `Supplier`, `Client`, `SyncLog`) |
| **Push produit** | `odoo_sync.services.push.push_product_async` → `odoo_sync.push_product_task` | Oui (ids Odoo + `odoo_sync_status` sur `Product`) |
| **Refresh pricing** | `simulations.services.odoo_refresh.refresh_odoo_for_simulation` + `products.refresh_pamp_task` | Stock (et PAMP seulement si le DTO stock le porte — §6) ; **achats engagés = éphémères** (PAMP prévisionnel, pas de table PO) |

Transport : JSON-RPC `/jsonrpc` + `execute_kw`, v16 et v19 (même protocole — écart CDC §5.2 JSON-2, tracé ailleurs). Une instance par déploiement (`ODOO_API_VERSION`) ; surcharge `api_version` uniquement sur le trigger manuel.

---

## 2. Matrice objets — ce qui est réellement synchronisé

Légende sens : **←** Odoo → plateforme (pull) · **→** plateforme → Odoo (push) · **—** lu par l’adapter, **pas** persisté / **pas** consommé.

| Objet métier | Modèle Odoo | Cible plateforme | Sens | Persisté ? | Quand |
|---|---|---|---|---|---|
| Fiche article | `product.template` | `products.Product` | **←** pull, **→** push partiel | Oui | Pull : cron + manuel + migration. Push : CRUD produit / soft-delete / quarantaine « create » |
| Conditionnement | `product.packaging` (PRIMARY / SECONDARY / TERTIARY / LOGISTIC) | qtés bag/carton/palette sur `Product` | **←** | Oui | Inclus dans le pull **produits** (pas un scope à part) |
| Liens d’achat | `product.supplierinfo` | `ProductSupplier` + `suppliers.Supplier` (get_or_create par nom) | **←** | Oui | Inclus dans le pull **produits**. **Aucun push** `supplierinfo` |
| Stock interne | `stock.quant` (`location_id.usage = internal`) | `Product.stock_quantity` | **←** | Oui | Cron `all`, scope `stock`, recalc `with_odoo_refresh` / `full_refresh`, `POST …/refresh-pamp/` |
| PAMP | `product.template.standard_price` | `Product.pamp_eur` | **←** (jamais →) | Oui | Uniquement le **pull produits** (le DTO `OdooStock` ne renseigne pas `standard_price_eur` — §6) |
| Clients | `res.partner` `customer_rank > 0` | `clients.Client` | **←** | Oui | Cron `all`, scope `clients`. **Aucun push** (prospects locaux restent locaux) |
| Achats engagés | `purchase.order.line` (`state ∈ purchase,done`, qty non reçue) | — | **—** | **Non** | Recalc simulation uniquement (`get_pending_purchases` → `compute_predictive_pamp`) |
| Ventes engagées | `sale.order.line` (`state ∈ sale,done`, qty non livrée) | — | **—** | Non | Méthode adapter **implémentée, aucun appelant** hors tests adapters |
| Fournisseurs (annuaire `res.partner`) | — | — | — | — | **Pas** de `list_suppliers` dans l’ABC (CDC §5.1). L’entité `Supplier` naît des **noms** `partner_id` de `supplierinfo` |

**Hors synchro (constaté dans le code, pas une liste MVP2)** : commandes d’achat/vente comme documents, bons de livraison, factures, listes de prix (`product.pricelist` / PV), attributs EAV, cuivre (`is_copper_indexed`, poids), traductions EN/ES, `res.partner` `supplier_rank`, incoterm sur le lien fournisseur (`OdooSupplierLink.incoterm` toujours `""`), `min_qty` supplierinfo (lu puis droppé), `list_price`, `x_studio_to_deliver`, `available_quantity` (calculé, jamais écrit sur `Product`).

---

## 3. Scopes `SyncScope` — enum vs runner

`SyncScope` (`apps/odoo_sync/models.py`) et `POST /api/odoo/sync/trigger` acceptent six valeurs.
**Le runner n’en implémente que trois + `all`.**

| Scope | `sync()` fait | UI `/settings?tab=odoo` |
|---|---|---|
| `all` | produits (+ supplierinfo + `activate_priced_suppliers`) **puis** stock **puis** clients | « Tout (catalogue + stock + clients) » |
| `products` | produits + supplierinfo + `activate_priced_suppliers` | oui |
| `stock` | `stock_quantity` des produits liés à **cette** version (`odoo_v16_id` / `odoo_v19_id`) | « Stock + PAMP » — libellé trompeur, voir §6 |
| `clients` | `res.partner` clients | oui |
| `suppliers` | **no-op** (auth + `SyncLog` success vide) | **non proposé** |
| `purchases_sales` | **no-op** | **non proposé** |

Le client TS `triggerOdooSync` type encore `suppliers` | `purchases_sales` ; l’UI ne les envoie pas.

---

## 4. Fréquence et déclencheurs

| Job / action | Fréquence | Tâche | Payload |
|---|---|---|---|
| Sync « complète » MVP1 | **03:00 UTC**, tous les jours | `PeriodicTask` « Daily Odoo full sync (03:00 UTC) » → `odoo_sync.sync_task` | `scope=all`, `sync_type=auto_daily`, `triggered_by=celery-beat`. **Pas d’`api_version`** → instance du déploiement |
| Retry push produits | **toutes les heures** | `odoo_sync.retry_failed_product_pushes` | 500 SKU max, `odoo_sync_status ∈ pending_odoo_sync, sync_failed`, `is_active=True`, instance `ODOO_API_VERSION` |
| Manuel UI / API | à la demande | `POST /api/odoo/sync/trigger` → 202 + poll `/api/tasks/{id}/` | `sync_type=manual`. Scope au choix (table §3) |
| Push on-demand | à chaque create / update / soft-delete `ProductViewSet` + résolution quarantaine « create » | `push_product_task` (autoretry ×3) | Sous-ensemble de champs, **une** instance |
| Migration initiale | one-shot | `data_migration.steps.step_odoo_sync` | `scope=ALL`, `triggered_by=migration` |
| Bootstrap catalogue | deploy / commande | `bootstrap_catalog._sync_odoo_first` | **Seulement si** `ODOO_SYNC_ENABLED=true` ; `scope=PRODUCTS` ; **efface** les `SyncLog` PRODUCTS/ALL pour forcer un pull total |
| Recalc simulation | à la demande (`with_odoo_refresh` / `full_refresh`) | dans `recalculate_task` | Stock + achats engagés des SKU de la simu ; échec Odoo = mode dégradé, recalc continue |

`ODOO_SYNC_HOUR_UTC` (CDC §5.8) **n’existe pas** dans `settings` : l’heure est figée par la migration Beat `0002`.

### Killswitch `ODOO_SYNC_ENABLED`

Lu dans `settings.ODOO["SYNC_ENABLED"]`. **Utilisé uniquement** par `bootstrap_catalog`.
**Ni** `sync_task`, **ni** Beat, **ni** le trigger manuel ne le consultent.
Couper le cron = `PeriodicTask.enabled=False` en admin Django (django-celery-beat), pas cette env var.

---

## 5. Delta pull (produits / clients)

Watermark : `completed_at` du dernier `SyncLog` **SUCCESS** (pas `partial_failure`) de **la même** `odoo_api_version`, scope ∈ `{scope demandé, all}`.

- **Produits et clients** : `write_date >= watermark` si watermark présent, sinon catalogue entier. Pagination 200.
- **Stock** : **toujours** le plein des produits déjà liés à cette version (pas de `write_date`).
- `list_products` filtre `active=True` → un article **désactivé dans Odoo n’est pas** re-tiré pour poser `is_active=False` en plateforme.
- SKU : seuls les `sku_code` `^[A-Z0-9\-]+$` sont upsertés ; les autres sont skippés (frais de port, etc.).
- Matching produits : **`sku_code`**. Les ids `odoo_v16_id` / `odoo_v19_id` sont posés **sans** écraser l’autre version ; `odoo_id` (legacy) = id de **cette** synchro.
- Conflit CDC §5.6 : last-write-wins, **Odoo gagne** au pull. Le runner force `odoo_sync_status=synced` → un push pending local est **annulé** par le pull (pas de re-push des edits plateforme au cron suivant — écart au CDC §5.6 « push lors du sync suivant »).
- Descriptions : le pull **écrase** `description_marketing` / `description_technical` par `{"fr": …}` uniquement (EN/ES PIM perdues si un pull survient).
- Enrichissement additif si Odoo a une valeur : `brand`, `dop_number`, `item_code`, `uom`/`base_unit`, packaging.
- Après pull produits : `activate_priced_suppliers()` (ré-active une source **avec prix**, pour que le moteur reste pricable).
- Fournisseurs : **tous** les `supplierinfo` du template ; le **premier** devient actif (puis éventuellement corrigé par `activate_priced_suppliers`). Liens disparus d’Odoo : **non** supprimés. Devise hors EUR/USD/RMB → EUR. `SupplierPriceHistory` **n’est pas** alimenté par ce pull (`PriceChangeSource.ODOO` existe, aucun writer).
- Clients : `is_prospect=False`. Langue = préfixe `fr_FR` → `fr|en|es`, sinon `fr`. Champs commerciaux plateforme (`preferred_currency`, `preferred_incoterm`, `segment`, `notes`) **non** mappés.

---

## 6. Stock, PAMP, achats engagés

`get_stock_quantities` agrège `stock.quant` interne → `OdooStock.quantity` et `available_quantity`.
Le runner / refresh / `refresh_pamp_task` écrivent **`stock_quantity = quantity`** (pas `available_quantity`).

`OdooStock.standard_price_eur` n’est **jamais** rempli par les adapters v16/v19.
Donc :

- scope `stock` **seul** : met à jour le stock, **pas** le PAMP ;
- `refresh_pamp_task` (`POST /api/products/{id}/refresh-pamp/`) : idem (stock ; PAMP inchangé en pratique) ;
- PAMP courant : `standard_price` lu sur **`product.template`** pendant le pull **produits** ;
- PAMP prévisionnel : `get_pending_purchases` au recalc, lignes converties EUR via FX figé de la simulation ; **pas** d’écriture `purchase.order`.

`get_pending_sales` : pas d’impact PAMP (CDC §6.7.1, `decisions.md` 2026-06-23). Pas d’endpoints CDC §5.7 `…/pending-purchases|pending-sales` (superseded par le batch recalc).

---

## 7. Push produit (plateforme → Odoo)

Déclenché par `ProductViewSet.perform_create|update|destroy` et quarantaine « create ».
DTO construit dans `tasks._product_to_odoo_dto` — **sous-ensemble** :

| Envoyé (si présent) | Champ Odoo |
|---|---|
| `sku_code`, `name`, `is_active` | `default_code`, `name`, `active` |
| `gtin` | v16 `barcode` · v19 `gtin_code` + `barcode` |
| descriptions FR | `description_sale` / `description` |
| `unit_weight_kg` | `weight` |
| type stockable | v16 `type=product` · v19 `type=consu` + `is_storable=True` |

`payload_from_product` **saurait** pousser `item_code` / `hs_code` s’ils sont sur le DTO ;
`_product_to_odoo_dto` **ne les copie pas** → **non poussés** en l’état.

**Jamais poussés** : `standard_price` (PAMP), catégorie / hiérarchie, brand, packaging, `seller_ids`, attributs EAV, cuivre, EN/ES.

Create vs update : id versionné `odoo_v16_id` / `odoo_v19_id` déjà posé → `write`, sinon `create` + stockage de l’id **de cette version seulement**.

---

## 8. API / UI / traces

| Endpoint | Rôle |
|---|---|
| `POST /api/odoo/sync/trigger` | Dispatch Celery (CDC §5.4.2) |
| `GET /api/odoo/sync/status` | Dernier log + running |
| `GET /api/odoo/sync/logs` | Historique `SyncLog` |
| `GET /api/odoo/health` | `adapter.health_check()` **dans le thread requête** (auth JSON-RPC) |

UI : `/settings?tab=odoo` — santé 30 s, trigger 4 scopes, historique.

`SyncLog` : created/updated/failed + `errors` JSONB. Un item en échec n’abort pas le bulk (`partial_failure` si `items_failed > 0`).

---

## 9. Méthodes adapter vs consommation

| Méthode ABC | Branchée dans un flux produit ? |
|---|---|
| `list_products` / `create_product` / `update_product` | Oui (pull / push) |
| `get_stock_quantities` | Oui (pull stock, recalc, refresh-pamp) |
| `list_clients` | Oui (pull clients) |
| `get_pending_purchases` | Oui (recalc seulement) |
| `get_product` / `get_client` | Adapters + tests / scripts, **pas** le runner |
| `get_pending_sales` | Implémentée, **aucun** appelant métier |
| `list_suppliers` (CDC) | **Absente** de `OdooAdapter` |

---

## 10. « Synchro complète » — ne pas inventer le delta

Ticket Uplify Core (ODOO), décision Yassine **07/09/2026** : **non chiffré**. Aucune référence Boldys.

Le CDC MVP1 §5.4.1 liste déjà produits + stock/PAMP + clients + *« achats/ventes engagés »* (ce dernier n’est **pas** un scope runner). Les objets souvent cités pour un « complet » (stock, commandes, fournisseurs) sont **déjà partiellement** couverts, chacun dans un sens et une fréquence précis (§2).

**Chiffrage** : seulement après définition client des objets, du sens, de la fréquence et du modèle de conflit. Ce playbook est l’état des lieux ; il n’est pas une spec MVP2.
