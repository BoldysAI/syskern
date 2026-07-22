# Runbook — Basculer la prod vers une autre instance Odoo (DESTRUCTIF)

> Exécuté pour la première fois le **2026-07-22** : passage de l'instance de test
> `boldys-test` vers l'ERP de production `sys.syskern.com`. Résultat : 891 produits,
> 24 clients, 685 pricables (77 %). Ce document reprend la procédure réellement suivie.

## Le piège à comprendre avant de commencer

`push_product_task` décide créer-vs-mettre-à-jour ainsi :

```python
if existing_id:  adapter.update_product(existing_id, payload)
else:            adapter.create_product(dto)
```

`existing_id` = `Product.odoo_v16_id`, qui référence l'**ancienne** instance. Changer
l'URL sans rien d'autre fait donc écraser des `product.template` **sans rapport** dans
l'ERP cible. Et la tâche `odoo_sync.retry_failed_product_pushes` tourne **toutes les
heures** sur tout produit en `pending_odoo_sync` / `sync_failed` : le déclenchement est
automatique, il n'attend pas une action humaine.

**Deux parades**, au choix :
- **purger la base** avant la première sync (les IDs disparaissent — retenu ici) ;
- ou faire un **pull avant tout push** : le pull réconcilie par `sku_code`
  (`update_or_create`) et réécrit les `odoo_v16_id` avec ceux de la nouvelle instance.

## 0. Reconnaître l'instance cible (lecture seule)

Le nom de base n'est pas déductible de l'URL et `db.list` est désactivé en production.
Récupérer `db` depuis la console du navigateur, connecté à l'ERP :

```js
odoo.__session_info__.db
```

Puis valider version, identifiants et champs attendus — **l'API key sert de mot de
passe** :

```bash
curl -s https://<HOTE>/jsonrpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"call","params":{"service":"common","method":"version","args":[]},"id":1}'
```

À vérifier avant de basculer, sinon la sync lit dans le vide :
`item_code`, `default_code`, `brand_id`, `gtin_code`, `hs_code`,
`x_studio_num_dop_china`, `x_studio_num_dop_trkiye`, `packaging_ids`.

⚠️ Vérifier **où vit le SKU**. Sur les instances Syskern, `default_code` est quasi vide
et le SKU est dans `name` — d'où le `sku_code = default_code or name` de l'adapter.

## 1. Sauvegarde

```bash
PG=$(docker ps -qf "name=<UUID_APP_POSTGRES>")
docker exec $PG pg_dump -U postgres -Fc postgres > ~/syskern_avant_bascule_$(date +%F_%H%M).dump
```

## 2. Variables (backend + worker + beat) puis **Redeploy**

`ODOO_BASE_URL`, `ODOO_DB_NAME`, `ODOO_API_USER`, `ODOO_API_PASSWORD`,
`ODOO_VERIFY_TLS=true`, les `ODOO_V16_*` équivalents, et `MIGRATION_LOCKED=false`
le temps de l'opération.

**Redeploy, pas Restart** — Coolify ne recharge pas les variables autrement.

## 3. Couper le push horaire + vérifier la cible

```bash
BACKEND=$(docker ps -qf "name=<UUID_APP_BACKEND>")
docker exec $BACKEND python manage.py shell -c "
from django_celery_beat.models import PeriodicTask
from apps.odoo_sync.adapters.factory import get_odoo_adapter
PeriodicTask.objects.filter(task='odoo_sync.retry_failed_product_pushes').update(enabled=False)
a = get_odoo_adapter(); a.authenticate()
print('CONNECTE A :', a.base_url)
"
```

**Si l'ancienne instance s'affiche, s'arrêter là.**

## 4. Purge + reconstruction + sync

```bash
docker exec $BACKEND python manage.py bootstrap_catalog --purge --with-simulations
docker exec $BACKEND python manage.py shell -c "
from apps.odoo_sync.services.runner import sync
from apps.odoo_sync.models import SyncScope, SyncType
log = sync(scope=SyncScope.ALL, sync_type=SyncType.MANUAL, triggered_by='bascule odoo')
print('statut:', log.status)
"
```

⚠️ `bootstrap_catalog` ne charge que les **produits**. Les clients arrivent uniquement
par une sync `scope=ALL` — l'oublier laisse une prod sans client, donc **sans offre
possible** (le wizard en exige un).

## 5. Reverrouiller

`MIGRATION_LOCKED=true` → Redeploy, puis réactiver la tâche horaire (`enabled=True`).

## Lire le résultat

Un écart produits Odoo ↔ plateforme est **normal** : `runner._SKU_RE` (`^[A-Z0-9\-]+$`)
écarte les lignes de service (`Air Shipment Fee`, `Down payment`, `Droits et Taxes`…).
Elles apparaissent en `Skipping non-SKU product` dans le log.

⚠️ Ce filtre écarte aussi quelques **vrais** SKU contenant `,` `.` `/` ou une minuscule
(`CR6ASSTPOH0,3GS`, `KW1/4T`, `OEG3TVs4CT40`). Vérifier la liste des `Skipping` après
chaque bascule plutôt que de la survoler.

Repères de la bascule du 2026-07-22 : 891 produits · 881 item_code · 24 clients ·
1550 liens fournisseurs · 87 poids cuivre fournisseur · 685 pricables (77 %).

## Pièges rencontrés

| Symptôme | Cause réelle |
|---|---|
| Sync en `Connection refused` malgré `ODOO_API_VERSION=v16` | version codée en dur côté serializer + front (corrigé le 2026-07-22, cf. `decisions.md`) |
| `Task ... succeeded` alors que la sync a échoué | la tâche journalise sans lever — lire `log.status`, pas la ligne Celery |
| Variables ignorées après changement | Restart au lieu de Redeploy |
| 502 sur l'API | port Traefik (`loadbalancer.server.port`) à 3000 alors que gunicorn écoute sur 8000 |
