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

## Règles

- **Tout export/génération = Celery** (§4) : jamais de génération synchrone dans la requête.
- **Prix jamais recalculés ici** (§2) : on lit `SimulationLine.pv_eur` et on convertit la devise.
  Lignes sans `pv_eur` exclues (`final_price` NOT NULL).
- Après ajout/modif d'un `tasks.py`, **redémarrer `celery-worker`** (autodiscovery au boot).
- `won`/`lost` réservés aux offres `project` ; versioning (`duplicate`) réservé aux `project`.
- Gamma/OpenAI/DeepL : `offers/services/{gamma,openai_client,translation}.py` (offres projet, §7.3).
