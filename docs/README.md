# Documentation technique — Syskern Pricing Platform

Documentation **humaine / ops** pour Boldys et Karim : reprise du projet,
architecture, runbooks, intégrations, OpenAPI.

> **Distinct des playbooks agents** (`docs/agent/`) — ceux-ci guident les
> agents IA et les conventions de code. Ici : onboarding, exploitation, reprise.

## Index

| Document | Contenu |
|---|---|
| [../README.md](../README.md) | Présentation, prérequis, setup local &lt; 1 h, commandes |
| [architecture.md](architecture.md) | Schéma global, choix techniques, liens CDC |
| [odoo-mapping.md](odoo-mapping.md) | Mapping champs Odoo ↔ plateforme (spike ODO-1) |
| [api/](api/) | OpenAPI (drf-spectacular) — live `/api/docs/` + export |
| [integrations/database.md](integrations/database.md) | PostgreSQL local / prod |
| [integrations/gamma.md](integrations/gamma.md) | Génération devis projet Gamma |
| [integrations/deepl.md](integrations/deepl.md) | Traduction DeepL |
| [integrations/openai.md](integrations/openai.md) | Argumentaires offres (OpenAI) |

### Runbooks

| Runbook | Quand |
|---|---|
| [runbooks/vps-setup.md](runbooks/vps-setup.md) | Provisionner / déployer sur VPS OVH + Coolify |
| [runbooks/restore.md](runbooks/restore.md) | Restaurer un backup Postgres (+ .env) |
| [runbooks/migration.md](runbooks/migration.md) | Migration initiale one-shot (CDC §8) |
| [runbooks/migration-reset.md](runbooks/migration-reset.md) | Reset destructif pré-prod |
| [runbooks/odoo-sync-troubleshooting.md](runbooks/odoo-sync-troubleshooting.md) | Sync Odoo en panne |
| [runbooks/bascule-odoo-prod.md](runbooks/bascule-odoo-prod.md) | Changer d’instance Odoo en prod |
| [runbooks/monitoring.md](runbooks/monitoring.md) | Health, logs, uptime, SMTP |

### Spécification métier

| Document | Rôle |
|---|---|
| [Cahier des charges technique — Pricing Platform MVP1.md](Cahier%20des%20charges%20technique%20—%20Pricing%20Platform%20MVP1.md) | CDC (spec de départ) |
| [agent/decisions.md](agent/decisions.md) | Écarts assumés au CDC (append-only) |

**Règle** : le **code** + `decisions.md` font foi quand le CDC diverge
(ex. auth users+rôles, Postgres classique sans projet Supabase, Traefik/Coolify
plutôt que Nginx+Supabase self-host).
