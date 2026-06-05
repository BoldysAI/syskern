#!/usr/bin/env bash
# Lance le serveur Django en dev (sans Docker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.local}"
# Variables lues depuis backend/.env par django-environ (config/settings/base.py).

if ! command -v uv >/dev/null 2>&1; then
  echo "Erreur : 'uv' introuvable. Installe-le : https://docs.astral.sh/uv/"
  exit 1
fi

echo "→ Backend Django sur http://127.0.0.1:8000"
echo "  Health : http://127.0.0.1:8000/api/health"
echo "  Docs   : http://127.0.0.1:8000/api/docs/"
echo ""

exec uv run python manage.py runserver 127.0.0.1:8000
