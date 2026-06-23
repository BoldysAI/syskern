# docs/agent/pricing-chain.md — Moteur de pricing PA/PR/PV

> Lis ce fichier avant toute tâche qui touche aux calculs de prix.
> Règle transverse → `/AGENTS.md` §5 règle 2. Tâches Celery → `celery-task.md`.
> Référence : `apps/simulations/services/engine/` + `apps/simulations/services/runner.py`.

## Règle absolue

**Le pricing vit dans un seul endroit.** Aucune logique de calcul de prix dans les vues,
les serializers, les tâches ou le frontend. Seul `runner.py` orchestre l'engine — et uniquement
depuis une tâche Celery (`simulations.recalculate_task`).

## Contrat de robustesse (CDC §6.6 — ne jamais produire un résultat trompeur)

**Le moteur ne renvoie jamais un `0` silencieux.** Toute entrée manquante / nulle / incohérente
est signalée explicitement (FR) sur la ligne, jamais masquée derrière un `status="ok"` vert.

- **Diagnostics first-class** : chaque `CalculationStep` porte `warnings: list[str]` ;
  `ChainResult.warnings` les agrège ; `to_breakdown()` les expose.
- **`calculation_breakdown` standardisé** (persisté sur `SimulationLine`) :
  `{"errors": [...], "warnings": [...], "purchase": {...}, "sale": {...}, ...}`.
  Clé legacy `error` (string) conservée pour compat front.
- **Validation pré-vol** (`runner._validate_line_inputs`) :
  - pas de fournisseur actif **ou** `po_base_price is None` → **error** FR (calcul interrompu).
  - `po_base_price == 0` → **warning** FR (on calcule quand même, mais résultat nul signalé).
- **Statut honnête** : `error` si erreurs ; sinon `warning` si warnings (entrées + moteur) ; sinon `ok`.
- **Front** : `SimulationTable` affiche le 1er diagnostic en **texte lisible** (ambre=warning, rouge=error),
  clic → `LineDiagnosticsDrawer` ; helper `lineDiagnostics(line)` dans `sim-format.ts`. Menu ligne
  **Détail du calcul** → `CalculationBreakdownDrawer` (wizard read-only sur `calculation_breakdown`,
  narrations module par module via `formatBreakdownStepDetails` — jamais de clés moteur brutes).

## Odoo découplé du calcul (CDC §6.6)

Un échec Odoo **ne bloque jamais** un recalcul. Dans `recalculate_task`, les scopes
`with_odoo_refresh`/`full_refresh` encapsulent `refresh_odoo_for_simulation` : en cas d'échec,
on log, on recalcule sur les **params courants** (mode dégradé, sans pending), la tâche **réussit**,
et l'erreur est remontée via `data["odoo_refresh_error"]` + la `note` de la trace
(`[Rafraîchissement Odoo indisponible : …]`). Le front (`RecalculateModal`) affiche un message
non bloquant. Un système externe indisponible ne doit jamais empêcher de pricer.

---

## Pipeline complet (PA → PR → PV)

```
ProductView + SimulationContext (market_params)
    │
    ▼  build_purchase_modules(chain_config)
[PO base] → CopperVariation → CurrencyConversion → Transport(s) → Customs → MarginSymea
    │
    └─ ChainResult → PA net EUR
         │
         ▼  compute_predictive_pamp(stock_qty, pamp_eur, pending_purchases)
         PAMP prédictif (pondération stock + achats en cours) → Decimal | None
             │
             ▼  compute_pr(pa_net_eur, pamp_predictive, mix_pct)
             PR EUR  (mix 0 % = PA pur, 100 % = PAMP pur, intermédiaire = moyenne)
                 │
                 ▼  build_sale_modules(chain_config, syskern_margin_rate)
             Transport(s) vente → Customs → MarginSyskern
                 │
                 └─ ChainResult → PV EUR
```

---

## Architecture de l'engine (framework-free, testable sans DB)

