#!/bin/sh
# MediaForge container entrypoint:
#   1. ensure data directories exist
#   2. apply the Prisma schema to the SQLite database (idempotent)
#   3. start the playlist worker (:3030) in the background
#   4. replace the shell with the Next.js server (:3000, PID 1)
#
# When the container stops, Docker terminates all processes in the cgroup,
# so the background worker is cleaned up together with the web server.
set -e

echo "[mediaforge] preparing data directories…"
mkdir -p /app/db \
         /app/storage/uploads /app/storage/results \
         /app/mini-services/playlist-worker/storage/jobs \
         /app/mini-services/playlist-worker/storage/tmp

echo "[mediaforge] applying database schema…"
cd /app
./node_modules/.bin/prisma db push --skip-generate

echo "[mediaforge] starting playlist worker on :3030…"
cd /app/mini-services/playlist-worker
bun index.ts &

echo "[mediaforge] starting web app on :${PORT:-3000}…"
cd /app
exec bun server.js
