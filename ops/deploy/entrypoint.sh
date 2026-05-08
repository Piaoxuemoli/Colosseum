#!/bin/sh
# Entrypoint for the Colosseum runner container.
#
# Runs drizzle-kit migrate against the SQLite DB at $SQLITE_PATH, then execs
# the Next standalone server (server.js at the working dir root).
#
# All paths are baked in at build time by the Dockerfile.

set -e

DB_PATH="${SQLITE_PATH:-/data/arena.db}"

echo "[entrypoint] DB_DRIVER=${DB_DRIVER:-sqlite}"
echo "[entrypoint] SQLITE_PATH=${DB_PATH}"

# Ensure the directory exists + is writable; useful on first run when the
# volume is still empty.
mkdir -p "$(dirname "$DB_PATH")"

echo "[entrypoint] running drizzle-kit migrate..."
# drizzle-kit 0.31 migrate CLI.
node ./node_modules/drizzle-kit/bin.cjs migrate --config drizzle.config.ts

echo "[entrypoint] starting nextjs standalone server..."
exec node server.js
