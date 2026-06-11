#!/usr/bin/env bash
# Configuration initiale pour le dev natif (sans Docker). À lancer une fois.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Syskern — setup dev natif ==="
echo ""

# ─── Services ───────────────────────────────────────────────────────────────
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
    echo "✓ Postgres répond sur 127.0.0.1:5432"
  else
    echo "✗ Postgres ne répond pas. Exemple macOS : brew services start postgresql@16"
    exit 1
  fi
else
  echo "⚠ pg_isready introuvable — assure-toi que Postgres tourne."
fi

if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "✓ Redis répond"
  else
    echo "✗ Redis ne répond pas. Exemple macOS : brew services start redis"
    exit 1
  fi
else
  echo "⚠ redis-cli introuvable — Celery/async ne marchera pas sans Redis."
fi

echo ""

# ─── Fichiers d'env ─────────────────────────────────────────────────────────
if [[ ! -f "$ROOT/backend/.env" ]]; then
  cp "$ROOT/backend/.env.native.example" "$ROOT/backend/.env"
  echo "✓ Créé backend/.env depuis .env.native.example"
else
  if grep -q '@postgres:' "$ROOT/backend/.env" 2>/dev/null; then
    echo "⚠ backend/.env utilise encore le host Docker 'postgres'."
    echo "  Remplace par 127.0.0.1 (voir backend/.env.native.example)."
  else
    echo "✓ backend/.env existe"
  fi
fi

if [[ ! -f "$ROOT/frontend/.env.local" ]]; then
  cp "$ROOT/frontend/.env.example" "$ROOT/frontend/.env.local"
  echo "✓ Créé frontend/.env.local"
else
  echo "✓ frontend/.env.local existe"
fi

echo ""

# ─── Dépendances ────────────────────────────────────────────────────────────
if ! command -v uv >/dev/null 2>&1; then
  echo "Erreur : installe uv — https://docs.astral.sh/uv/"
  exit 1
fi

echo "→ uv sync (backend)…"
(cd "$ROOT/backend" && uv sync --extra dev)

echo "→ npm ci (frontend)…"
(cd "$ROOT/frontend" && npm ci)

echo ""

# ─── Migrations ─────────────────────────────────────────────────────────────
echo "→ migrate…"
# Django charge backend/.env via django-environ — ne pas `source .env` (URLs / espaces cassent bash).
(cd "$ROOT/backend" && uv run python manage.py migrate)

echo ""
echo "=== Setup terminé ==="
echo ""
echo "Créer un utilisateur (si besoin) :"
echo "  cd backend && uv run python manage.py create_platform_user \\"
echo "    --email toi@example.com --password secret --role admin"
echo ""
echo "Lancer ensuite dans 2 terminaux :"
echo "  ./scripts/dev-backend.sh"
echo "  ./scripts/dev-frontend.sh"
echo ""
echo "Optionnel (Celery) : ./scripts/dev-celery.sh"
echo "Guide complet : docs/agent/local-dev.md"