```
engine/
├── context.py   # ProductView, SimulationContext, PriceWithCurrency, CalculationStep, to_decimal
├── modules.py   # CalculationModule (ABC) + 5 implémentations + quantize
├── chain.py     # build_purchase_modules, build_sale_modules, run_chain → ChainResult
└── pamp.py      # compute_predictive_pamp, compute_pr, resolve_mix_pct, resolve_margin_rate
```

**Jamais d'import Django ORM dans `engine/`.** Les modèles DB → `ProductView.from_model(product)`
dans `runner.py`. Replay historique → `ProductView.from_snapshot(snap)`.

---

## Types clés

| Type | Rôle |
|---|---|
| `PriceWithCurrency(amount, currency)` | Prix + devise, **immutable**, `Decimal` |
| `ProductView` | Snapshot produit utilisé par l'engine (pas le modèle ORM) |
| `SimulationContext(product, market_params)` | Paramètres marché + produit courant |
| `CalculationStep` | Sortie d'un module : input, output, metadata → audit trail |
| `ChainResult` | Résultat d'une chaîne : `final_price` + `steps` → `to_breakdown()` → JSONB |

---

## Règles métier figées dans le code (CDC §6 — ne pas contredire)

**Marges :**
- Marge Symea : taux par défaut **6 %** (`"0.06"`), formule `price_out = price_in / (1 - rate)`.
- Taux valide : `0 ≤ rate < 1`. Un taux ≥ 1 lève `ValueError`.
- Position Symea : `after_transports` (défaut) ou `before_transports`. **C'est le seul déplacement
  autorisé en MVP1.** Ne pas implémenter d'autres positions.

**Arrondi (CDC §6.5) :**
- `quantize()` = 4 décimales, `ROUND_HALF_UP` — **à chaque sortie de module**.
- Jamais de float dans les calculs. Conversions via `to_decimal()` (les floats passent par `str()`).

**Devises :**
- Taux FX en format EUR-pivot : clé `fx_eur_<devise.lower()>` dans `market_params`
  (`fx_eur_usd` = "combien d'USD pour 1 EUR"). Paires non-EUR dérivées à la volée.
- Cours cuivre : `copper_base_price_rmb` et `copper_current_price_rmb` dans `market_params`.
- Les paramètres marché sont **saisis manuellement** — aucun fetch auto de cours en MVP1.

**Mix stock/achats :**
- `mix_pct ∈ [0, 100]`. 0 = PA pur (achats neufs). 100 = PAMP pur (stock existant).
- Override par ligne bat la valeur simulation-wide (`resolve_mix_pct`, `resolve_margin_rate`).
- **PAMP prévisionnel indisponible → mix forcé à 0** (CDC §6.7.1). `compute_predictive_pamp(odoo_synced=…)`
  renvoie `None` si le produit n'est **jamais syncé Odoo** (`odoo_id is None`) **ou** si stock 0 sans achat
  engagé. Dans ce cas `resolve_mix_pct(pamp_available=False)` renvoie `0` (override compris) et le runner
  persiste `effective_mix_pct = 0`. Si un mix > 0 était demandé, le runner émet un **warning FR** non
  silencieux (« PAMP prévisionnel indisponible — mix stock/achat forcé à 0 % ») → ligne `status="warning"`
  (cf. « Contrat de robustesse »). `compute_pr(pamp_predictive_eur=None)` renvoie alors PR = PA net.
- **Arrondi (CDC §6.5)** : `compute_predictive_pamp` et `compute_pr` `quantize()` leur résultat à 4 décimales
  (import `quantize` depuis `modules`).
- `resolve_margin_rate` est **role-agnostique** : l'appelant passe le bon taux (Symea 6 % / Syskern 20 %).
  Pas de `symea_margin_override` par ligne — la marge Symea est appliquée via la config chaîne PA
  (`symea_margin`). Écart assumé au pseudo-code de la sous-tâche (cf. `decisions.md` 2026-06-23).

