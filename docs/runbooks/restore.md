# Runbook — Restauration backups (INF / CDC §9.4)

Remettre en service une instance à partir d’un backup (RPO cible **24 h**,
RTO cible **4 h** — best-effort, non contractuel MVP1).

> **État repo** : la stratégie CDC (§9.4) prévoit `infra/backup.sh` + push S3
> quotidien 02:00 UTC. Le script versionné dans ce dépôt est adapté à un
> **Postgres classique** (Coolify/Docker) — **pas** de Storage Supabase.
> Vérifier sur le VPS que le cron est bien installé avant d’assumer qu’un
> dump S3 existe.

---

## 1. Que sauvegarde-t-on ?

| Composant | Méthode | Restauration |
|---|---|---|
| Base Postgres | `pg_dump -Fc` (custom) | `pg_restore` |
| Fichiers exports / media app | volume Docker / chemin monté (si présent) | copie fichier |
| Secrets applicatifs | `.env` / export Coolify **chiffré GPG** | déchiffrement hors bande |

Rétention cible : **7 jours** glissants sur le bucket S3 (OVH Object Storage).

---

## 2. Backup (prod)

Script : [`infra/backup.sh`](../../infra/backup.sh).

Variables typiques (cron `02:00 UTC`) :

```bash
export DATABASE_URL='postgres://…'   # ou PGHOST/PGUSER/PGDATABASE
export BACKUP_DIR=/var/backups/syskern-pricing
export S3_BUCKET=s3://syskern-pricing-backups
# AWS_* ou rclone config pour OVH Object Storage
```

Vérification post-backup :

```bash
pg_restore --list "$BACKUP_DIR/db_latest.dump" | head
# en cas d’échec → email yassine@boldys.ai, karim@boldys.ai
```

Test manuel local (Compose) :

```bash
PG=$(docker compose ps -q postgres)
docker exec "$PG" pg_dump -U syskern -Fc syskern > /tmp/syskern_test.dump
pg_restore --list /tmp/syskern_test.dump | head
```

---

## 3. Restauration vers une instance neuve

### 3.1 Préparer la cible

1. Provisionner un VPS / projet Coolify **vide** → [`vps-setup.md`](vps-setup.md)
   **sans** laisser `bootstrap_catalog` recharger des Excel si tu restaures
   une dump déjà enrichie (ou accepte un no-op si `Product` existe après restore).
2. Créer Postgres + Redis ; **ne pas** lancer encore le trafic utilisateurs.
3. Récupérer le dump depuis S3 :

```bash
DATE=2026-07-22   # dossier du jour
aws s3 sync "$S3_BUCKET/$DATE/" /var/restore/syskern/
# ou : rclone copy …
```

### 3.2 Restaurer Postgres

```bash
# Stopper backend / worker / beat (évite les écritures concurrentes)
# Puis, dump custom (-Fc) :
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" \
  /var/restore/syskern/db_*.dump
```

Sous Coolify / Docker :

```bash
PG=$(docker ps -qf "name=<UUID_APP_POSTGRES>")
docker exec -i "$PG" pg_restore -U postgres --clean --if-exists --dbname=postgres \
  < /var/restore/syskern/db_YYYY-MM-DD.dump
```

Si la base cible n’est pas vide et `--clean` échoue sur des dépendances :
drop/recreate la database puis `pg_restore` sans `--clean`.

### 3.3 Restaurer la config

1. Déchiffrer le `.env` GPG (clé privée dans le coffre Boldys) **ou**
   réinjecter les variables dans Coolify depuis le coffre.
2. **Redeploy** backend + worker + beat + frontend (pas Restart).
3. Vérifier :
   ```bash
   curl -sS https://<host>/api/health
   # login admin, une simulation, dernier SyncLog
   ```

### 3.4 Post-restore

- [ ] `MIGRATION_LOCKED` cohérent avec l’état métier (prod = `true`)
- [ ] Celery beat actif ; sync Odoo pas en double manuel immédiat
- [ ] Uptime monitoring rebranché sur le nouveau host si DNS a changé
- [ ] Ancien VPS isolé / détruit après validation

---

## 4. Restauration partielle (BDD seule sur le même host)

Cas fréquent après incident applicatif (pas de perte VPS) :

```bash
# 1. Dump de sécurité de l’état cassé
docker exec "$PG" pg_dump -U postgres -Fc postgres > ~/avant_restore_$(date +%F).dump

# 2. Restore du dump S3 (cf. §3.2)

# 3. Redeploy app
```

Utilisé aussi avant une bascule Odoo → [`bascule-odoo-prod.md`](bascule-odoo-prod.md) §1.

---

## 5. Ce que ce runbook ne couvre pas

- Point-in-time recovery (WAL) — hors MVP1
- Réplication hot standby — hors MVP1
- Restauration « Storage Supabase » — **N/A** (pas de stack Supabase)

---

## 6. Critère « testé une fois »

À cocher lors du prochain exercice DR :

- [ ] Backup cron produit un dump listable (`pg_restore --list`)
- [ ] Restore sur staging / env jetable → `/api/health` OK + login OK
- [ ] Durée mesurée &lt; RTO 4 h
