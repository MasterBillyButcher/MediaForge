#!/bin/sh
# MediaForge container entrypoint:
#   1. ensure data directories exist (under MEDIA_DATA_DIR if set, else /app)
#   2. apply the Prisma schema to the SQLite database (idempotent)
#   3. start the playlist worker (:3030) in the background
#   4. replace the shell with the Next.js server (:3000, PID 1)
#
# When the container stops, Docker terminates all processes in the cgroup,
# so the background worker is cleaned up together with the web server.
set -e

DATA_ROOT="${MEDIA_DATA_DIR:-/app}"

echo "[mediaforge] data root: $DATA_ROOT"
mkdir -p "$DATA_ROOT/db" \
         "$DATA_ROOT/storage/uploads" "$DATA_ROOT/storage/results" \
         "$DATA_ROOT/playlist/jobs" "$DATA_ROOT/playlist/tmp"

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="file:$DATA_ROOT/db/custom.db"
fi

echo "[mediaforge] applying database schema… ($DATABASE_URL)"
cd /app
./node_modules/.bin/prisma db push --skip-generate

echo "[mediaforge] starting playlist worker on :3030…"
cd /app/mini-services/playlist-worker
bun index.ts &

echo "[mediaforge] starting web app on :${PORT:-3000}…"
cd /app
exec bun server.js
