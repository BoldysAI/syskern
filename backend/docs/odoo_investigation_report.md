# Odoo investigation report — v16 staging Syskern

> **Date** : 14/05/2026
> **Source** : exécution `manage.py odoo_explore` sur l'instance v16 staging fournie par Ghang Hui le 27/04/2026.
> **Scripts utilisés** : `backend/scripts/inspect_*.py` et `backend/scripts/volumetry_v16.py`.
> **Statut** : livrable du CDC §5.10 — base pour câbler `OdooAdapterV16` et `OdooAdapterV19`.

---

## 0. Résumé exécutif

| Question CDC §5.10 | Réponse |
|---|---|
| Champs `product.template` standards utilisés ? | 153 champs natifs disponibles, mapping ci-dessous |
| Champs custom (`x_*`) ? | **3 champs Odoo Studio** : `x_studio_num_dop_china`, `x_studio_num_dop_trkiye`, `x_studio_to_deliver` |
| Format hiérarchie produit ? | `product.category` Odoo récursif via `parent_id` + `parent_path`. Cohabitation avec un héritage "ALL / X / Y" en `name` |
| HS Code, code usine ? | HS Code = **champ Odoo natif** `hs_code` (text). Code usine = **non stocké**, à extraire du SKU côté plateforme |
| Webhooks Odoo SH ? | Non testable depuis API publique — **à demander à Ghang Hui** |
| Volumétrie sur ~2000 SKU ? | **~800 rows/seconde** mesuré. Pull complet de 2000 SKU ≈ 2-3 s |

**Statut instances** :
- ✅ **v16 staging** : accessible, données Syskern réelles (`uid=12`, 800 SKU)
- ❌ **v19 demo** : déprovisionnée par Odoo SH (redirige vers `odoo.com/typo`). **À redemander à Ghang Hui** pour valider l'API JSON-2 v19.

---

## 1. Volumétrie observée (v16 staging)

| Modèle | Comptage | Notes |
|---|---:|---|
| `product.template` | 800 | dont 789 storable, 10 service |
| `product.product` | 800 | mapping 1:1 avec templates ici (pas de variants) |
| `product.supplierinfo` | 677 | en moyenne ~1 fournisseur par SKU |
| `product.category` | 131 | mélange ancienne convention (path en `name`) et récursive |
| `stock.quant` | 749 | snapshots de stock |
| `res.partner` | 52 | 15 clients, 3 fournisseurs, 1 mixte, 33 contacts/employés |
| `purchase.order` | 141 | états distribués (à valider) |
| `purchase.order.line` | 897 | source pour le PAMP prévisionnel |
| `sale.order` | 222 | |
| `sale.order.line` | 861 | |

**Lecture API** : `search_read` retourne **~800 rows/seconde** avec 19 champs lus en parallèle. À 3 000+ SKU production, prévoir un pull complet en **3-5 secondes**. Recommandation : `limit=500` par batch pour limiter la taille du JSON retourné (~500 KB par batch).

> ⚠️ Ce staging contient un sous-ensemble. Le cible CDC est 3 000+ SKU. Recalibrer la batching strategy quand on aura accès au volume réel.

---

## 2. Mapping `product.template` → `apps.products.Product`

