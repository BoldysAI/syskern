# docs/agent/decisions.md — Journal de décisions (append-only)

> ADR-lite. Append uniquement, daté. N'écrase jamais une entrée. Format : date · décision · raison.
> [P] = décision projet · [T] = décision outillage/agents.
> **C'est ici qu'on documente toute déviation au CDC** (cf. `/AGENTS.md` §2). Une déviation documentée = décision assumée ; une déviation non documentée = dérive à corriger.

## 2026-06-04 · [P] Stack backend = Django 5 + DRF (migration depuis FastAPI)
Validé par toutes les parties. Le code et `pyproject.toml` font foi. Le CDC markdown contient encore des mentions FastAPI obsolètes → ignorer / resynchroniser séparément.

## 2026-06-04 · [P] Gestion des dépendances = uv
Deps dans `backend/pyproject.toml`, lock dans `uv.lock`. Pas de pip/requirements.txt.

## 2026-06-04 · [T] Framework agents = 2 couches
`/AGENTS.md` (transverse, chargé à chaque call, ~200 lignes) + `docs/agent/*.md` (playbooks à la demande). Pas d'`AGENTS.md` imbriqués backend/frontend : Cursor ne les charge pas de façon fiable, et multiplier les fichiers fragilise la boucle full-auto.

## 2026-06-04 · [T] CLAUDE.md = import d'AGENTS.md
`/CLAUDE.md` contient `@AGENTS.md`. Source unique, lue par Cursor et Claude Code.

## 2026-06-04 · [T] Living docs en full-auto
L'agent met à jour `docs/agent/*.md` directement, sans gate. Décisions d'archi → ce fichier (append-only) pour survivre au multi-agent / multi-branche.

## 2026-06-04 · [T] Suppression de frontend/AGENTS.md + frontend/CLAUDE.md
Stub auto-injecté par un codemod Next.js. Conventions front déplacées dans `docs/agent/frontend.md`. Peut réapparaître si un codemod Next est relancé.

## 2026-06-04 · [P] Auth = vrais users + rôles (écart assumé au CDC §9.1)
Le CDC §9.1 prévoyait un **mot de passe unique partagé** sans gestion d'utilisateurs en MVP1. Le code a finalement implémenté une **auth utilisateurs réelle** : `User` Django + `apps.accounts.Profile` (rôles `admin`/`commercial`/`viewer`), login session (`core.views.login_view`), CRUD users admin-only (`apps.accounts`), et côté front `lib/auth.ts` + `/admin/users`. Décision : **le code fait foi**, cet écart au CDC est assumé. Le module shared-password (`core.permissions` : `AppPasswordAuthentication`, `SharedPasswordRequired`, `validate_app_password`) et le setting `APP_PASSWORD` sont du **code mort** → retirés. Prod cible inchangée : Supabase Auth JWT (stub, cf. `production.py`).