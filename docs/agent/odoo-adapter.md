# docs/agent/odoo-adapter.md — Adapter Odoo (factory pattern)

> Lis ce fichier avant toute tâche qui touche à Odoo.
> Règle transverse → `/AGENTS.md` §5 règle 3. Tâches Celery → `celery-task.md`.
> Référence : `apps/odoo_sync/adapters/` + `apps/odoo_sync/schemas.py`.

## Règle absolue (CDC §5.1)

**Aucun code hors du package `apps/odoo_sync/` ne doit jamais appeler Odoo directement,**
ni manipuler un payload Odoo brut.

Seuls deux points d'entrée sont autorisés depuis l'extérieur :

```python
from apps.odoo_sync.adapters.factory import get_odoo_adapter, get_odoo_adapter_for

adapter = get_odoo_adapter()             # version par défaut (ODOO["API_VERSION"])
adapter = get_odoo_adapter_for("v16")    # version explicite (dual-sync)
```

Les deux retournent un `OdooAdapter` (ABC). L'appelant **ne sait pas** quelle version est derrière.

---

## Architecture du package (5 fichiers, rôles distincts)

```
apps/odoo_sync/adapters/
├── base.py       # OdooAdapter (ABC) — contrat public. Toujours à jour.
├── _rpc.py       # JsonRpcMixin — transport HTTP bas niveau (httpx, retry, session-reauth)
├── v16.py        # OdooAdapterV16 + helpers partagés (importés par v19)
├── v19.py        # OdooAdapterV19 — importe les helpers de v16, étend avec les champs v19
└── factory.py    # get_odoo_adapter / get_odoo_adapter_for / _instantiate
apps/odoo_sync/
└── schemas.py    # DTOs version-agnostiques : OdooProduct, OdooStock, OdooClient, etc.
```

Le flux de données : **Odoo (JSON brut) → adapter.normalize → DTO schema → reste du backend**.  
Rien hors de `odoo_sync` ne voit jamais un dict Odoo brut.

---

## Utiliser l'adapter depuis une tâche Celery

```python
# Dans apps/<app>/tasks.py
from apps.odoo_sync.adapters.factory import get_odoo_adapter   # import tardif si besoin

@shared_task(name="<app>.my_sync_task", bind=True, autoretry_for=(Exception,),
             retry_backoff=True, retry_backoff_max=60, max_retries=3)
def my_sync_task(self, product_pk: str) -> dict:
    adapter = get_odoo_adapter()
    adapter.authenticate()                  # obligatoire avant tout appel

    try:
        product_dto = adapter.get_product(odoo_id)   # retourne OdooProduct, jamais un dict brut
    except Exception as exc:
        # Sauvegarde du statut, puis raise → autoretry (voir celery-task.md archétype 3)
        raise

    # Ici : travailler avec product_dto.sku_code, product_dto.standard_price_eur, etc.
    # Tout est Decimal, pas float.
```

**Règle :** `authenticate()` est appelé avant le premier appel métier, jamais mis en cache
entre deux tâches (chaque tâche est une session indépendante).

---

## DTOs — contrat entre l'adapter et le reste du backend

```python
# apps/odoo_sync/schemas.py (résumé — source de vérité)
@dataclass
class OdooProduct:
    odoo_id: int; sku_code: str; name: str
    standard_price_eur: Optional[Decimal]   # PAMP
    suppliers: list[OdooSupplierLink]
    # … voir schemas.py pour la liste complète

@dataclass
class OdooStock:
    quantity: Decimal; available_quantity: Decimal; standard_price_eur: Optional[Decimal]

@dataclass
class OdooClient:
    odoo_id: int; name: str; email: str; preferred_language: str; ...

@dataclass
class OdooPurchaseLine:
    quantity: Decimal; price_unit: Decimal; currency: str; ...
```

- **`Decimal` partout** pour les montants et quantités — jamais float.
- Tous les champs optionnels ont une valeur par défaut (chaîne vide ou `None`).
- Ajouter un DTO → `@dataclass` dans `schemas.py`, Decimal pour les montants.

### Écarts v16 ↔ v19 (push produit)

| Champ | v16 (`OdooAdapterV16`) | v19 (`OdooAdapterV19`) |
|---|---|---|
| Type stockable | `type: "product"` | `type: "consu"` + `is_storable: True` |
| GTIN | `barcode` | `gtin_code` (+ `barcode` en secours) |

