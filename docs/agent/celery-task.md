# docs/agent/celery-task.md — Tâches Celery

> Lis ce fichier avant d'ajouter une tâche async ou un appel I/O externe.
> Règles transverses → `/AGENTS.md` (§5 règle 4). Conventions Django → `backend.md`.
> Référence : `apps/products/tasks.py`, `apps/odoo_sync/tasks.py`, `apps/simulations/tasks.py`.

## Principe de base

**Tout I/O externe ou long (Odoo, Gamma, DeepL, export Excel, recalcul pricing) = tâche Celery.**  
La vue renvoie `202 + {"task_id"}`. Le client poll. Le thread de requête ne bloque jamais.

---

## Polling endpoint (déjà implémenté — ne pas recréer)

```
GET /api/tasks/{task_id}/
→ {"task_id", "status", "result"?  "error"?  "progress"?}
```

États terminaux : **`SUCCESS`**, **`FAILURE`**, **`REVOKED`**.  
Tant que `status` n'est pas dans ces trois, le client continue de poller.  
Implémenté dans `apps/core/views.task_status` + `apps/core/urls.py` — `AllowAny`.

---

## Conventions obligatoires

- **`@shared_task`** toujours — jamais `@app.task` (évite d'importer le Celery app dans les apps).
- **`name="<app>.<function_name>"`** toujours explicite. Ex : `"products.export_products_task"`.
- **`autodiscover_tasks`** est actif — toute tâche dans `<app>/tasks.py` est détectée automatiquement.
- **Retourne un dict JSON-serializable** — souvent un payload serializer + méta.
- **`update_fields=[...]`** sur tous les `.save()` dans une tâche.
- **Imports tardifs** pour les modèles d'autres apps (évite les cycles au boot).
- **`_TaskError`** défini en haut de chaque `tasks.py` — seule exception "propre" à lever.

---

## Archétype 1 — Tâche standard (le plus courant)

```python
"""Celery tasks for <app>."""
from __future__ import annotations
import logging
from celery import shared_task
from .models import MyModel
from .serializers import MyDetailSerializer

logger = logging.getLogger(__name__)

class _TaskError(RuntimeError):
    """Raised inside tasks to surface a clean message via Celery FAILURE."""


@shared_task(name="<app>.my_task")
def my_task(record_pk: str, param: str) -> dict:
    """Ce que fait la tâche + référence CDC si applicable."""
    try:
        obj = MyModel.objects.get(pk=record_pk)
    except MyModel.DoesNotExist as e:
        raise _TaskError("Objet introuvable.") from e

    # … logique métier …
    obj.field = result
    obj.save(update_fields=["field", "updated_at"])

    return MyDetailSerializer(obj).data      # retour JSON-serializable
```

**Dispatch depuis une vue :**
```python
result = my_task.delay(str(obj.pk), param="value")
return Response({"task_id": result.id, "status": "PENDING"}, status=status.HTTP_202_ACCEPTED)
```

---

## Archétype 2 — Tâche bind=True (besoin de `self.request.id`)

Utilise `bind=True` uniquement si tu as besoin de `self.request.id` (ex : nommage de fichier)
ou de `self.retry()` manuel.

```python
EXPORT_DIR = Path("/tmp/syskern_exports")

@shared_task(name="<app>.export_task", bind=True)
def export_task(self, filters: dict | None = None, columns: list | None = None, ids: list | None = None) -> dict:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    file_path = EXPORT_DIR / f"{self.request.id}.xlsx"   # task_id comme nom unique
    file_path.write_bytes(build_xlsx(filters=filters, columns=columns, ids=ids))
    return {
        "file_url": f"/api/<app>/exports/{self.request.id}/",
        "filename": "export.xlsx",
    }
```

Exposer le fichier : ajouter un `@action` (ou `APIView`) qui lit `EXPORT_DIR / f"{task_id}.xlsx"` et retourne un `FileResponse`. Voir `products/views.py::export_file`.

**Gotcha dev** : après changement de **signature** d'une tâche déjà enregistrée, **redémarrer le worker Celery** (`./scripts/dev-celery.sh`). Sinon le process garde l'ancien code en mémoire → `TypeError: … unexpected keyword argument`.

---

## Archétype 3 — Auto-retry sur I/O externe (Odoo, API tierce)

```python
@shared_task(
    name="<app>.push_task",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def push_task(self, record_pk: str) -> dict:
    from apps.products.models import Product   # import tardif — évite cycle

    try:
        obj = Product.objects.get(pk=record_pk)
    except Product.DoesNotExist:
        raise ValueError(f"pk={record_pk} not found")

    try:
        adapter = get_odoo_adapter()
        adapter.authenticate()
        # … appel I/O …
    except Exception as exc:                   # BLE001 acceptable ici — on relaie
        obj.sync_status = "sync_failed"
        obj.sync_error = f"{type(exc).__name__}: {exc}"[:2000]
        obj.save(update_fields=["sync_status", "sync_error", "updated_at"])
        logger.warning("push_task failed pk=%s err=%s", record_pk, exc)
        raise                                  # bubbles → autoretry

    obj.sync_status = "synced"
    obj.sync_error = ""
    obj.save(update_fields=["sync_status", "sync_error", "updated_at"])
    logger.info("push_task ok pk=%s", record_pk)
    return {"status": "synced"}
```

**Pattern pré-dispatch (vue → tâche) :** marquer le statut `pending` *avant* `.delay()` pour que
le job périodique de recovery puisse récupérer les lignes si le worker a droppé le message :

```python
MyModel.objects.filter(pk=obj.pk).update(sync_status="pending", sync_error="")
push_task.delay(str(obj.pk))
```

---

## Archétype 4 — Tâche périodique (Celery Beat)

```python
@shared_task(name="<app>.cleanup_task")
def cleanup_task() -> dict:
    """Scan + redispatch. Planifiée via Celery Beat (migration ou settings)."""
    from django.conf import settings                # import tardif
    from .models import MyModel

    qs = MyModel.objects.filter(
        sync_status__in=("pending", "sync_failed"),
        is_active=True,
    ).only("pk")[:500]                             # cap pour éviter une explosion

    dispatched = 0
    for obj in qs:
        push_task.delay(str(obj.pk))
        dispatched += 1

    logger.info("cleanup_task dispatched=%d", dispatched)
    return {"dispatched": dispatched}
```

Enregistrer dans Celery Beat : créer une migration dans l'app concernée ou ajouter à `CELERY_BEAT_SCHEDULE` dans `settings/base.py`.

---

## Checklist avant de déclarer la tâche terminée

- [ ] `@shared_task` + `name="<app>.<function_name>"` explicite
- [ ] `_TaskError` défini en haut du fichier `tasks.py`
- [ ] Retourne un dict JSON-serializable
- [ ] `update_fields` sur tous les `.save()`
- [ ] Imports tardifs pour les modèles cross-apps
- [ ] Vue dispatch : `202 + {"task_id", "status": "PENDING"}`
- [ ] Client poll sur `/api/tasks/{task_id}/` (endpoint existant)
- [ ] Si auto-retry : except → sauvegarde statut → `raise`
- [ ] Si fichier : utilise `self.request.id` comme nom, expose un endpoint de téléchargement
- [ ] `logger.info/warning` sur les actions significatives