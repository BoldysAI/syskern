#!/usr/bin/env bash
# Backup quotidien Postgres → disque local (+ option S3).
# CDC §9.4 adapté : Postgres classique (pas de Storage Supabase).
#
# Cron suggéré (VPS, 02:00 UTC) :
#   0 2 * * * /opt/syskern/infra/backup.sh >> /var/log/syskern-pricing/backup.log 2>&1
#
# Prérequis : pg_dump, aws CLI ou rclone (si S3_BUCKET défini), gpg (si ENV_FILE).
set -euo pipefail

DATE="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/syskern-pricing}"
S3_BUCKET="${S3_BUCKET:-}"          # ex. s3://syskern-pricing-backups
RETENTION_DAYS="${RETENTION_DAYS:-7}"
ENV_FILE="${ENV_FILE:-}"            # chemin .env à chiffrer (optionnel)
GPG_RECIPIENT="${GPG_RECIPIENT:-backup@boldys.ai}"
ALERT_EMAIL="${ALERT_EMAIL:-yassine@boldys.ai,karim@boldys.ai}"

mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/db_$DATE.dump"

fail() {
  echo "ERROR: $*" >&2
  if command -v mail >/dev/null 2>&1; then
    echo "$*" | mail -s "[syskern] backup FAILED" "$ALERT_EMAIL" || true
  fi
  exit 1
}

# ── 1. Dump Postgres ──────────────────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump -Fc -d "$DATABASE_URL" -f "$DUMP" || fail "pg_dump failed"
elif [[ -n "${PGHOST:-}" ]]; then
  pg_dump -Fc -h "$PGHOST" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -f "$DUMP" \
    || fail "pg_dump failed"
else
  fail "Set DATABASE_URL or PGHOST/PGUSER/PGDATABASE"
fi

# ── 2. Vérification cohérence ────────────────────────────────────────────────
pg_restore --list "$DUMP" >/dev/null || fail "pg_restore --list failed on $DUMP"
ln -sfn "$DUMP" "$BACKUP_DIR/db_latest.dump"

# ── 3. .env chiffré (optionnel) ───────────────────────────────────────────────
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  gpg --batch --yes --encrypt --recipient "$GPG_RECIPIENT" \
    -o "$BACKUP_DIR/env_$DATE.gpg" "$ENV_FILE" || fail "gpg encrypt failed"
fi

# ── 4. Upload S3 (optionnel) ─────────────────────────────────────────────────
if [[ -n "$S3_BUCKET" ]]; then
  if command -v aws >/dev/null 2>&1; then
    aws s3 sync "$BACKUP_DIR" "$S3_BUCKET/$DATE/" --exclude '*' --include "db_$DATE.dump" \
      --include "env_$DATE.gpg" || fail "aws s3 sync failed"
  elif command -v rclone >/dev/null 2>&1; then
    rclone copy "$DUMP" "$S3_BUCKET/$DATE/" || fail "rclone copy failed"
  else
    fail "S3_BUCKET set but neither aws nor rclone found"
  fi
fi

# ── 5. Rétention locale ───────────────────────────────────────────────────────
find "$BACKUP_DIR" -name 'db_*.dump' -mtime "+$RETENTION_DAYS" -delete || true
find "$BACKUP_DIR" -name 'env_*.gpg' -mtime "+$RETENTION_DAYS" -delete || true

echo "OK backup $DATE → $DUMP"
