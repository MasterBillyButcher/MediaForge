# 🎬 MediaForge

**Everything You Need for Video & Media.** — an all-in-one, fully working web platform for downloading, converting, editing and enhancing video & audio.

Every feature shown in the UI is backed by real processing (FFmpeg / FFprobe on the server, browser APIs on the client). No fake buttons, no mock progress bars, no placeholder pages.

---

## ✨ Features

### ① Video Downloader
- Paste any media URL (direct file links & HLS `.m3u8` playlists)
- Source auto-detection with a rich metadata preview (duration, resolution, codecs, bitrate, thumbnail)
- Quality & format grid showing **only options that actually exist** for the given source
- **Playlist batch downloader** — paste an entire playlist URL, list every video, pick any number of videos, choose a unified or per-video format/quality, watch per-item progress, retry failures
  - Powered by a dedicated background worker (`mini-services/playlist-worker`)
- **HLS / m3u8 direct-link downloader** — paste any `.m3u8` URL (e.g. a Twitch VOD CDN link):
  - Parses master playlists & variant qualities
  - Concurrent segment fetching with retries
  - AES-128 encrypted stream support
  - Muxes/transcodes to any target format (MP4, MKV, WebM, MP3, …) via FFmpeg
  - Progress tracked at segment granularity
- Download history with re-download support
- Batch queue with per-job status

### ② Video & Audio Converter
- Video: MP4 ↔ MOV, MKV → MP4, WebM ↔ MP4, AVI → MP4, MP4 ↔ GIF and more
- Audio: MP4 → MP3/WAV/M4A, WAV ↔ MP3, MP3 → AAC/FLAC, FLAC → MP3, OGG → MP3 and more
- Full control over resolution, bitrate, FPS, sample rate, codec, compression level & speed presets
- Extract / remove audio tracks, batch conversion, real progress display

### ③ Video Editor
- Real preview player + multi-track timeline (drag & drop, powered by dnd-kit)
- Trim, cut, split, merge, resize, rotate, flip, speed change, reverse
- Multi-clip timeline, audio tracks, fade in/out, background music, voice-over
- Canvas presets: 16:9, 9:16, 1:1, 4:5, 4:3 & custom
- Text overlays & SRT subtitle import / sync / export
- Visual effects: brightness, contrast, saturation, exposure, blur, sharpen, grayscale, vintage, watermark/logo
- Exports to MP4/WebM/MOV with real render progress (server-side FFmpeg EDL renderer)

### ④ Universal Media Downloader
- YouTube, Vimeo, Dailymotion, Instagram, Facebook, TikTok, X (Twitter), Reddit, Pinterest & direct URLs
- Platform-aware extraction flow with honest capability reporting

### 🧰 Toolbox (extra utilities)
- **Video tools** (12): trim, compress, GIF maker, extract frames, reverse, speed, rotate/flip, crop, resize, loop, stabilize-style smoothing, thumbnail extractor
- **Audio tools** (7): converter, compressor, normalizer, trimmer, ringtone maker, waveform visualization, volume boost
- **Image tools** (6): converter, resizer, compressor, cropper, format transformer, watermark
- **Subtitle tools** (4): SRT extractor, SRT/VTT converter, subtitle sync shifter, plain-text export

### 🗂 My Files & Settings
- All uploads, downloads & results in one place with previews, sizes and expiry-based auto-cleanup
- Light / dark theme, cleanup controls

---

## 🏗 Tech Stack

| Layer      | Technology |
|------------|------------|
| Framework  | Next.js 16 (App Router) + TypeScript |
| UI         | Tailwind CSS 4, shadcn/ui, Lucide icons, Framer Motion |
| State      | Zustand (client), TanStack Query (server state) |
| Database   | SQLite via Prisma ORM |
| Media      | FFmpeg / FFprobe (server), Web APIs (client) |
| Worker     | Bun mini-service for playlist batch jobs |
| Realtime   | Job polling / progress APIs |

---

## 📁 Project Structure

```
src/
  app/
    page.tsx               # single-page app shell (all modules)
    api/
      media/               # upload, convert, tool, probe-url, download-url,
                           # hls/analyze, hls/download, edl-render,
                           # extract-subtitles, image
      files/               # file listing, download, delete
      jobs/                # job status, cancel, result
      history/             # download history
      system/cleanup       # TTL-based storage cleanup
  components/
    layout/app-shell.tsx   # nav + theming
    modules/               # home, downloader, playlist, converter,
                           # editor, toolbox, files, settings
  lib/
    media/                 # ffmpeg wrapper, hls engine, job manager,
                           # EDL model, tool registry, URL utils
    playlist/              # playlist worker client
mini-services/
  playlist-worker/         # Bun background worker: playlist parsing,
                           # concurrent fetching (HLS + direct), merging
prisma/schema.prisma       # MediaFile & DownloadRecord models
```

---

## 🚀 Getting Started

