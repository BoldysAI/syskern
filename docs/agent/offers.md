# Playbook — Offres (CDC §7)

> App : `backend/apps/offers/`. Une offre dérive **toujours** d'une simulation
> `finalized` (`Offer.simulation`, `on_delete=PROTECT`). Deux types : `tariff`
> (multi-clients) et `project` (1 client, versionnable).

## Modèle (rappels)

- `Offer` : `offer_type`, `client_ids` (ArrayField), `currency`, `incoterm`, `language`,
  `valid_from`/`valid_to`, `export_format`, `status` (draft/sent/won/lost/expired),
  `generated_file_url` (URL du doc généré — **pas** `excel_file_path`), `version_number`,
  `previous_offer`.
- `OfferLine` : `final_price` (devise de l'offre), `discount_pct`, `quantity` (null pour tarif),
  `simulation_line` (FK — le snapshot vit dans `SimulationLine.product_snapshot`), `display_order`.

## Génération offre tarifaire Excel (§7.2)

- Endpoint : `POST /api/simulations/{id}/generate-tariff-offers/` (action `SimulationViewSet`).
  Garde : simulation `finalized` + type `tariff`, sinon **400**. Renvoie `202 + {task_id}`.
- Tâche : `offers/tasks.py:generate_tariff_offers_task(simulation_id, params)` — 1 offre + 1 Excel
  par client. `params` = {client_ids, columns, target_currency, language, expiration_date(ISO),
  incoterm(def EXW), label}. Résultat `{count, currency, offers:[{offer_id, client_id, file_url,
  line_count, total_amount_eur}]}`. Front poll `/api/tasks/{task_id}/`.
- Excel : `offers/services/excel.py`. `_COLUMN_REGISTRY` (clé → en-têtes FR/EN/ES + extracteur) ;
  `validate_columns`, `available_columns(lang)` ; `build_tariff_xlsx(...)`. En-têtes traduits en code
  (§10.5.4) ; note de taux si devise ≠ EUR (§7.2.5). Catalogue exposé via
  `GET /api/offers/tariff-columns/?lang=`.
- Conversion devise : **au moment de la génération** (§6.8.2), PV EUR → devise de vente via
  `apps.simulations.services.engine.context.fx_rate(...)` (pivot EUR — **ne pas dupliquer** le FX).
- Fichiers : `/tmp/syskern_exports/offers/{offer_id}.xlsx` (volume monté) ; téléchargement
  `GET /api/offers/{id}/download/` ; `Offer.generated_file_url` pointe dessus.
- UI : `frontend/src/app/offers/new-tariff/?simulation_id=` (wizard 5 étapes, dnd-kit pour l'ordre
  des colonnes, polling + écran de chargement). Calque les pages `/admin/*` (fetch direct + CSRF,
  pas `lib/api.ts`).

## Génération offre projet Gamma (§7.3)

- Endpoint : `POST /api/simulations/{id}/generate-project-offer/` (action `SimulationViewSet`).
  Garde : `finalized` + type `project`, sinon **400**. `202 + {task_id}`.
- Tâche : `offers/tasks.py:generate_project_offer_task(simulation_id, params)`.
  `params` = {client_id, project_name, quantities(sku->qty), language, expiration_date(ISO),
  ai_instructions, sections_config}. Retry : `POST /api/offers/{id}/regenerate/` →
  `regenerate_project_offer_task`.
- Orchestration : `services/project_generator.py`
  - `create_project_offer(...)` → Offer (type project, 1 client, EUR, devis_gamma) + OfferLines
    avec **quantités** (final_price = `SimulationLine.pv_eur`).
  - `run_generation(offer)` (retry-safe, lit tout depuis l'offre) → OpenAI args → payload Gamma
    5 sections → `gamma.generate_and_wait` → stocke `gamma_document_id`, `generated_file_url`
    (= gammaUrl), `project_info.gamma_export_url` (PDF), snapshot HTML best-effort.
- Argumentaires IA : `services/ai_arguments.py:generate_arguments(...)` (OpenAI `generate_json`,
  gpt-4o-mini configurable via `OPENAI_MODEL`, temp 0.7). 3 argumentaires {technical, commercial,
  logistic} dans la langue cible. **Échec OpenAI → None** (offre générée sans copy + warning).
  Cache par `instructions_hash` dans `Offer.ai_arguments` (réutilisé au retry).
- Statut génération : `Offer.generation_status` (pending/generating/ready/**error**) +
  `generation_error`. Gamma échoue → `error` + retry possible (l'offre + lignes persistent).
- Intégration Gamma : voir `docs/integrations/gamma.md` (contrat, crédits, erreurs).
- UI : `frontend/src/app/offers/new-project/?simulation_id=` (wizard 5 étapes : client+projet,
  quantités éditables, langue+expiration, sections, instructions IA ; poll long 1-3 min ;
  lien Gamma + bouton « Réessayer » sur erreur).

## Bibliothèque de documents (§7.4) — `apps/documents`

- Modèle `DocumentLibrary` : `name` (JSONB multilingue), `category`, `file_url` (chemin
  storage), `file_name`, `mime_type`, `language`, `product` (FK SET_NULL), `version`,
  `uploaded_by`, `is_active`, `deleted_at` (soft-delete).
- API (router `document-library`, **pas** `library`) :
  - `GET /api/document-library/?category=&language=&product=` (liste, défaut **actifs**)
  - `POST /api/document-library/upload/` (multipart) — valide **≤20 Mo** + types
    (PDF/JPG/PNG/DOCX/XLSX), **versionne** par (product, language, file_name), stocke via
    `default_storage` (local `MEDIA_ROOT/documents/<uuid>/`; prod → Supabase).
  - `GET /api/document-library/{id}/download/` — stream `FileResponse` ; `?inline=1` pour
    l'aperçu (PDF iframe / image).
  - `GET /api/document-library/{id}/versions/` — chaîne de versions.
  - `PATCH` (métadonnées seules — fichiers en read-only) ; `DELETE` = **soft-delete**
    (`is_active=False` + `deleted_at`, fichier conservé).
- Purge : tâche Celery **Beat** `documents.purge_deleted_documents` (04:00 UTC, migration
  `documents/0003`) — hard-delete fichier + ligne au-delà de **30 j** (≠ apscheduler du ticket).
- UI : `frontend/src/app/library/` (liste + filtres + modale upload drag-drop + aperçu +
  versions + soft-delete) ; entrée nav « Bibliothèque ».
- Storage = `default_storage` (local). Supabase Storage = prod (non câblé en local MVP1).

## Règles

- **Tout export/génération = Celery** (§4) : jamais de génération synchrone dans la requête.
- **Prix jamais recalculés ici** (§2) : on lit `SimulationLine.pv_eur` et on convertit la devise.
  Lignes sans `pv_eur` exclues (`final_price` NOT NULL).
- Après ajout/modif d'un `tasks.py`, **redémarrer `celery-worker`** (autodiscovery au boot).
- **Changement de clé/`.env` (GAMMA/OPENAI…)** : `docker compose restart` **ne recharge PAS** `env_file` → faire `docker compose up -d --force-recreate backend celery-worker`. Piège vécu : worker → « GAMMA_API_KEY is not configured » algré un `restart`. (`docker compose run --rm` lit `.env` à chaque fois, d'où des smokes OK mais un worker KO.)
- UI offres : `/offers` liste réelle (dashboard + filtres + actions download/Gamma/retry, auto-refresh SWR si une génération est en cours) ; bouton « Nouvelle offre » → sélection d'une simulation finalisée → wizard tarif/projet. `OfferListSerializer` expose `generation_status`/`generated_file_url`/`client_ids` pour les actions.
- `won`/`lost` réservés aux offres `project` ; versioning (`duplicate`) réservé aux `project`.
- Gamma/OpenAI/DeepL : `offers/services/{gamma,openai_client,translation}.py` (offres projet, §7.3).
