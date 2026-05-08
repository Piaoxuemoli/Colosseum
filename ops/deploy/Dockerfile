# Multi-stage build for Colosseum Next.js app.
#
# Stages:
#   deps    — install production-required node_modules (via npm ci)
#   builder — run `next build` to generate .next-build/standalone + static
#   runner  — minimal image with just the standalone output + drizzle-kit
#             for migrations + better-sqlite3 rebuilt for Alpine musl
#
# SQLite is used in production (same schema as dev) and persisted to the
# /data volume via DB_DRIVER=sqlite + SQLITE_PATH=/data/arena.db.

FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3 needs python / build toolchain to rebuild its native binding
# against Alpine's musl libc.
RUN apk add --no-cache libc6-compat python3 make g++ sqlite
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++ sqlite
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build the Next standalone server + static chunks.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# sqlite CLI is handy for ad-hoc debugging inside the container.
RUN apk add --no-cache libc6-compat sqlite

# Non-root user to run the server.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Next standalone server (already tree-shaken node_modules subset).
COPY --from=builder --chown=nextjs:nodejs /app/.next-build/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next-build/static ./.next-build/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# drizzle-kit + the full drizzle-orm runtime are not included in the standalone
# bundle because they're never imported from any route; we need them at
# startup to run migrations, so copy them explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/zod ./node_modules/zod

# Schema + migrations + drizzle config must be present at runtime for
# drizzle-kit migrate to apply deltas.
COPY --from=builder --chown=nextjs:nodejs /app/lib/db ./lib/db
COPY --from=builder --chown=nextjs:nodejs /app/lib/env.ts ./lib/env.ts
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

# Entrypoint runs migrate then hands off to the Next server.
COPY --chown=nextjs:nodejs ops/deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Prepare data dir owned by nextjs for SQLite volume mount.
RUN mkdir -p /data && chown nextjs:nodejs /data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["/entrypoint.sh"]