En v19, `type: "product"` lève `Wrong value for product.template.type` — ne pas réutiliser le payload v16 tel quel.

---

## Ajouter une méthode à tous les adapters existants

1. **`base.py`** — ajouter la méthode abstraite avec sa signature typée et son docstring :
```python
   @abstractmethod
   def get_something(self, odoo_id: int) -> OdooSomething: ...
```
2. **`v16.py`** — implémenter via `_execute_kw` / `_call` du mixin `JsonRpcMixin`. Ne pas
   appeler `httpx` directement.
3. **`v19.py`** — implémenter ou déléguer à `v16` si identique (imports partagés).
4. **`schemas.py`** — si le retour est un nouveau type, créer le `@dataclass` correspondant.

> ⚠️ **Règle critique** : toute méthode appelable depuis l'extérieur de `odoo_sync` **doit**
> figurer dans l'ABC `base.py`. Un oubli ne plante qu'à l'exécution, pas au démarrage.

---

## Ajouter un nouvel adaptateur (nouvelle version Odoo)

1. Créer `adapters/vNN.py` :
```python
   from .base import OdooAdapter
   from ._rpc import JsonRpcMixin

   class OdooAdapterVNN(JsonRpcMixin, OdooAdapter):
       """OdooAdapterVNN — JSON-RPC (CDC §5.x)."""
       # Implémenter tous les @abstractmethod de OdooAdapter
```
2. Brancher dans `factory._instantiate` :
```python
   if version == "vNN":
       return OdooAdapterVNN(**kwargs)
```
3. Ajouter les variables d'env dans `settings/base.py` (bloc `ODOO`) et `.env.example` :
```
   ODOO_VNN_BASE_URL=...
   ODOO_VNN_DB_NAME=...
   ODOO_VNN_API_USER=...
   ODOO_VNN_API_PASSWORD=...
```
4. **Ne pas modifier** `base.py` sauf si l'interface doit changer pour toutes les versions.

---

## Le mixin `_rpc.py` — ce qu'il fournit

`JsonRpcMixin` gère tout le bas niveau : HTTP, retry (3 tentatives, backoff exponentiel 2→4→8s),
ré-authentification sur session expirée, TLS configurable.  
Les adapters n'utilisent que `_call(service, method, args)` et `_execute_kw(model, method, args, kwargs)`.  
**Ne jamais appeler `httpx` directement dans un adapter.**

---

## Configuration (dans `settings/base.py`)

```python
ODOO = {
    "API_VERSION": "v19",           # version par défaut
    "BASE_URL": ..., "DB_NAME": ..., "API_USER": ..., "API_PASSWORD": ...,
    "TIMEOUT_SECONDS": 60, "VERIFY_TLS": True, "SYNC_ENABLED": False,
    # Dual-sync (v16 + v19 en parallèle)
    "V16_BASE_URL": ..., "V16_DB_NAME": ..., "V16_API_USER": ..., "V16_API_PASSWORD": ...,
    "V19_BASE_URL": ..., "V19_DB_NAME": ..., ...
}
```

`get_odoo_adapter_for("v16")` lit les clés `V16_*`, avec fallback sur les clés partagées si absentes.  
**En prod, `ODOO_VERIFY_TLS=true` obligatoire.**

---

## Chemin du log de sync

Chaque sync bulk (via `sync_task`) crée un `SyncLog` (app `odoo_sync`).  
Champs clés : `sync_type`, `scope`, `odoo_api_version`, `status`, `items_created/updated/failed`, `errors` (JSONB).  
Utilise `SyncLog` pour les nouvelles opérations bulk — pas pour les push on-demand (ceux-ci
tracent via `product.odoo_sync_status`).

---

## Checklist

- [ ] Tous les appels Odoo passent par `get_odoo_adapter[_for]` — zéro `httpx` hors `_rpc.py`
- [ ] Nouvelle méthode → ajout dans `base.py` (ABC) + `v16.py` + `v19.py`
- [ ] Nouveau type de retour → `@dataclass` dans `schemas.py`, montants en `Decimal`
- [ ] Nouvel adapter `vNN.py` → branché dans `factory._instantiate` + env vars documentées
- [ ] `authenticate()` appelé avant le premier appel métier dans la tâche
- [ ] `ODOO_VERIFY_TLS=true` en prod