| Champ plateforme | Champ Odoo | Type Odoo | Notes |
|---|---|---|---|
| `odoo_id` | `id` | int | identifiant Odoo |
| `sku_code` | **`name`** | char | ⚠️ chez Syskern le SKU est dans `name`, **pas dans `default_code`** qui est toujours `False` |
| `item_code` | `default_code` | char | inutilisé chez Syskern (toujours `False`) — à remplir si Syskern décide plus tard |
| `parent_reference` | dérivé du `sku_code` côté plateforme | — | extraction par regex (suffixe `-NN` retiré) |
| `factory_code` | dérivé du `sku_code` côté plateforme | — | extraction par regex (suffixe `-NN` ou `-ENN`) |
| `name` (désignation commerciale) | `description_sale` (FR) ou `name` à défaut | text | actuellement vide sur staging — à confirmer en prod |
| `universe` / `family` / `range` / `sub_range` | `categ_id.parent_path` parsé | many2one | voir §3 ci-dessous |
| `brand` | **inconnu** | — | à clarifier avec Olivier (champ custom à créer ? attribut dynamique côté plateforme ?) |
| `description_marketing.fr` | `description_sale` | text | |
| `description_technical.fr` | `description_purchase` ou `description` | text | |
| `hs_code` | **`hs_code`** | char | ✅ champ Odoo natif |
| `gtin` | `barcode` | char | |
| `dop_number` | `x_studio_num_dop_china` ou `x_studio_num_dop_trkiye` | char | **champ Studio**, deux variantes selon la marque/origine |
| `is_copper_indexed` | **non stocké en v16** | — | actuellement absent du modèle Odoo. À créer côté Odoo (champ Studio) ou à porter côté plateforme (registre d'attributs dynamiques) |
| `copper_weight_kg_per_unit` | **non stocké en v16** | — | idem — à arbitrer avec Olivier |
| `base_unit` | `uom_id.name` | many2one | observé `'Units'`, `'KM'` — mapping direct |
| `primary_packaging_qty` … `pallet_qty` | non observé sur staging | — | à clarifier (champ Studio ou attribut dynamique ?) |
| `unit_weight_kg` | `weight` | float | `net_weight` aussi disponible |
| `stock_quantity` | agrégat `stock.quant` filtré sur entrepôts Syskern | — | à requêter séparément |
| `pamp_eur` | `standard_price` | float | EUR par défaut ; convertir si la devise produit diffère |
| `is_active` | `active` | bool | |

### Champs Odoo Studio confirmés (à conserver dans le mapping)

| Champ Odoo Studio | Plateforme | Notes |
|---|---|---|
| `x_studio_num_dop_china` | `dop_number` (variant CN) | DoP = Déclaration de Performance, marquage CE |
| `x_studio_num_dop_trkiye` | `dop_number` (variant TR) | idem côté Turquie |
| `x_studio_to_deliver` | non mappé en MVP1 | quantité "à livrer", géré par Odoo |

### Champs Syskern attendus mais **absents** du staging

- **Indexation cuivre** + **poids cuivre par unité** : ces deux infos sont au cœur du moteur de calcul (CDC §6.3.1). Le staging ne les stocke pas. Trois options :
  1. faire créer 2 champs Studio côté Odoo (`x_studio_copper_indexed` bool, `x_studio_copper_weight_kg` float)
  2. les stocker exclusivement côté plateforme (cohérent avec la décision §5.3 : attributs dynamiques côté plateforme)
  3. choisir option 2 et masquer ces champs dans l'UI Odoo
- **Code marque** (Unikkern / NextCorn / OEM) : pas vu sur staging, à confirmer avec Olivier
- **Conditionnement (bag / carton / palette)** : absent du staging — probable conservation dans `product.packaging` (Odoo standard, non examiné en détail)
- **Référence générique** : pas stockée en Odoo, à dériver côté plateforme

---

## 3. Hiérarchie produit (`product.category`)

### Structure observée

Deux conventions cohabitent dans la base v16 :

**a) Convention héritée** — le `name` contient le path complet, le `parent_id` est NULL :
```
id=130  parent=(root)   name='ALL / COPPER / BUILDING CABLES'
id=132  parent=130      name='OR ALARM CABLE'
id=134  parent=(root)   name='ALL / COPPER / BUILDING TELEPHONE CABLES'
id=137  parent=(root)   name='ALL / COPPER / INDUSTRY BUS CABLES'
```

**b) Convention native Odoo** — hiérarchie récursive via `parent_id` + `parent_path` :
```
id=1   parent_path=1/             name='All'
id=4   parent_path=1/4/           name='COPPER'
id=5   parent_path=1/4/5/         name='DATA CABLES'
id=6   parent_path=1/4/5/6/       name='SOLID CABLE CAT5E'
```

### Stratégie de mapping recommandée

1. **Source de vérité** : `parent_path` (Odoo natif). Quand il existe avec > 1 niveau, parser les ids et reconstruire la chaîne.
2. **Fallback** : si `parent_path` n'a qu'un niveau (catégorie racine) ET `name` contient `" / "`, splitter `name` sur `" / "` pour récupérer un mapping à 4 niveaux.
3. **Convention 4 niveaux** : prendre les niveaux dans l'ordre `parent_path[0..3]` → `universe / family / range / sub_range`. Si la catégorie a moins de 4 niveaux, remplir depuis la racine et laisser les niveaux manquants en chaîne vide.

À discuter avec Olivier : **harmoniser la convention** côté Odoo avant le go-live (migrer les catégories "ALL / X / Y" vers la convention récursive) — c'est un travail d'ergonomie Odoo, pas critique pour la plateforme.

---

## 4. Mapping `product.supplierinfo` → `apps.products.ProductSupplier`