**Cuivre (CDC §6.3.1) :**
- Cours cuivre **toujours en RMB** dans `market_params` (`copper_base_price_rmb`, `copper_current_price_rmb`).
- `variation_rmb = (current - base) * copper_weight_kg / 1000` ; si devise PO ≠ RMB, conversion via
  `get_fx_rate("RMB", po_currency)` avant addition au prix PO.
- Non indexé → passthrough `reason="not_applicable"`.
- Indexé **mais `copper_weight = 0/None`** → passthrough `reason="indexed_without_weight"` portant un
  **warning** FR (donnée manquante), pas un no-op silencieux. Le warning remonte via
  `CalculationStep.warnings` → `ChainResult.warnings` → la ligne passe en `status="warning"`
  (`calculation_breakdown.warnings`). Voir « Contrat de robustesse » plus haut.
- Paramètres cuivre absents du snapshot → warning FR, variation nulle.

**Transport / Douane — `override_coefficient` = facteur direct :**
- Mode coefficient = **multiplicateur direct** (`out = in * coef`, ex. `1.05` pour +5 %), **pas** un taux additif.
  Vaut pour `TransportModule` et `CustomsModule`.
- `TransportModule` lit le coût **inline** dans le `chain_config` (`global_cost`/`currency`/`pallet_count`) —
  **pas** de lookup d'un `transport_mode_id` en table. `transport_mode_code` = code technique (ex. `TRUCK_FULL`) ;
  metadata moteur `transport_mode` ; libellé FR affiché uniquement côté front (`lib/transport-modes.ts` +
  `GET /api/transport-modes/`).
- **`pallet_count <= 0`** ou **`product.pallet_qty` absent** → passthrough `reason=transport_invalid_pallet_count`
  / `missing_pallet_qty` avec **warning** FR (coût transport ignoré pour la ligne), **pas** d'erreur bloquante.
  Le recalc global continue ; la ligne passe en `status="warning"` si d'autres warnings existent.
