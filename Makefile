# Syskern — top-level Makefile
# One command to set up a fresh clone, plus daily quality shortcuts.
#
# Usage:
#   make setup        # full local install (Python deps + Node deps + pre-commit hooks)
#   make hooks        # (re)install the git hooks only
#   make lint         # ruff (backend) + eslint (frontend) — no fixes, just check
#   make fmt          # ruff format + prettier write (applies fixes)
#   make test         # pytest backend
#   make typecheck    # mypy backend + tsc --noEmit frontend
#   make up           # docker compose up (full local stack)
#   make down         # docker compose down

SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

PYTHON ?= python3
PIP ?= pip3

# ─── Help (default) ──────────────────────────────────────────────────────────
.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"; printf "Available targets:\n"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─── Setup ───────────────────────────────────────────────────────────────────
.PHONY: setup
setup: backend-deps frontend-deps tooling hooks env-templates ## Full local install (deps + git hooks + .env templates)
	@echo ""
	@echo "✅ Setup done."
	@echo "   Next: copy backend/.env.example → backend/.env and tweak values,"
	@echo "         then run \`make up\` to start the full stack."

.PHONY: backend-deps
backend-deps: ## Install backend Python deps (uv if available, else pip)
	@if command -v uv >/dev/null 2>&1; then \
		echo "→ uv sync (backend)"; \
		cd backend && uv sync --extra dev; \
	else \
		echo "→ pip install (backend)"; \
		cd backend && $(PIP) install -e ".[dev]"; \
	fi

.PHONY: frontend-deps
frontend-deps: ## Install frontend Node deps (npm ci)
	@echo "→ npm ci (frontend)"
	cd frontend && npm ci

.PHONY: tooling
tooling: ## Install repo-level Python tooling (pre-commit, commitizen, detect-secrets)
	@echo "→ install pre-commit + commitizen + detect-secrets"
	@$(PIP) install --upgrade --user pre-commit commitizen detect-secrets

.PHONY: hooks
hooks: ## Install git hooks (pre-commit + commit-msg)
	@echo "→ pre-commit install"
	@pre-commit install --install-hooks --hook-type pre-commit --hook-type commit-msg

.PHONY: env-templates
env-templates: ## Copy missing .env from .env.example
	@if [ ! -f backend/.env ]; then \
		cp backend/.env.example backend/.env && echo "  → backend/.env created from example"; \
	else \
		echo "  → backend/.env already exists, skipping"; \
	fi
	@if [ ! -f frontend/.env.local ]; then \
		cp frontend/.env.example frontend/.env.local && echo "  → frontend/.env.local created from example"; \
	else \
		echo "  → frontend/.env.local already exists, skipping"; \
	fi

# ─── Quality ─────────────────────────────────────────────────────────────────
.PHONY: lint
lint: lint-backend lint-frontend ## Run all linters (no fixes)

.PHONY: lint-backend
lint-backend:
	cd backend && ruff check . && ruff format --check .

.PHONY: lint-frontend
lint-frontend:
	cd frontend && npx eslint --max-warnings=0 src

.PHONY: fmt
fmt: fmt-backend fmt-frontend ## Apply formatting fixes (ruff format + prettier)

.PHONY: fmt-backend
fmt-backend:
	cd backend && ruff check --fix . && ruff format .

.PHONY: fmt-frontend
fmt-frontend:
	cd frontend && npx prettier --write "src/**/*.{ts,tsx,js,jsx,json,css,md}"

.PHONY: typecheck
typecheck: ## mypy backend + tsc frontend
	cd backend && mypy .
	cd frontend && npx tsc --noEmit

.PHONY: test
test: ## pytest backend
	cd backend && pytest

.PHONY: pre-commit
pre-commit: ## Run all pre-commit hooks against every file (sanity check)
	pre-commit run --all-files

# ─── Docker ──────────────────────────────────────────────────────────────────
.PHONY: up
up: ## Start the full local stack (Postgres + Redis + backend + worker + beat + frontend)
	docker compose up -d
	@echo "Backend  → http://localhost:8000  Frontend → http://localhost:3000"

.PHONY: down
down: ## Stop the local stack
	docker compose down

.PHONY: logs
logs: ## Tail logs of the running stack
	docker compose logs -f
