# API OpenAPI — drf-spectacular

La spécification OpenAPI 3 est **générée automatiquement** depuis les
viewsets / serializers DRF. Pas de maintenance manuelle du contrat.

---

## Accès live

| URL | Contenu |
|---|---|
| `/api/docs/` | Swagger UI |
| `/api/schema/` | Schéma brut (YAML/JSON selon `Accept`) |
| `/api/health` | Healthcheck (hors schéma métier) |

Local : http://127.0.0.1:8000/api/docs/

Config : `SPECTACULAR_SETTINGS` dans `backend/config/settings/base.py` ;
routes dans `backend/config/urls.py`.

---

## Export versionné (ce dossier)

Régénérer le fichier commité (depuis la racine du repo) :

```bash
# Recommandé — uv / venv local (Django settings local)
cd backend && uv run python manage.py spectacular \
  --file ../docs/api/openapi.yaml --validate

# Via container (si le backend tourne) — copier hors du conteneur :
docker compose exec backend python manage.py spectacular \
  --file /tmp/openapi.yaml --validate
docker compose cp backend:/tmp/openapi.yaml docs/api/openapi.yaml
```

`spectacular --validate` peut émettre des warnings (authenticator custom,
APIView sans `serializer_class`) : le schéma reste généré ; corriger au fil
de l’eau avec `@extend_schema` si besoin.

Le fichier [`openapi.yaml`](openapi.yaml) permet revue hors serveur et
génération de clients. **Source de vérité runtime** = endpoint live
(re-générer après tout changement d’API).

---

## Auth dans le schéma

L’API métier utilise la **session Django** (cookie) après
`POST /api/auth/login`. Dans Swagger UI : se connecter via l’app ou
utiliser la session navigateur sur la même origine ; les endpoints
protégés renvoient 403 sans session.

Messages d’erreur utilisateur : **français** (convention projet).

---

## Périmètre documenté

Toutes les routes montées sous `/api/` (products, attributes, suppliers,
clients, market, simulations, offers, documents, i18n, odoo_sync,
migration quarantine, accounts, tasks, …). Détail tags = Swagger UI.
