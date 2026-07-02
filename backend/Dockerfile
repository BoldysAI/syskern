# Syskern backend — Django web (gunicorn)
#
# Coolify deployment (Backend Web service):
#   • Build Pack:         Dockerfile
#   • Base Directory:     /backend
#   • Dockerfile:         Dockerfile
#   • Build target:       prod
#   • Port:               8000
#   • Required env:
#       DJANGO_SETTINGS_MODULE=config.settings.production
#       DJANGO_SECRET_KEY=<long-random-string>
#       DJANGO_ALLOWED_HOSTS=<your-backend-host>
#       DATABASE_URL=postgres://user:pass@host:5432/db
#       REDIS_URL=redis://host:6379/0
#       DEEPL_API_KEY=...        (optional)
#       ODOO_API_VERSION=v19     (optional)
#   • Healthcheck path:   GET /api/health
#
# `dev` target is used by docker-compose for local development.
# `prod` target is what Coolify builds.

ARG PYTHON_VERSION=3.12-slim-bookworm

# ─── base ──────────────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION} AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Non-root runtime user (used by `prod` and the worker/beat Dockerfiles).
RUN groupadd -r app && useradd -r -g app -u 1000 -d /app app

# ─── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

# ─── dev (docker-compose target) ──────────────────────────────────────────
FROM deps AS dev
RUN pip install ".[dev]"
COPY . .
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# ─── prod (Coolify backend web) ───────────────────────────────────────────
FROM deps AS prod

# App code + static collection. STATIC_ROOT must be configured in settings.
COPY --chown=app:app . .
RUN python manage.py collectstatic --noinput || true

USER app
EXPOSE 8000

ENV GUNICORN_WORKERS=3 \
    GUNICORN_TIMEOUT=60

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# migrate → one-shot idempotent catalog bootstrap (no-op if already loaded, or if
# the client Excel are absent from MIGRATION_SOURCES_DIR) → serve.
CMD ["sh", "-c", "python manage.py migrate --noinput && \
     python manage.py bootstrap_catalog && \
     gunicorn config.wsgi:application \
     --bind 0.0.0.0:8000 \
     --workers ${GUNICORN_WORKERS} \
     --timeout ${GUNICORN_TIMEOUT} \
     --access-logfile - \
     --error-logfile -"]
