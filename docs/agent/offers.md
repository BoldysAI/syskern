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
  par client. `params` = {client_ids, columns, target_currency, language, **language_per_client**,
  expiration_date(ISO), incoterm(def EXW), label}. Résultat `{count, currency, offers:[{offer_id,
  client_id, file_url, line_count, total_amount_eur}]}`. Front poll `/api/tasks/{task_id}/`.
- **Langue par client** (CDC §10.5) : si `language_per_client=true`, chaque offre =
  `client.preferred_language or language or "fr"` (résolu dans la tâche) ; sinon `language` unique.
  Wizard tarif : toggle « Langue par client ». Détail multilingue → `i18n.md`.
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
  `params` = {client_id, project_name, quantities?(sku->qty — **legacy optionnel**), language,
  expiration_date(ISO), ai_instructions, sections_config}. Retry : `POST /api/offers/{id}/regenerate/` →
  `regenerate_project_offer_task`.
- Orchestration : `services/project_generator.py`
  - `create_project_offer(...)` → Offer (type project, 1 client, EUR, devis_gamma) + OfferLines
    (final_price = `SimulationLine.pv_eur`). **Quantités (CDC Feedback 1)** : héritées de la simulation
    (`SimulationLine.quantity`, défaut 1 si non renseignée) — la quantité vit désormais sur la simulation
    Projet, plus sur l'offre. `quantities` reste accepté comme **override legacy** (prioritaire s'il est fourni).
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
  quantités **en lecture seule** (reprises de la simulation, CDC Feedback 1), langue+expiration, sections,
  instructions IA ; poll long 1-3 min ; lien Gamma + bouton « Réessayer » sur erreur).

## Langue cible & couverture i18n (§10.5)

- Résolution du contenu produit dans la langue cible avec **fallback FR** :
  `offers/services/offer_i18n.resolve_product_description` / `resolve_product_designation`
  (désignation Excel + tableau devis projet ; flag `fallback_used`, loggé à la génération via
  `_log_language_fallbacks`). Projet : le wizard pré-remplit la langue avec
  `client.preferred_language`.
- **Contrôle pré-génération** : `POST /api/simulations/{id}/offer-coverage-check/`
  (body `{language}` ou `{client_ids, language_per_client}`) → produits sans contenu cible.
  UI : `components/OfferCoverageWarning` dans les 2 wizards (warning + « Traduire automatiquement »
  = bulk translate puis re-check). Détail → `i18n.md`.

## Cycle de vie & suivi (§7.5 / §7.6)

- Statuts : `draft → sent → {won, lost}` ; `expired` (auto par cron). `won/lost` **projet uniquement**.
- `PATCH /api/offers/{id}/status/` — transitions validées par `ALLOWED_TRANSITIONS` (views.py).
  `draft→won` rejeté (passer par `sent`) ; tariff→won/lost rejeté. Pose `sent_at`/`won_at`/`lost_at`.
- `POST /api/offers/{id}/new-version/` (+ alias `duplicate`) — projet only ; crée V(n+1)
  (`previous_offer` + `version_number+1` + copie des lignes). `GET .../versions/` = chaîne complète.
- `POST /api/offers/{id}/extend-expiration/` `{new_date}` — date > **today+7** ; réactive
  une offre `expired` en `sent`.
- **Cron Celery Beat** `offers.daily_expiration_check` (08:00 UTC, migration `offers/0003`) :
  expire les `sent` dépassés (won/lost intacts) + email J-7 (liens
  `OFFER_FRONTEND_BASE_URL/offers/{id}`). Killswitch `EXPIRATION_CRON_ENABLED`. Email =
  `send_mail` (backend console en dev, SMTP en prod via `EMAIL_*`).
- **Destinataires de l'alerte = en base, éditables depuis l'UI** (pas en env) : modèle
  singleton `OfferAlertConfig` (`offers/0004`), `OfferAlertConfig.load()` ; endpoint
  `GET/PUT /api/offers/alert-settings` (serializer `OfferAlertConfigSerializer`, validation
  email). UI : Paramètres → onglet « Alertes offres ». Le cron lit `OfferAlertConfig.load()`.
- UI : `/offers` (liste + dashboard, label → détail) et `/offers/[id]` (header statut/version,
  infos + compte à rebours expiration, document download/Gamma, chaîne de versions, lignes lecture
  seule, actions cycle de vie : envoyer/gagner/perdre, prolonger, nouvelle version).
- **Liste `/offers`** : `DataTable` (`storageKey="offers-list"`) — colonnes label/type/clients/statut/
  validité/document ; `Card` wrapper ; `onRowClick` → détail ; KPI + `FilterSelect` inchangés.
  Pattern identique à `/simulator` et `/catalog` (pas de tri client, ordering API `-created_at`).
- **Bibliothèque `/library`** : `DataTable` (`storageKey="library-list"`) + actions en
  `renderTrailingCell` ; upload → `Dialog`, aperçu → `Sheet`, versions → `Dialog`.

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