| Champ plateforme | Champ Odoo | Notes |
|---|---|---|
| `product` | `product_tmpl_id` | many2one vers product.template |
| `supplier_name` | `partner_id.name` | observé : "SYMEA LIMITED" |
| `factory_code` | `product_code` | actuellement `False` partout — extraire du SKU si besoin |
| `is_active` | `(date_end == None or date_end > today)` | pas de booléen direct ; combiner avec une convention plateforme |
| `po_base_price` | `price` | observé : 0.41 EUR/KM (donc déjà converti en EUR côté Odoo) |
| `po_currency` | `currency_id.name` | observé : `EUR` (≠ RMB du CDC §6.4) |
| `is_copper_indexed` | **non stocké** | à porter côté plateforme |
| `copper_base_price` | **non stocké** | idem |
| `incoterm` | **non observé** | à clarifier |
| `incoterm_location` | **non observé** | idem |

### Observation clé

Les prix fournisseur du staging sont **déjà en EUR** (probablement après conversion manuelle par Sonia Mahdaoui dans Odoo). Le moteur de calcul plateforme s'attend à recevoir le prix dans la devise d'origine (RMB ex usine Symea Shanghai). Deux options à acter :

1. **Continuer de saisir en EUR côté Odoo** → la plateforme ne fait pas de conversion et n'applique pas la variation cuivre (le prix EUR est figé). Ne correspond pas au modèle CDC §6.4.
2. **Ajouter un champ Studio `x_studio_po_currency_original` + `x_studio_po_price_original`** → la plateforme retrouve la devise et le prix d'origine pour appliquer cuivre + FX. Correspond au modèle CDC.

À arbitrer avec Olivier. La décision impacte directement le moteur de calcul.

---

## 5. Mapping `res.partner` → `apps.clients.Client`

| Champ plateforme | Champ Odoo | Notes |
|---|---|---|
| `odoo_id` | `id` | |
| `is_prospect` | `customer_rank == 0 and supplier_rank == 0` | hypothèse à valider |
| `name` | `name` | |
| `email` | `email` | |
| `phone` | `phone` | |
| `address_street` | `street` | |
| `address_city` | `city` | |
| `address_zip` | `zip` | |
| `address_country` | `country_id.name` | observé : France, Spain, Saudi Arabia |
| `preferred_language` | `lang` (`fr_FR`, `en_US`, …) | mapper vers `fr` / `en` / `es` |
| `segment` | non standard | absent — peut-être via un tag `category_id` (m2m) — à creuser |

### Filtres de sync recommandés

```python
# Customers à synchroniser
domain = [("customer_rank", ">", 0)]
# Suppliers à synchroniser (séparément, ils ne deviennent pas des "clients" côté plateforme)
domain = [("supplier_rank", ">", 0)]
```

⚠️ Dans le staging on a 4 partners dont le `name` ressemble à un SKU (`KFO6OM3CTZHD20`, `KSALCDOM340`) — probable artefact de demo. À ignorer ou nettoyer.

---

## 6. PAMP prévisionnel — `purchase.order.line` + `stock.quant`

### Champs disponibles sur `purchase.order.line`

Tous les champs nécessaires sont natifs :
- `product_id` (many2one vers `product.product`)
- `product_qty` / `product_uom_qty`
- `price_unit` + `currency_id`
- `state` (héritée de `order_id.state`)
- `qty_received`, `qty_invoiced`, `qty_to_invoice`
- `date_planned` (date prévue de réception)

### Définition "achats engagés" recommandée

> ⚠️ À valider avec Olivier — c'est une décision métier.

Proposition technique cohérente avec la sémantique du CDC §6.7.1 :
```python
domain = [
    ("order_id.state", "=", "purchase"),    # bon de commande confirmé
    ("qty_received", "<", "product_qty"),    # pas entièrement reçu
]
```

Cela exclut :
- les `draft`, `sent`, `to approve` (pas encore engagés)
- les `done` (déjà reçus, déjà comptés dans `stock.quant`)
- les `cancel`

### Conversion devise

Les `purchase.order.line` portent leur `currency_id` propre. Si différent d'EUR, la conversion utilise les taux figés dans `simulation.market_params` au moment du calcul, **pas** les taux Odoo (les taux Odoo bougent au fil de l'eau, on perdrait la reproductibilité).

---

## 7. Plan d'implémentation `OdooAdapterV16`

L'implémentation peut démarrer immédiatement avec ce mapping. Décomposition :

### Phase A — Lecture (3-4j)