> Requires [Bun](https://bun.sh) and **FFmpeg + FFprobe** available on `PATH`.

```bash
# 1. install dependencies
bun install

# 2. set the database URL (SQLite file)
echo "DATABASE_URL=file:./db/custom.db" > .env
mkdir -p db

# 3. push the schema
bun run db:push

# 4. start the main app
bun run dev            # http://localhost:3000

# 5. (optional, for playlist batch downloads) start the playlist worker
cd mini-services/playlist-worker
bun install
bun run dev            # listens on :3030
```

---

## 🚢 Deployment

### ⚠️ Vercel / Netlify / serverless — NOT supported

MediaForge is **not a serverless app**. Deploying to Vercel or Netlify will build, but
core features fail with errors like `Could not read that playlist — Request failed (404)`:

| Requirement | Why serverless can't do it |
|---|---|
| `ffmpeg` / `ffprobe` binaries | Conversions, toolbox ops, editor rendering and HLS muxing shell out to FFmpeg — not available in serverless runtimes |
| `yt-dlp` binary | Playlist & platform extraction runs on yt-dlp — not available |
| Playlist worker | A **long-running background service** on port 3030; serverless functions can't host it, so `/pw/*` requests 404 |
| Writable filesystem | SQLite (`DATABASE_URL=file:…`) and the `storage/` folder need a writable, persistent disk |
| Execution time | Media jobs run minutes — far beyond serverless timeouts (10–60 s) |

You can verify any deployment by opening **`/api/system/health`** — it reports exactly
which dependency (ffmpeg, ffprobe, yt-dlp, worker, database) is missing and how to fix it.

### ✅ Option A — Docker (any VPS / any Docker host)

```bash
git clone https://github.com/MasterBillyButcher/MediaForge.git
cd MediaForge
docker compose up -d --build     # http://localhost:3000
```

One container runs everything: web app (:3000) + playlist worker (:3030, proxied at `/pw/*`),
with ffmpeg, yt-dlp and the SQLite database preconfigured. All persistent data
(database, files, playlist jobs) lives under `MEDIA_DATA_DIR=/data`, backed by the
`mediaforge-data` volume.

### ✅ Option B — Render (GitHub-native, closest to Railway)

1. [render.com](https://render.com) → sign in with GitHub → **New +** → **Web Service** → pick the `MediaForge` repo.
2. Runtime **Docker** is auto-detected from the `Dockerfile`. Port: `3000`.
3. Env var: `MEDIA_DATA_DIR=/data`.
4. **Starter** plan ($7/mo): add a **Disk** → mount path `/data`, 5 GB → your DB & files persist.
   *(Free plan works for testing, but the disk is wiped on restart/sleep.)*
5. Deploy — then verify via `https://<your-app>.onrender.com/api/system/health`.

### ✅ Option C — Railway / Fly.io / Koyeb (from the Dockerfile)

- **Railway**: New Project → Deploy from GitHub → add a Volume mounted at `/data` + env var `MEDIA_DATA_DIR=/data`.
- **Fly.io**: `fly launch` (detects the Dockerfile) → `fly volumes create data --size 3` → mount at `/data` → `fly deploy` → set secret `MEDIA_DATA_DIR=/data`.
- **Koyeb**: Create Service → GitHub → Dockerfile autodetected → add a persistent volume at `/data` + env var `MEDIA_DATA_DIR=/data`.

### ✅ Option D — plain VPS (Ubuntu/Debian, cheapest full control)

```bash
sudo apt install -y ffmpeg python3-pip
sudo pip3 install yt-dlp
curl -fsSL https://bun.sh/install | bash

git clone https://github.com/MasterBillyButcher/MediaForge.git && cd MediaForge
bun install
mkdir -p db && echo "DATABASE_URL=file:$(pwd)/db/custom.db" > .env
bun run db:push

# run both processes (e.g. under pm2/systemd)
bun run build && bun run start                                      # web :3000
cd mini-services/playlist-worker && bun install && bun index.ts     # worker :3030
```

Or simply install Docker and use Option A. Then point a reverse proxy
(Nginx/Caddy) at port 3000 — `/pw/*` is proxied to the worker automatically by
the Next.js rewrite.

---

## 🔌 API Overview

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/media/upload` | POST | Multipart upload into managed storage |
| `/api/media/probe-url` | POST | Probe a direct media URL (metadata) |
| `/api/media/download-url` | POST | Download a direct URL into My Files |
| `/api/media/hls/analyze` | POST | Parse an `.m3u8` (master/variants, encryption, size estimate) |
| `/api/media/hls/download` | POST | Download HLS → any format (segment pipeline) |
| `/api/media/convert` | POST | Start a conversion job |
| `/api/media/tool` | POST | Start any toolbox operation |
| `/api/media/edl-render` | POST | Render a timeline project to video |
| `/api/media/extract-subtitles` | POST | Extract embedded subtitle tracks |
| `/api/jobs/{id}` | GET | Job status + progress |
| `/api/jobs/{id}/result` | GET | Fetch processed result |
| `/api/files` | GET | List managed files |
| `/api/system/health` | GET | Deployment diagnostics (ffmpeg, yt-dlp, worker, database) |

Full contract details: [`docs/api-contracts.md`](docs/api-contracts.md)

---

## 🔒 Notes & Compliance

- Download features are intended for **content you own or are licensed to download**. Some platforms restrict downloading — where a platform cannot be supported, the UI says so honestly instead of faking success.
- HLS downloads target plain (non-DRM) HLS streams. Encrypted-media circumvention is not supported.
- Uploaded/downloaded files live in local storage and are cleaned up automatically by TTL.
- User-supplied URLs are validated (SSRF protections) before fetching.

---

## 📄 License

© MasterBillyButcher. All rights reserved.
