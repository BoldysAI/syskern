# Runbook — Monitoring & logs (CDC §9.6)

> Monitoring **minimal MVP1** : savoir que la plateforme tourne, garder les logs
> propres, ne jamais fuiter de secret. Pas de métriques applicatives (CPU/RAM/
> latences) ni de centralisation externe (Datadog/Loki) — reporté MVP2.

## 1. Health endpoint

- **`GET /api/health`** — public (hors auth), plain Django view (`apps/core/health.py`).
- `200 {"status":"ok","database":"ok"}` si le process tourne **et** que la BDD
  répond à un `SELECT 1`.
- `503 {"status":"error","database":"error","detail":"…"}` si la BDD est KO.
- Ne sonde **pas** les services externes (Odoo, Gamma, DeepL) — objectif : la
  plateforme elle-même, pas ses dépendances.
- Temps de réponse normal < 100 ms (mesuré ~47 ms en local).

```bash
curl -s -w "\n%{http_code} %{time_total}s\n" http://127.0.0.1:8000/api/health
```

Tests : `apps/core/tests/test_health.py` (200 OK, 503 BDD coupée, accès sans auth).

## 2. Uptime monitoring externe (manuel)

Service externe à configurer (UptimeRobot, BetterStack ou équivalent) — **pas de
code dans le repo**, c'est une config dans le tableau de bord du service.

| Réglage | Valeur |
|---|---|
| Type de check | HTTP(s) keyword/status |
| URL | `https://<domaine-prod>/api/health` |
| Mot-clé attendu (optionnel) | `"status": "ok"` (HTTP 200) |
| Fréquence | **5 min** |
| Seuil d'alerte | downtime > **5 min** (≈ 1 check raté + confirmation) |
| Canal | **Email** uniquement (pas de SMS/Slack en MVP1) |
| Destinataires | `yassine@boldys.ai`, `karim@boldys.ai` |

Vérification d'installation :
1. Couper le backend (`docker compose stop backend` en staging, ou arrêter le
   service systemd/Coolify en prod) → une alerte email doit arriver < 10 min.
2. Redémarrer → notification de résolution automatique.

> Les emails d'uptime sont envoyés par le **service externe**, pas par Django.
> L'envoi SMTP de Django (alertes offres, rapports migration) est traité §6.

## 3. Logs — emplacement & rotation

- Centralisation VPS : `/var/log/syskern-pricing/` (gunicorn/Django), plus
  `/var/log/nginx/` et `/var/log/postgresql/` pour leurs sources respectives.
- Rotation via **logrotate** : `infra/logrotate/syskern-pricing`.
  - Politique (toutes sources) : quotidienne, **rétention 30 j**, compression à
    **J+1** (`delaycompress`).
  - App + Postgres : `copytruncate`. Nginx : reopen via `USR1`.

Installation sur le VPS :
```bash
sudo cp infra/logrotate/syskern-pricing /etc/logrotate.d/syskern-pricing
sudo chown root:root /etc/logrotate.d/syskern-pricing && sudo chmod 0644 /etc/logrotate.d/syskern-pricing
logrotate -d /etc/logrotate.d/syskern-pricing     # dry-run : valide la config
logrotate -f /etc/logrotate.d/syskern-pricing     # force une rotation (test)
```

Notes :
- La stanza Postgres exige l'utilisateur système `postgres` (présent sur le VPS).
  Si Postgres tourne **en Docker**, ne pas la garder : utiliser plutôt le log
  driver Docker (`json-file` `max-size`/`max-file`).
- Historique de sync Odoo : **pas** un fichier log → table BDD `sync_logs`
  (CDC §5.4.3), hors logrotate.

## 4. Redaction des secrets dans les logs

Filtre `apps.core.logging.SensitiveDataFilter`, branché sur le handler `console`
dans `settings.LOGGING` (`filters: ["redact_secrets"]`). Masque par
`***REDACTED***` :

- En-têtes `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`
  (valeur entière, jusqu'à fin de ligne / guillemet fermant).
- Champs `password`, `passwd`, `secret`, `client_secret`, `token`,
  `access_token`, `refresh_token`, `api_key`, `apikey`, `x-api-key`.
- Formes brutes : `Bearer …`, `Basic …`, clés type `sk-…` (OpenAI).

**Ajouter un mot-clé sensible** → éditer `backend/apps/core/logging.py` :
- nouveau **champ** → `SENSITIVE_KEYS` ;
- nouvel **en-tête** → `SENSITIVE_HEADERS` ;
- nouvelle **forme de token** → un regex dans `SENSITIVE_PATTERNS`.

Vérification :
```bash
# unitaire
docker compose run --rm backend pytest apps/core/tests/test_logging_redaction.py -q
# manuelle sur logs réels — ne doit rien remonter de problématique
docker compose logs backend | grep -iE 'password|token|api_key|bearer|cookie' | grep -v REDACTED
```

Tests : `apps/core/tests/test_logging_redaction.py`.

## 5. Slow queries Postgres

`log_min_duration_statement = 500` (ms) → toute requête > 500 ms est loggée.

- Local : flag passé au conteneur dans `docker-compose.yml`
  (`command: postgres -c log_min_duration_statement=500`).
- Prod : même réglage dans `postgresql.conf` (puis `SELECT pg_reload_conf();`).

Vérification :
```bash
docker compose exec -T postgres psql -U syskern -d syskern -c "SELECT pg_sleep(0.6);"
docker compose logs postgres | grep -i "duration:"
# → LOG:  duration: 6xx.xxx ms  statement: SELECT pg_sleep(0.6);
```

## 6. Email sortant (Django) — compte `noreply@syskern.com`

Sert aux mails applicatifs : alerte d'expiration des offres (`offers.daily_expiration_check`,
CDC §7.5.4) et rapport de migration (`migration_report --email`).

- Fournisseur : **Microsoft 365** (MX `*.mail.protection.outlook.com`) →
  `smtp.office365.com:587` STARTTLS.
- Secrets dans `backend/.env` (gitignoré) — **jamais** commités. Placeholders
  dans `backend/.env.example`.

```dotenv
DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
DJANGO_DEFAULT_FROM_EMAIL=noreply@syskern.com
EMAIL_HOST=smtp.office365.com
EMAIL_PORT=587
EMAIL_HOST_USER=noreply@syskern.com
EMAIL_HOST_PASSWORD=********          # dans backend/.env uniquement
EMAIL_USE_TLS=true
```

Vérification (login SMTP sans envoyer, puis mail de test vers soi-même) :
```bash
# 1. Auth SMTP seulement (n'envoie rien)
docker compose run --rm backend python -c "from django.core.mail import get_connection; c=get_connection(); c.open(); print('SMTP OK'); c.close()"
# 2. Mail de test adressé au compte lui-même
docker compose run --rm backend python -c "from django.core.mail import send_mail; from django.conf import settings; print(send_mail('[Syskern] test', 'ok', settings.DEFAULT_FROM_EMAIL, ['noreply@syskern.com']))"
```

> ⚠️ Microsoft 365 peut désactiver l'**authentification SMTP** (basic auth) au
> niveau du tenant. Si l'étape 1 renvoie `SMTPAuthenticationError`, c'est un
> réglage côté admin M365 (activer « Authenticated SMTP » sur la boîte
> `noreply@`, ou utiliser un mot de passe d'application si MFA) — pas un bug de
> la plateforme.
