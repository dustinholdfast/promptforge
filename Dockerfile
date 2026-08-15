# syntax=docker/dockerfile:1

# PromptForge runs on Cloudflare Workers (vinext + @cloudflare/vite-plugin).
# `vinext start` (the Node prod server) invokes the worker with `env = undefined`,
# so it provides NO Cloudflare bindings — the app needs `env.DB` (D1) and the
# provider-key vars, which only exist under the workerd runtime. The container
# therefore serves the *built* worker through `wrangler dev --local`, which gives
# it a local D1 database (miniflare, persisted to disk) and injects env vars as
# Worker bindings. workerd links against glibc, so the base image is Debian slim,
# not Alpine/musl.

ARG NODE_VERSION=22

# ---- Builder: install the locked dependency tree and build the worker bundle ----
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app

# Install dependencies from the lockfile first so this layer caches until the
# lockfile changes. Dev dependencies (vite, vinext, wrangler, workerd) are
# required to build.
COPY package.json package-lock.json ./
RUN npm ci

# Build the app. This emits dist/, including dist/server/wrangler.json — the
# wrangler config (with the DB binding and assets dir) used to serve at runtime.
COPY . .
RUN npm run build

# ---- Runtime: serve the built worker under workerd via wrangler ----
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    # Wrangler must not phone home or prompt for telemetry in a container.
    WRANGLER_SEND_METRICS=false \
    # Keep wrangler's logs inside the app dir (writable by the app user).
    WRANGLER_LOG_PATH=/app/.wrangler/logs

# Copy the resolved dependency tree (includes wrangler + the platform workerd
# binary) and the build output. Reusing the builder's node_modules keeps the
# runtime pinned to the exact locked versions instead of a second install.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Entrypoint that translates container env vars into the Worker's `.dev.vars`
# bindings before starting wrangler (see the script for why this is needed).
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Local D1 / miniflare state lives under .wrangler/state; declare it a volume so
# a clean checkout can be stopped and restarted without losing its database.
# Run as an unprivileged user that owns the writable app tree.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/.wrangler/state /app/.wrangler/logs \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8787

# The entrypoint forwards allowlisted env vars into the Worker's `.dev.vars`,
# then execs the CMD below. Invoked via `sh` so a lost exec bit (e.g. a Windows
# checkout) can't break startup.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]

# Serve the built worker locally: --local runs workerd + miniflare (real D1
# binding), --persist-to keeps the database on the mounted volume, and binding
# to 0.0.0.0 makes it reachable from outside the container.
CMD ["node_modules/.bin/wrangler", "dev", \
     "-c", "dist/server/wrangler.json", \
     "--local", \
     "--ip", "0.0.0.0", \
     "--port", "8787", \
     "--persist-to", "/app/.wrangler/state"]
