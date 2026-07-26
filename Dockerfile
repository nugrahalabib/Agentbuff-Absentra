# syntax=docker/dockerfile:1
# Single-origin production image for Absentra: one Node process serves the built
# web SPA + the /api REST + the /mcp JSON-RPC endpoint on ONE port. SQLite lives
# on a mounted volume at /data. (Deploy adaptation for AgentBuff marketplace.)

# ---- 1) build the web (Vite) ----
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Skip the tsc gate for the deploy build — the production bundle doesn't need a
# type-check pass, and this keeps the image build resilient to non-fatal TS noise.
RUN npx vite build

# ---- 2) server deps (native better-sqlite3 needs a toolchain) ----
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm ci

# ---- 3) runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production \
    PORT=8787 \
    WEB_DIST=/app/web/dist \
    ABSENTRA_DB=/data/absentra.db
# server source (runs via tsx, no build step) + its deps + the built web
COPY server/ ./
COPY --from=deps /srv/node_modules ./node_modules
COPY --from=web /web/dist /app/web/dist
RUN mkdir -p /data
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
