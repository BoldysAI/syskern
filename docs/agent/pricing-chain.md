# docs/agent/pricing-chain.md — Moteur de pricing PA/PR/PV

> Lis ce fichier avant toute tâche qui touche aux calculs de prix.
> Règle transverse → `/AGENTS.md` §5 règle 2. Tâches Celery → `celery-task.md`.
> Référence : `apps/simulations/services/engine/` + `apps/simulations/services/runner.py`.

## Règle absolue

**Le pricing vit dans un seul endroit.** Aucune logique de calcul de prix dans les vues,
les serializers, les tâches ou le frontend. Seul `runner.py` orchestre l'engine — et uniquement
depuis une tâche Celery (`simulations.recalculate_task`).

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
  "transports": [{"order": 1, "transport_mode_code": "SEA", "global_cost": "5000",
                  "currency": "EUR", "pallet_count": 10}],
  "customs": {"global_cost": "200", "currency": "EUR", "total_quantity": "1000"},
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
