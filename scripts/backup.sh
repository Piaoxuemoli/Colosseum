#!/bin/sh
# Colosseum SQLite backup — run on the server via cron.
#
# Uses `sqlite3 .backup` against the running container so the snapshot is
# consistent even while writes are in flight. Rotates files older than 14 days.
#
# Env:
#   BACKUP_DIR   — where to put the .db snapshots (default /var/backups/colosseum)
#   CONTAINER    — name of the nextjs container (default colosseum-nextjs-1)
#   DB_PATH      — path inside the container (default /data/arena.db)
#   RETAIN_DAYS  — how long to keep snapshots (default 14)

set -e

BACKUP_DIR="${BACKUP_DIR:-/var/backups/colosseum}"
# Compose names containers as `<project>-<service>-<index>`. The project
# defaults to the directory name (`deploy`), or respects COMPOSE_PROJECT_NAME
# in the compose env. We auto-detect by filtering on the service name.
CONTAINER="${CONTAINER:-$(docker ps --filter name=nextjs --format '{{.Names}}' | head -1)}"
DB_PATH="${DB_PATH:-/data/arena.db}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

if [ -z "$CONTAINER" ]; then
  echo "[backup] ERROR: no running nextjs container found" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%F-%H%M)"
OUT="$BACKUP_DIR/arena-$TS.db.gz"

# `.backup` creates a consistent snapshot even with concurrent writers.
# We stream through gzip on the host to avoid writing a temp file inside
# the container.
docker exec "$CONTAINER" sh -c "sqlite3 '$DB_PATH' '.backup /tmp/snap.db' && cat /tmp/snap.db && rm -f /tmp/snap.db" \
  | gzip > "$OUT"

# Delete snapshots older than RETAIN_DAYS.
find "$BACKUP_DIR" -name 'arena-*.db.gz' -mtime "+${RETAIN_DAYS}" -delete

echo "[backup] ok: $OUT"
