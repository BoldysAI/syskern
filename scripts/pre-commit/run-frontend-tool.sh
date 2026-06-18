#!/usr/bin/env bash
# Wrapper called by pre-commit for frontend hooks (eslint, prettier).
#
# pre-commit passes file paths relative to the repo root (e.g.
# `frontend/src/app/page.tsx`). The frontend tools expect paths relative
# to the frontend directory because they're run with `frontend/` as cwd
# (so their flat config + tsconfig + node_modules resolve correctly).
#
# Usage: run-frontend-tool.sh <tool> <file>...
#   tool ∈ { eslint, prettier }

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $(basename "$0") <tool> <file>..." >&2
  exit 2
fi

tool="$1"
shift

# Strip the leading "frontend/" from every file path.
declare -a stripped=()
for f in "$@"; do
  stripped+=("${f#frontend/}")
done

# Quietly exit 0 if no files survived the strip (defensive).
if [[ ${#stripped[@]} -eq 0 ]]; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel)/frontend"

case "$tool" in
  eslint)
    exec npx --no-install eslint --max-warnings=0 "${stripped[@]}"
    ;;
  prettier)
    exec npx --no-install prettier --write "${stripped[@]}"
    ;;
  *)
    echo "unknown tool: $tool" >&2
    exit 2
    ;;
esac
