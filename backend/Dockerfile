# Multi-stage Dockerfile for the Syskern backend.
#   - dev:  hot-reloaded Django dev server, source mounted as a volume
#   - prod: gunicorn behind a reverse proxy, source baked into the image

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


# ─── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .


# ─── dev ───────────────────────────────────────────────────────────────────
FROM deps AS dev

RUN pip install ".[dev]"
COPY . .
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]


# ─── prod ──────────────────────────────────────────────────────────────────
FROM deps AS prod

COPY . .
RUN python manage.py collectstatic --noinput || true

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
