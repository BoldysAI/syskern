#!/usr/bin/env bash
# Worker Celery (tâches async : Odoo PAMP, DeepL, exports).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.local}"

if ! command -v uv >/dev/null 2>&1; then
  echo "Erreur : 'uv' introuvable."
  exit 1
fi

echo "→ Celery worker (broker: ${REDIS_URL:-redis://127.0.0.1:6379/0})"
echo ""

exec uv run celery -A config worker --loglevel=info --concurrency=2