1. `list_products(modified_since)` → `search_read` sur `product.template` avec les 19 champs listés au §2, filtré par `write_date > modified_since`.
2. `get_product(odoo_id)` → `read` sur `product.template`.
3. `get_stock_quantities(ids)` → agrégat `stock.quant` sur l'entrepôt Syskern (`location_id` à confirmer).
4. `list_clients(modified_since)` → `search_read` `res.partner` filtré `customer_rank > 0`.
5. `get_pending_purchases(ids)` → `search_read` `purchase.order.line` avec le filtre du §6.

### Phase B — Écriture (1-2j, validation utilisateur préalable)

6. `create_product(product)` → `create` sur `product.template`. **Première création = produit test `BOLDYS_TEST_*` à valider**.
7. `update_product(odoo_id, fields)` → `write` sur `product.template`.

### Phase C — Tests d'intégration (1-2j)

8. Suite paramétrée tournant sur v16 (et v19 dès qu'on a une instance vivante).
9. Tests de robustesse : timeout, retry exponentiel, erreurs 4xx/5xx (CDC §5.5).

### Phase D — Wire-up sync runner (1j)

10. Remplir les `_sync_products` / `_sync_stock` / `_sync_clients` de `apps/odoo_sync/services/runner.py`.

**Effort total estimé : 6-9 jours** sur v16. Pour v19 ajouter 2-3 jours dès qu'une instance est disponible (mêmes endpoints sémantiquement, syntaxe JSON-2 différente).

---

## 8. Points à arbitrer avec Olivier / Ghang Hui

> Bloquants stricts pour le go-live.

1. **Where stocker indexation cuivre + poids cuivre ?** Côté Odoo (champ Studio) ou côté plateforme (attribut dynamique) ?
2. **Devise d'achat fournisseur** : continuer à saisir le PO directement en EUR ou ajouter `x_studio_po_currency_original` + `x_studio_po_price_original` ?
3. **Brand** (Unikkern / NextCorn / OEM) : où la stocker dans Odoo ? Champ Studio ou attribut dynamique côté plateforme ?
4. **Hiérarchie produit** : laisser cohabiter les deux conventions ou harmoniser ?
5. **"Achat engagé" précis** : la définition technique proposée (§6) convient-elle à la pratique commerciale ?
6. **Conditionnement** : utiliser `product.packaging` Odoo natif ou un champ Studio dédié ?
7. **Webhooks Odoo SH** : disponibles sur cette offre ? (1 ligne à demander à Ghang Hui)
8. **Instance v19** : la demo est expirée, en redémarrer une — sinon on développe en aveugle sur v19 avec uniquement la doc.

---

## 9. Annexes — captures brutes

### 9.1 Échantillon catégorie hiérarchique
```
id=1   parent_path=1/         name='All'
id=4   parent_path=1/4/       name='COPPER'
id=5   parent_path=1/4/5/     name='DATA CABLES'
id=6   parent_path=1/4/5/6/   name='SOLID CABLE CAT5E'
id=7   parent_path=1/4/5/7/   name='SOLID CABLE CAT6'
id=8   parent_path=1/4/5/8/   name='SOLID CABLE CAT6A'
```

### 9.2 Exemple `product.template` réel
```
id=4178 name='CR6ASSTPOH0,3GS'
  default_code=False         # ⚠️ inutilisé
  type='product'
  categ_id=[1, 'All']        # majoritairement racine en staging
  hs_code=False              # à remplir en prod
  barcode=False
  weight=0.0                 # à remplir
  standard_price=0.0         # PAMP, à remplir
  list_price=1.0             # prix de vente par défaut, peu utile
  description / description_sale / description_purchase = False
  uom_id=[1, 'Units']        # ou [7, 'KM'] pour câbles
  x_studio_num_dop_china=False
  x_studio_num_dop_trkiye=False
  x_studio_to_deliver=0.0
  seller_ids=[421]           # un product.supplierinfo
```

### 9.3 Exemple `product.supplierinfo`
```
id=421
  partner_id=[14, 'SYMEA LIMITED']    # Syskern China
  product_tmpl_id=[4178, 'CR6ASSTPOH0,3GS']
  product_code=False
  price=0.41
  currency_id=[1, 'EUR']              # ⚠️ saisi en EUR
  min_qty=1.0
  delay=0
  date_start / date_end = False
```

### 9.4 Exemple `purchase.order.line`
```
id=2052
  order_id=[268, 'P00268']
  state='purchase'
  product_id=[5443, 'KFO2OS2A2DPZHD']
  product_qty=4.0
  product_uom=[7, 'KM']               # km confirmés
  price_unit=168.0
  currency_id=[1, 'EUR']
  qty_received=0.0                    # → "engagé"
  qty_invoiced=0.0
  date_planned='2026-06-22 10:17:32'
```
