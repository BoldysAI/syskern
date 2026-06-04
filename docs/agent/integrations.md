# docs/agent/integrations.md — Clients HTTP externes (Gamma / OpenAI / DeepL)

> Lis ce fichier avant de toucher à une intégration tierce **hors Odoo**.
> Odoo a son propre pattern (factory + ABC) → `odoo-adapter.md`. Async → `celery-task.md`.
> Référence : `apps/offers/services/{gamma,openai_client,translation}.py`.

## Périmètre

Trois services externes, tous via `httpx`, tous dans `apps/offers/services/` :

| Client | Fichier | Rôle (CDC) | État réel |
|---|---|---|---|
| `GammaClient` | `gamma.py` | Génération offres/catalogues (CDC §7.7) | **Stub** — `generate_quote`/`generate_tariff_catalog` lèvent `NotImplementedError` |
| `OpenAIClient` | `openai_client.py` | Argumentation IA des offres projet | Fonctionnel (`generate_copy`) — system+user → `chat/completions` |
| `DeepLClient` | `translation.py` | Traduction contenu produit (CDC §10.4) | Fonctionnel (`translate`) — appelé depuis `apps/products/tasks.py` |

> Odoo **ne** suit **pas** ce pattern : c'est la seule intégration avec versioning multi-instance,
> donc factory + ABC. Ces trois-là sont des clients simples sans factory.

---

## Pattern de client (à respecter pour tout nouveau service)

```python
"""<Service> client — <rôle> (CDC §X)."""
from __future__ import annotations

import httpx
from django.conf import settings


class <Service>Error(RuntimeError):
    """Seule exception 'propre' levée par ce client."""


class <Service>Client:
    BASE_URL = "https://api.<service>.com/v1"          # constante de classe

    def __init__(self, api_key: str | None = None, timeout: float = 30.0):
        self.api_key = api_key or settings.<SERVICE>_API_KEY   # clé via settings, jamais en dur
        self.timeout = timeout

    def do_something(self, *, arg: str) -> str:
        if not self.api_key:                          # fail-closed si non configuré
            raise <Service>Error("<SERVICE>_API_KEY is not configured.")
        with httpx.Client(base_url=self.BASE_URL, timeout=self.timeout,
                          headers={"Authorization": f"Bearer {self.api_key}"}) as client:
            resp = client.post("/endpoint", json={...})
            if resp.status_code != 200:
                raise <Service>Error(f"<Service> returned {resp.status_code}: {resp.text[:200]}")
            return resp.json()[...]
```

**Invariants (vus dans le code) :**
- Une classe `*Client`, une `BASE_URL` en constante de classe, un timeout par défaut.
- Clé API lue depuis `settings` (bloc `GAMMA` / `OPENAI_API_KEY` / `DEEPL_API_KEY`), **jamais en dur**.
- **Fail-closed** : si la clé manque → lève l'`*Error` dédiée (pas de fallback silencieux).
- `httpx.Client` comme **context manager** (`with ...`), pas de session globale partagée.
- Vérifier `status_code` explicitement et tronquer le corps d'erreur (`text[:200]`).
- Messages métier en français côté API ; messages techniques de ces clients = anglais (logs/debug).

---

## Règle d'or : ces appels passent par Celery

Tout appel réseau bloque → **jamais dans le thread de requête** (`/AGENTS.md` §5 règle 4).
Le client externe est instancié **dans une tâche Celery**, pas dans une vue/serializer.

```python
# apps/<app>/tasks.py
@shared_task(name="<app>.translate_task")
def translate_task(product_pk: str, target_lang: str) -> dict:
    from apps.offers.services.translation import DeepLClient   # import tardif
    client = DeepLClient()
    translated = client.translate(source_text=..., source_lang="fr", target_lang=target_lang)
    # ... persiste dans Product.description_<lang> (JSONB), update_fields=[...]
```

La vue dispatch (`202 + {"task_id"}`), le client poll `/api/tasks/{id}/`. → `celery-task.md`.

---

## Cache traduction

Pas de couche Redis pour DeepL : la traduction est **persistée dans les champs JSONB
`Product.description_*`** (`{"fr": ..., "en": ...}`). Avant d'appeler DeepL, vérifie si la
langue cible est déjà remplie. `translate("")` court-circuite (renvoie `""`) pour épargner le quota.

---

## Ajouter / câbler un service externe

1. Créer `apps/offers/services/<service>.py` avec le pattern ci-dessus.
2. Ajouter la clé dans `settings/base.py` (bloc dédié) **et** `backend/.env.example`. Jamais de secret en dur.
3. L'appeler **depuis une tâche Celery** (import tardif), jamais depuis une vue.
4. Gérer les codes d'erreur spécifiques du service (ex. DeepL `456` = quota dépassé).

---

## Checklist

- [ ] Client = classe `*Client` + `*Error` dédiée + `BASE_URL` + timeout
- [ ] Clé API via `settings`, fail-closed si absente, jamais en dur
- [ ] `httpx.Client` en context manager, `status_code` vérifié
- [ ] Appel encapsulé dans une tâche Celery (202 + polling), import tardif du client
- [ ] Clé ajoutée à `settings/base.py` + `.env.example`
- [ ] Erreurs spécifiques du service gérées (quota, auth, 4xx/5xx)
