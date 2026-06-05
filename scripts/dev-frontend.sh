#!/usr/bin/env bash
# Lance Next.js en dev (proxy /api → backend local).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

export BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

if [[ ! -d node_modules ]]; then
  echo "→ Installation des dépendances npm…"
  npm ci
fi

echo "→ Frontend Next.js sur http://localhost:3000"
echo "  API proxy → ${BACKEND_URL}/api/*"
echo ""

exec npm run dev
