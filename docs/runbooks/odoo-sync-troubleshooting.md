# Runbook — Troubleshooting sync Odoo

Quand la sync journalière / manuelle échoue, ou que le catalogue diverge
d’Odoo. Complète [`bascule-odoo-prod.md`](bascule-odoo-prod.md) (changement
d’instance) et le mapping [`../odoo-mapping.md`](../odoo-mapping.md).

---

## 1. Architecture rapide

```
API / Celery  →  get_odoo_adapter()  →  JsonRpcMixin (/jsonrpc)
                      │
                 SyncLog (BDD)  ←  vérité du statut
```

- Tâche quotidienne : `odoo_sync.sync_task`, **03:00 UTC**, scope `all`
  ( PeriodicTask en BDD via django-celery-beat ).
- Retry pushes produits : horaire `odoo_sync.retry_failed_product_pushes`.
- Killswitch : `ODOO_SYNC_ENABLED=false` coupe les syncs automatiques.

**Ne jamais** juger le succès sur la ligne Celery seule :
`Task … succeeded` peut masquer un `SyncLog.status=failed` (la tâche logue
sans lever).

---

## 2. Checklist diagnostic (ordre)

### 2.1 Santé plateforme

```bash
curl -sS https://<host>/api/health
# database doit être ok
```

### 2.2 Derniers SyncLog

Django admin ou shell :

```bash
docker exec "$BACKEND" python manage.py shell -c "
from apps.odoo_sync.models import SyncLog
for l in SyncLog.objects.order_by('-started_at')[:5]:
    print(l.started_at, l.scope, l.status, l.error_message)
"
```

### 2.3 Connexion adapter

```bash
docker exec "$BACKEND" python manage.py shell -c "
from apps.odoo_sync.adapters.factory import get_odoo_adapter
a = get_odoo_adapter()
a.authenticate()
print('version conf:', a.__class__.__name__)
print('url:', a.base_url)
print('db:', getattr(a, 'db_name', '?'))
"
```

Si l’URL affichée ≠ instance attendue → variables Coolify pas rechargées
(**Redeploy**, pas Restart) ou mauvais bloc `ODOO_V16_*` / `ODOO_V19_*`
vs `ODOO_API_VERSION`.

### 2.4 Version Odoo cible

```bash
curl -s https://<HOTE>/jsonrpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"call","params":{"service":"common","method":"version","args":[]},"id":1}'
```

Nom de base (console navigateur connecté à l’ERP) :

```js
odoo.__session_info__.db
```

---

## 3. Tableau des symptômes

| Symptôme | Cause fréquente | Action |
|---|---|---|
| `Connection refused` / timeout | Mauvaise URL, TLS, firewall, `ODOO_VERIFY_TLS` | Vérifier URL + `authenticate()` |
| Auth error | Mauvais user/password (API key = password) | Régénérer credentials Odoo, maj env, Redeploy |
| Sync « succeeded » Celery mais catalogue vide | Lire `SyncLog.status` / `error_message` | Relancer manuel après fix |
| Produits manquants vs Odoo | Filtre SKU `^[A-Z0-9\-]+$` | Attendu pour lignes service ; vérifier vrais SKU avec `,` `.` `/` minuscules |
| Clients absents | Sync `products` seulement, ou bootstrap sans `scope=ALL` | Relancer sync `ALL` |
| Écrasement de templates Odoo | Changement d’URL sans purge / rebind IDs | **Stop** → suivre bascule runbook |
| Push horaire recrée le chaos | `retry_failed_product_pushes` enabled | Désactiver PeriodicTask le temps du fix |
| Champs vides (brand, DoP, packaging) | Champ Studio absent / `fields_get` intersection | Vérifier champs sur l’instance (bascule §0) |
| 502 API pendant debug | Traefik port 3000 vs gunicorn 8000 | Corriger load balancer port |

Politique retry code (CDC §5.5 / `_rpc.py`) :

- Auth expirée → **1** re-auth + replay
- 5xx / réseau → **3×** backoff 2/4/8 s
- **4xx** → pas de retry

---

## 4. Relancer une sync manuelle

```bash
docker exec "$BACKEND" python manage.py shell -c "
from apps.odoo_sync.services.runner import sync
from apps.odoo_sync.models import SyncScope, SyncType
log = sync(scope=SyncScope.ALL, sync_type=SyncType.MANUAL, triggered_by='ops')
print(log.status, log.error_message)
"
```

Scopes utiles : `ALL`, `PRODUCTS`, `STOCK`, `CLIENTS`, `SUPPLIERS`,
`PURCHASES_SALES`.

Via API (auth session admin) : endpoint sync documenté dans
`/api/docs/` (tag odoo).

---

## 5. Couper / rétablir le push horaire

```bash
docker exec "$BACKEND" python manage.py shell -c "
from django_celery_beat.models import PeriodicTask
PeriodicTask.objects.filter(
    task='odoo_sync.retry_failed_product_pushes'
).update(enabled=False)  # ou True
"
```

---

## 6. Quand escalader vers une bascule

Si `ODOO_BASE_URL` / instance ERP change → **ne pas** se contenter de
changer l’env. Suivre intégralement
[`bascule-odoo-prod.md`](bascule-odoo-prod.md) (purge ou pull-first pour
rebind `odoo_v16_id` / `odoo_v19_id`).

---

## 7. Références code

| Fichier | Rôle |
|---|---|
| `apps/odoo_sync/adapters/factory.py` | Choix v16/v19 |
| `apps/odoo_sync/adapters/_rpc.py` | JSON-RPC, retry |
| `apps/odoo_sync/services/runner.py` | Upsert, filtre SKU |
| `apps/odoo_sync/models.py` | `SyncLog`, `SyncScope` |
| `backend/docs/odoo_investigation_report.md` | Spike champs (historique) |
