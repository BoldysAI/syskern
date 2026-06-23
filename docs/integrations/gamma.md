# Intégration Gamma (génération de devis projet) — CDC §7.3 / §7.7

Client : `backend/apps/offers/services/gamma.py` (`GammaClient`, httpx sync).
Utilisé par le générateur d'offre projet (`project_generator.run_generation`)
exécuté dans une tâche Celery (AGENTS.md §4).

## Contrat API (vérifié 2026-06)

- **Base** : `https://public-api.gamma.app`
- **Auth** : header `X-API-KEY: <clé>` (⚠️ **pas** `Bearer`) + `Content-Type: application/json`.
  Clé dans `GAMMA_API_KEY` (`.env`, jamais commitée).
- **Créer** : `POST /v1.0/generations` → `{ "generationId": "...", "warnings": "..."? }`
- **Statut** : `GET /v1.0/generations/{id}` → `{ status: "pending"|"completed"|"failed",
  gammaUrl, exportUrl, error{message,statusCode}, credits{deducted,remaining} }`
- **Async** : la génération prend 1-3 min ; on poll toutes les ~5 s (`generate_and_wait`).
- **Facturation** : plan Pro/Ultra/Teams/Business requis ; **1-3 crédits/carte** (+ images).
  Une génération minimale (1 carte, `imageOptions.source="noImages"`) ≈ 3 crédits.

### Champs de payload utilisés

`inputText` (markdown des 5 sections + tableau de prix), `textMode="preserve"`
(on garde notre contenu structuré), `format="presentation"`, `numCards` (= sections
activées), `title`, `exportAs="pdf"`, `textOptions.{language,amount}`,
`imageOptions.source`, `additionalInstructions` (instructions IA libres, ≤5000),
`themeId` (= `GAMMA_TEMPLATE_ID_DEVIS_PROJET` si défini — template Syskern modifiable
côté client, CDC §7.7.2).

## Méthodes

- `create_generation(payload) -> generationId`
- `get_generation(id) -> GammaGeneration`
- `generate_and_wait(payload, poll_interval=5, max_wait=300) -> GammaGeneration` — lève
  `GammaError` si `failed` ou timeout.
- `fetch_public_html(gamma_url) -> str|None` — snapshot HTML best-effort de la page
  publique (**il n'existe pas d'export HTML natif** ; `exportAs` = pdf/pptx/png — cf. note
  du ticket). Le PDF est dans `exportUrl` (signé, expire ~1 semaine).

## Gestion d'erreurs

- Retry **3×** avec backoff (2/4/8 s) sur 5xx et erreurs réseau ; **jamais** sur 4xx
  (payload invalide → `GammaError` immédiate). Timeout HTTP 60 s.
- Échec Gamma dans `run_generation` → l'offre passe `generation_status=error` +
  `generation_error` (l'offre + ses lignes existent déjà). Retry via
  `POST /api/offers/{id}/regenerate/` (CDC §7.6.3).

## Traduction (DeepL)

La sortie est générée **directement dans la langue cible** : OpenAI rédige les
argumentaires dans `language`, et `textOptions.language` passe la langue à Gamma. DeepL
n'est **pas** appelé ici (et l'abonnement DeepL n'est pas encore actif). Si une traduction
DeepL dédiée devient nécessaire, l'ajouter côté `services/translation.py`.

## Vérif live (2026-06-22)

`POST /v1.0/generations` (1 carte, noImages) → `status=completed`,
`gammaUrl` + `exportUrl` PDF, `credits.deducted=3`. Contrat confirmé.