- `CustomsModule` : mode **primaire** `rate_pct` (% sur prix d'entrée, ex. `5` → +5 %) ; legacy `coefficient` +
  `détaillé` (`global_cost / total_quantity`, converti via FX si besoin).
  **Pas de mode `hs_code`** en MVP1 (cf. `decisions.md` 2026-06-19 — note CDC « pas de table customs_rates complexe »).
  Taux à 0 → passthrough `zero_customs_rate` ; coût global sans `total_quantity` → `missing_total_quantity`.
  Absence de charge legacy (`global_cost = 0`) → passthrough `reason="no_customs_charge"`.

---

## Ajouter un module de calcul

1. **`modules.py`** — créer `MyModule(CalculationModule)` :
```python
   @dataclass
   class MyModule(CalculationModule):
       type: str = ModuleType.MY_MODULE      # ajouter MY_MODULE dans ModuleType
   
       def apply(self, input_price, ctx, *, order=None) -> CalculationStep:
           # Si non applicable → passthrough
           if <condition>:
               return CalculationStep.passthrough(self.type, input_price, order=order)
           new_amount = quantize(...)        # toujours quantize en sortie
           return CalculationStep(
               module_type=self.type,
               input_price=input_price,
               output_price=input_price.with_amount(new_amount),
               metadata={"applied": True, ...},  # suffisant pour rejouer/auditer
               order=order,
           )
```
2. **`chain.py`** — câbler dans `build_purchase_modules` ou `build_sale_modules` au bon endroit
   dans la séquence. Documenter la clé JSON dans le docstring.
3. **`engine/__init__.py`** — exporter le nouveau type.
4. **Tests unitaires** (sans DB) — voir §ci-dessous.

---

## Modifier la configuration d'une chaîne (chain_config)

La chaîne achat est décrite par un `dict` JSON (CDC §6.2). Forme minimale :
```json
{
  "copper_variation": {},
  "currency_conversion": {"to_currency": "EUR"},
  "transports": [{"order": 1, "transport_mode_code": "TRUCK_FULL", "global_cost": "5000",
                  "currency": "EUR", "pallet_count": 10}],
  "customs": {"rate_pct": "5"},
  "symea_margin": {"rate": "0.06", "position": "after_transports"}
}
```
`build_purchase_modules(chain_config)` en extrait une `list[CalculationModule]` ordonnée.
`run_chain(modules, starting_price=PriceWithCurrency(...), context=ctx)` l'exécute.

---

## Tester le moteur

L'engine est framework-free → tests unitaires purs, **aucune DB** :

```python
from decimal import Decimal
from apps.simulations.services.engine import (
    PriceWithCurrency, ProductView, SimulationContext,
    CopperVariationModule, quantize,
)

def test_copper_variation_applies():
    product = ProductView(
        sku_code="TEST", is_copper_indexed=True,
        copper_weight_kg_per_unit=Decimal("18"), pallet_qty=500,
    )
    ctx = SimulationContext(
        product=product,
        market_params={
            "copper_base_price_rmb": "70000",
            "copper_current_price_rmb": "97000",
        },
    )
    price = PriceWithCurrency(amount=Decimal("200"), currency="RMB")
    step = CopperVariationModule().apply(price, ctx, order=1)

    assert step.applied is True
    assert step.output_price.amount == quantize(
        Decimal("200") + (Decimal("97000") - Decimal("70000")) * Decimal("18") / 1000
    )
```

Cas à couvrir pour tout nouveau module : appliqué / passthrough / valeur limite.

**Suite de tests pricing :**

| Fichier | Portée | DB ? |
|---|---|---|
| `tests/test_engine.py` | modules + chaînes + types + §6.4/§6.8 isolés (PA 390.1636) | non |
| `tests/test_runner.py` | `run_simulation` end-to-end §6.4, isolation d'erreur multi-lignes, trace, warnings | oui |
| `tests/test_no_float.py` | **lint « zéro float »** — scan AST de `engine/*.py`, échoue sur tout float littéral / `float(` | non |
| `tests/test_views.py` | endpoints (recalc, bulk, single-line, export) | oui |

**Lint « zéro float » (CDC §6.5)** : ruff n'a pas de règle native interdisant les flottants → `test_no_float.py`
parse chaque module de `engine/` en AST et échoue sur `ast.Constant` float ou appel `float(...)`. Tout argent
se construit depuis `str`/`int` (`Decimal("0.06")`, `to_decimal(...)`).

---

## Modèles de persistance (CDC §3.2 + §6.9.10–12)

Tables Django ORM (`apps/simulations/models.py`, `apps/market/models.py`) — **pas de SQLAlchemy** (cf. `docs/agent/decisions.md`).

| Table | Rôle |
|---|---|
| `simulations` | En-tête : `market_params` + `calculation_chain` snapshot, marges, mix, `odoo_snapshot_at`, statut `draft`/`finalized`/`archived` |
| `simulation_lines` | 1 ligne/SKU : snapshots produit/fournisseur, overrides, résultats figés (`pa_net_eur`, `pr_eur`, `pv_eur`, `effective_margin_rate`, `effective_mix_pct`), `calculation_breakdown` |
| `simulation_recalculations` | Trace d'audit à chaque recalc global (`aggregates`, `line_snapshots`, `trigger_type`, snapshots) |
| `market_parameters` | Cuivre/FX saisis manuellement, historisés ; source pour les snapshots `market_params` |

**`aggregates`** (sur chaque trace) : `line_count`, `avg_pa_eur`, `avg_pr_eur`, `avg_pv_eur`, **`avg_margin`** (moyenne `effective_margin_rate`), `min_pv_eur`, `max_pv_eur`, `warnings_count`, `errors_count`. **`line_snapshots`** = liste figée par SKU (`product_id`, `sku`, `designation`, `pa_net_eur`, `pr_eur`, `pv_eur`, `effective_margin_rate`, `effective_mix_pct`, `status`) — historise les résultats par ligne (option A) pour le « Voir détail » et le « Comparer avec actuel ». `runner._build_line_snapshots` la construit ; `_aggregate` calcule `avg_margin`.

**Protection finalized (double couche)** :
- API : `SimulationViewSet._ensure_writable` + `destroy` (offres attachées → 409).
- DB : triggers PostgreSQL `simulations_guard_finalized` et `simulation_lines_guard_finalized_parent` (migration `simulations/0003`). Seule transition autorisée sur une simulation finalized : `status → archived`.

**Paramètre marché actif** : `GET /api/market-parameters/current/?parameter_type=copper_price` (FX : ajouter `fx_from_currency` + `fx_to_currency`).

`runner.py` persiste `effective_*` sur chaque ligne et `odoo_snapshot_at` sur la simulation à chaque recalc global.

**Recalcul (CDC §6.9.4)** : `POST /api/simulations/{id}/recalculate/` body `{scope, market_params?}` où
`scope ∈ {params_only, with_odoo_refresh, full_refresh}` → 202 `{task_id}` (poll `/api/tasks/{id}/`).
`recalculate_task` mappe `scope → RecalculationTrigger`. **`market_params` optionnels persistés avant
recalc pour tout scope** (pas seulement `full_refresh`). `with_odoo_refresh`/`full_refresh` appellent
`services/odoo_refresh.refresh_odoo_for_simulation` **avant** `run_simulation`.

**Snapshot marché dans le breakdown** : `runner._market_params_snapshot` écrit un sous-ensemble
(cuivre RMB, FX EUR-pivot) dans `calculation_breakdown.market_params_snapshot` par ligne.

**Refresh Odoo en masse** (`services/odoo_refresh.py`) : via `get_odoo_adapter()` (factory), batch `get_stock_quantities` + `get_pending_purchases` sur les `odoo_id` des produits des lignes → met à jour `Product.stock_quantity/pamp_eur` et renvoie `(snapshot_at, pending_by_product)`. Les `OdooPurchaseLine` sont converties en EUR via le FX `fx_eur_<devise>` du snapshot (`_to_eur`) et passées à `compute_predictive_pamp` (PAMP prévisionnel). Ligne sans FX disponible = ignorée (jamais de taux inventé). Échec Odoo = mode dégradé géré dans `recalculate_task` (log warning + pas de pending), jamais bloquant.

> **Endpoints `GET /api/odoo/products/{odoo_id}/pending-purchases|pending-sales` (CDC §5.7) = superseded.** Le PAMP prévisionnel se nourrit du service bulk ci-dessus (un seul batch par recalc), pas d'un appel synchrone par produit — qui violerait `/AGENTS.md` §5.4 (appel externe = Celery). Aucun endpoint par produit n'est exposé (cf. `decisions.md` 2026-06-18 et 2026-06-23). `get_pending_sales` n'impacte pas le PAMP (les ventes consomment le stock au PAMP courant, CDC §6.7.1).

**Recalcul ligne unique (CDC §6.9.5)** : `recalculate_single_line(line)` (runner, synchrone) via `POST /api/simulation-lines/{id}/recalculate/`. **N'écrit jamais** de `SimulationRecalculation` et ne touche pas `is_dirty`/`last_calculated_at` de la simulation.

**Bulk-edit (CDC §6.9.5)** : `POST /api/simulations/{id}/lines/bulk/` (`filter` + `margin_override`/`stock_purchase_mix_pct_override`/`reset`) ; aperçu `POST .../lines/bulk/preview/` → `{count}`. Filtre (`_filter_simulation_lines`) : univers/famille/gamme, marque, `factory_code`, `has_warning`/`has_error` (pas d'attributs dynamiques). Lignes touchées → `status="dirty"`.

**Export Excel** : `POST /api/simulations/{id}/export/` → 202 `{task_id}` (Celery `export_simulation_task`) puis `GET /api/simulations/exports/{task_id}/` (`FileResponse`). `exports.build_simulation_xlsx` = 3 onglets (Synthèse / Résultats / Breakdown détaillé).

**Cycle de vie (CDC §6.9.6–8, §6.9.11–12)** :
- **Finalize** `POST /api/simulations/{id}/finalize/` — pré-vol : `last_calculated_at` non null (jamais calculée → 400), aucune ligne `status="error"` (sinon 400 + `{"errors": [skus]}`), pas `is_dirty`. Sur succès : `runner.snapshot_finalize_trace` fige une trace `trigger_type="finalize"` (avec `line_snapshots`) **pendant que la sim est encore draft** (aucun guard trigger sur `simulation_recalculations`), puis `status → finalized`. PATCH ultérieurs → 403.
- **Duplicate** `POST /api/simulations/{id}/duplicate/` (body `{label?}`, défaut `"<label> (copie)"`) — copie intégrale en `draft` (header + lignes avec overrides, résultats figés **et** `effective_*`, hérite `last_calculated_at`). **Pas** d'offres ni d'historique recalc copiés. Actif aussi sur `finalized`.
- **Archive / unarchive** `POST .../archive/` (finalized → archived ; draft → 400) · `POST .../unarchive/` (archived → finalized). Liste `GET /api/simulations/` **exclut les archivées** sauf `?include_archived=true` (`get_queryset`, action `list` uniquement). Offres non impactées.
- **Compare** `POST /api/simulations/compare` body `{simulation_ids?, recalculation_ids?}` (2–4 colonnes au total). Mixe simulations vivantes et snapshots de recalcul (`line_snapshots`) pour « comparer avec actuel ». Réponse : `columns[]` (`{key, type, id, simulation_id, label, status, aggregates, context}`, simulations d'abord puis recalculs) + `products[]` (matrice SKU × colonne : PV/PR/PA + marge/mix). **`context`** par colonne = paramètres figés (marché, mix, marges, incoterm vente, dates, trigger, `chain_module_count`) pour le diff paramètres côté front. **`aggregates`** inclut `warnings_count` / `errors_count` sur les simulations vivantes. Deltas PV (absolu/%) + code couleur (>5 % rouge, 1–5 % jaune, <1 % vert) calculés **côté front** vs la 1ʳᵉ colonne ; écarts PA/PR/PV/marge/mix calculés sur **valeurs brutes API** (pas les chaînes `fmtEur`).
- **Comparaisons enregistrées** : modèle `SavedComparison` (migration `simulations/0006`) — `label`, `simulation_ids[]`, `recalculation_ids[]`, `note`. CRUD `GET/POST /api/saved-comparisons/`, `GET/PATCH/DELETE /api/saved-comparisons/{id}/` (liste non paginée). Validation identique à compare (2–4 colonnes, IDs existants ; `recalculation_ids` peut être `[]`). Réponse détail inclut `columns[]` résolus (libellés simulations / dates recalc).
- **Historique recalculs** `GET /api/simulations/{id}/recalculations/` **paginé LimitOffset** (`?limit=&offset=`, DESC) — serializer léger **sans** `line_snapshots` ; détail `GET /api/simulations/{id}/recalculations/{recalc_id}/` (trace complète **avec** `line_snapshots`). ⚠️ pagination = LimitOffset projet (pas `page/page_size` du CDC, cf. `decisions.md` 2026-06-22).

**Lookup bulk SKU (wizard import)** : `POST /api/products/lookup-bulk` — résout une liste de codes SKU
en `{found, not_found}` (produits actifs uniquement, une requête SQL).

**Filtres lignes** : `GET /api/simulation-lines/?simulation=<id>&status_in=ok,warning,error`
(valeurs CSV : `ok` | `warning` | `error` | `dirty` | `pending`). **`has_warning` / `has_error`**
conservés pour rétro-compat et bulk-edit ; le front tableau préfère `status_in`.

**Wizard — forme `calculation_chain`** : le front écrit `{purchase_chain, sale_chain}` (cf. CDC §6.2).
Preset « Standard import Chine » = structure PA (2 transports + douane) sans montants inventés ;
l'utilisateur complète les coûts avant recalc.

---

## Incoterms (CDC §6.7–6.8, §12.2)

**Le moteur ne calcule pas `f(incoterm)`** — l'incoterm pilote la **structure attendue** des chaînes
PA/PV et des **warnings non bloquants** (§6.8.3). Le **PR** reste une formule pure mix(PA, PAMP).

| Rôle | Source | Impact |
|---|---|---|
| Incoterm **achat** | `ProductSupplier.incoterm` (+ lieu), snapshoté dans `supplier_snapshot` au recalc | Guidage chaîne **PA** : l'utilisateur complète transports/douanes non couverts par le PO |
| Incoterm **vente** | `Simulation.sale_incoterm` (+ `sale_incoterm_location`) | Guidage chaîne **PV** ; reprise par défaut à la création d'offre |
| **PR** | — | **Aucun** — `compute_pr(pa_net, pamp_predictive, mix_pct)` |

**Service hors engine** : `apps/simulations/services/incoterm_rules.py`
- `suggest_purchase_chain(incoterm)` / `suggest_sale_chain(incoterm)` → skeleton `{purchase_chain|sale_chain}` sans montants inventés (miroir front `lib/incoterms.ts`).
- `check_purchase_chain_coherence(supplier_incoterm, purchase_chain)` / `check_sale_chain_coherence(sale_incoterm, sale_chain)` → `list[str]` warnings FR (§6.8.3 / §12.2).

**Runner** (`recalculate_line`) : après exécution PA/PV, agrège `incoterm_warnings` dans
`calculation_breakdown.warnings` et persiste `incoterm_context` :
```json
{
  "sale_incoterm": "EXW",
  "sale_incoterm_location": "…",
  "purchase_incoterm": "FOB",
  "purchase_incoterm_location": "Shanghai"
}
```
Statut ligne → `warning` si warnings incoterm présents (non bloquant). Trace `SimulationRecalculation`
inclut `sale_incoterm` / `sale_incoterm_location`.

**Référentiel** : `GET /api/incoterms` (table `incoterms`, seed 11 codes ICC 2020).

**Front** : `SaleIncotermFields` + modale confirmation prefill (`useIncotermPrefillConfirm`) dans
sidebar et wizard ; bouton « Adapter la chaîne PA depuis les fournisseurs » (incoterm achat majoritaire).
Breakdown synthèse + `LineDiagnosticsDrawer` affichent `incoterm_context`.

---

**`pallet_count` dans les transports** : `build_purchase_modules` / `build_sale_modules` coalescent
`null`/absent → `0` (`_transport_pallet_count`). Si `<= 0` ou `pallet_qty` produit manquant,
`TransportModule` → passthrough + warning FR (cf. §Transport ci-dessus), pas d'exception.
Validation **wizard/front** : `validateTransportChains` exige toujours `pallet_count > 0` avant
**persistance** de la chaîne — le warning moteur ne remplace pas cette garde à la saisie.

---

## Ce qu'il ne faut jamais faire

- ❌ Importer un modèle Django ORM dans `engine/` (casse la testabilité).
- ❌ Calculer un prix dans une vue, un serializer, une tâche (hors runner).
- ❌ Utiliser `float` — toujours `Decimal` + `to_decimal()`.
- ❌ Omettre `quantize()` à la sortie d'un module.
- ❌ Ajouter une position de marge Symea autre qu'`after_transports`/`before_transports` (hors périmètre MVP1).
- ❌ Modifier `SimulationRecalculation` (trace d'audit) — `runner.py` l'append toujours ; ne pas skipper.

---

## Checklist

- [ ] Zéro float — `Decimal` + `to_decimal()`
- [ ] `quantize()` en sortie de chaque module
- [ ] Nouveau module exporté dans `engine/__init__.py`
- [ ] Câblé dans `build_*_modules` avec docstring sur la clé JSON attendue
- [ ] Tests unitaires sans DB (positif + passthrough + edge case)
- [ ] `runner.py` appelle le module via les builders — jamais de `run_chain` avec une liste construite à la main dans les vues