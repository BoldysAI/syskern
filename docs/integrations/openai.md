# Intégration OpenAI (argumentaires offres) — CDC §7

Client : `backend/apps/offers/services/openai_client.py` (`OpenAIClient`).
Utilisé par la génération d’offres projet (`ai_arguments`, `project_generator`)
dans des tâches Celery — pas dans le thread requête HTTP.

---

## Contrat

| Élément | Valeur |
|---|---|
| Base | `https://api.openai.com/v1` |
| Auth | `Authorization: Bearer <OPENAI_API_KEY>` |
| Modèle défaut | `gpt-4o-mini` (`OPENAI_MODEL` pour override) |
| Timeout | 60 s |

### Méthodes

| Méthode | Rôle |
|---|---|
| `generate_copy(system=, user=, temperature=0.3) -> str` | Chat completion texte |
| `generate_json(system=, user=, …) -> dict` | `response_format: json_object` + parse |

Fail-closed si clé absente → `OpenAIError`.

Erreurs HTTP non-200 → `OpenAIError` avec corps tronqué (`[:200]`).

---

## Rôle dans le flux offre projet

1. OpenAI rédige les sections argumentaires **dans la langue cible**.
2. Gamma reçoit le markdown + `textOptions.language` (pas de passe DeepL
   obligatoire sur ce flux — cf. [`gamma.md`](gamma.md)).

---

## Config

```bash
OPENAI_API_KEY=
# OPENAI_MODEL=gpt-4o-mini
```

Secrets : Coolify / `.env` local — jamais commités. Redaction logs :
filtre `SensitiveDataFilter` (masque `sk-…`).

---

## Ops

- Coût / quotas : console OpenAI (hors plateforme).
- En cas d’échec pendant `run_generation` : l’offre passe
  `generation_status=error` ; retry `POST /api/offers/{id}/regenerate/`.
