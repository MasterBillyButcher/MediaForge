# syntax=docker/dockerfile:1

# =============================================================================
# MediaForge — all-in-one media toolkit
#
# Builds a single container that runs:
#   - Next.js web app + API on :3000
#   - playlist worker (yt-dlp batch downloader) on :3030 (proxied via /pw/*)
#
# Includes ffmpeg/ffprobe + yt-dlp, and auto-creates the SQLite database on
# first boot. Persist data by mounting volumes over /app/db, /app/storage and
# /app/playlist-worker/storage (see docker-compose.yml).
# =============================================================================

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:1.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY mini-services/playlist-worker/package.json mini-services/playlist-worker/bun.lock* mini-services/playlist-worker/
RUN cd mini-services/playlist-worker && (bun install --frozen-lockfile || bun install)

# ---------------------------------------------------------------------------
# 2. Build the Next.js app (standalone output)
# ---------------------------------------------------------------------------
FROM oven/bun:1.2-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy URL so module-scope PrismaClient doesn't throw during build — no DB access happens at build time.
ENV DATABASE_URL=file:/app/db/custom.db

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/mini-services/playlist-worker/node_modules ./mini-services/playlist-worker/node_modules
COPY . .
RUN bunx prisma generate
RUN bun run build

# ---------------------------------------------------------------------------
# 3. Runtime — slim image with ffmpeg + yt-dlp
# ---------------------------------------------------------------------------
FROM oven/bun:1.2-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# ffmpeg/ffprobe for all media processing; yt-dlp for platform/playlist downloads
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-pip \
 && (pip3 install --no-cache-dir --break-system-packages yt-dlp || pip3 install --no-cache-dir yt-dlp) \
 && rm -rf /var/lib/apt/lists/*

# Next.js standalone server
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Playlist worker (own node_modules: archiver)
COPY --from=builder /app/mini-services/playlist-worker/index.ts /app/mini-services/playlist-worker/index.ts
COPY --from=builder /app/mini-services/playlist-worker/engine.ts /app/mini-services/playlist-worker/engine.ts
COPY --from=builder /app/mini-services/playlist-worker/store.ts /app/mini-services/playlist-worker/store.ts
COPY --from=builder /app/mini-services/playlist-worker/node_modules /app/mini-services/playlist-worker/node_modules

# Prisma CLI + schema for the boot-time `db push`
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Entrypoint: create dirs, apply schema, start worker + web
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Persistent data (single-volume deployments mount a disk at /data and set
# MEDIA_DATA_DIR=/data; otherwise data lives under /app)
VOLUME ["/data"]
RUN mkdir -p /app/db /app/storage/uploads /app/storage/results \
             /app/mini-services/playlist-worker/storage/jobs \
             /app/mini-services/playlist-worker/storage/tmp \
             /data

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
