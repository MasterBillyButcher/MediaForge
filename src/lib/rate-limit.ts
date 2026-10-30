/**
 * Simple in-memory sliding-window rate limiter.
 * Good enough for a single-node deployment; protects processing endpoints
 * from being hammered.
 */

interface Bucket {
  timestamps: number[];
}

type RateGlobal = typeof globalThis & { __rateBuckets__?: Map<string, Bucket> };
const g = globalThis as RateGlobal;
const buckets: Map<string, Bucket> = g.__rateBuckets__ ?? (g.__rateBuckets__ = new Map());

export interface RateLimitOptions {
  /** max requests inside the window */
  limit: number;
  /** window size in ms */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < opts.windowMs);
  if (bucket.timestamps.length >= opts.limit) {
    const oldest = bucket.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000)),
    };
  }
  bucket.timestamps.push(now);
  return { allowed: true, remaining: opts.limit - bucket.timestamps.length, retryAfterSeconds: 0 };
}

/** Best-effort client IP from proxy headers (single trusted gateway). */
export function clientIpFromRequest(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}
