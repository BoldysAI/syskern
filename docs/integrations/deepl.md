# Intégration DeepL (traduction) — CDC §10.4

Client HTTP : `backend/apps/offers/services/translation.py` (`DeepLClient`).
Couche cache / API : `apps.i18n` (`translate_cached`, `POST /api/translate`,
purge cron). Playbook agents → `docs/agent/i18n.md`.

---

## Contrat

| Élément | Valeur |
|---|---|
| Auth | Header `Authorization: DeepL-Auth-Key <DEEPL_API_KEY>` |
| Free | clé `*:fx` → `https://api-free.deepl.com/v2` |
| Pro | `https://api.deepl.com/v2` |
| Override | `DEEPL_API_URL` |
| Timeout | 10 s · retries 5xx : 2 × backoff |
| Limite texte | 5000 caractères (rejet avant appel) |

**Ne pas** envoyer `auth_key` en form-field (obsolète → 403).

### Comportement CDC

- `formality=more` + `preserve_formatting` quand la langue cible le permet
  (FR, ES, DE, … — **pas** EN).
- Post-traitement casing : `apply_source_casing` aligne Title Case / ALL CAPS
  source → traduction.
- Quota `456` → erreur dédiée ; auth fail → log + email
  `TRANSLATION_AUTH_ALERT_RECIPIENTS`.

### Méthodes

- `translate(text, source_lang, target_lang) -> str`
- `translate_batch(...)` — multi-textes

---

## Cache

Deux couches :

1. Table **`translation_cache`** (TTL `TRANSLATION_CACHE_TTL_DAYS`, défaut 90 j)
   — read-through via `apps.i18n.services.translate_cached`.
2. JSONB `Product.description_*` — bulk ne remplit que les langues vides.

Toujours passer par `apps.i18n` hors du package `offers` (quota + cache).

---

## Async vs sync

| Cas | Chemin |
|---|---|
| Bulk multi-produits | Tâche Celery (`products/tasks` / i18n) |
| `POST /api/translate` court | Sync dans le thread requête (écart assumé, `decisions.md`) |

---

## Config

```bash
DEEPL_API_KEY=
# DEEPL_API_URL=https://api-free.deepl.com/v2
TRANSLATION_CACHE_TTL_DAYS=90
TRANSLATION_AUTH_ALERT_RECIPIENTS=yassine@boldys.ai,karim@boldys.ai
```

Sans clé : fail-closed (`TranslationError` / config).

---

## Vérifs ops

```bash
# Health DeepL non inclus dans /api/health — tester via translate ou shell :
docker compose exec backend python manage.py shell -c "
from apps.offers.services.translation import DeepLClient
print(DeepLClient().translate(text='câble', source_lang='FR', target_lang='EN-GB')[:80])
"
```
