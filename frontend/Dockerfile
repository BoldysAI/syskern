# Syskern frontend — Next.js 16 (standalone output)
#
# Coolify deployment (Frontend service):
#   • Build Pack:         Dockerfile
#   • Base Directory:     /frontend
#   • Dockerfile:         Dockerfile
#   • Build target:       prod
#   • Port:               3000
#   • Required env:       BACKEND_URL=https://<your-backend-host>
#                         NEXT_PUBLIC_API_URL=https://<your-backend-host>  (only if used client-side)

ARG NODE_VERSION=20-alpine

# ─── base ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache wget

# ─── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ─── dev (used by docker-compose) ─────────────────────────────────────────
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ─── builder ──────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they must
# be present during `next build` — Coolify must expose them as *build* variables
# (build args), not just runtime env. Without this, "Voir dans Odoo" is disabled
# in prod because ODOO_BASE_URL compiles to "".
ARG NEXT_PUBLIC_ODOO_BASE_URL=""
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_ODOO_BASE_URL=$NEXT_PUBLIC_ODOO_BASE_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── prod ─────────────────────────────────────────────────────────────────
FROM base AS prod
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Standalone output: minimal runtime, no node_modules copy needed.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
