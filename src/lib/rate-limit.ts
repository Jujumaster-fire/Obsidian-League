import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Rate limiting for the app's own route handlers.
 *
 * Two tiers:
 *   1. **Upstash Redis** (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`)
 *      — a global sliding window shared by every instance. This is the real
 *      limit; it works on the free tier because each call is a single REST
 *      request.
 *   2. **In-process sliding window** — used when Upstash is not configured or a
 *      Redis call fails, so the app always has *some* protection (per instance).
 *
 * Sign-in / sign-up brute force is primarily handled by Supabase Auth's own
 * limits and (optionally) Cloudflare Turnstile in front of the deployment; this
 * module protects `/api/*`.
 */

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

const redis = url && token ? new Redis({ url, token }) : null

/** `true` when a shared (Upstash) limiter is active. */
export const hasSharedRateLimit = Boolean(redis)

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  retryAfterSeconds: number
}

const limiterCache = new Map<string, Ratelimit>()
const memoryBuckets = new Map<string, number[]>()
const MEMORY_MAX_KEYS = 10_000

function limiterFor(limit: number, windowSeconds: number): Ratelimit | null {
  if (!redis) return null
  const cacheKey = `${limit}:${windowSeconds}`
  const existing = limiterCache.get(cacheKey)
  if (existing) return existing

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: 'ol:rl',
    analytics: false,
  })
  limiterCache.set(cacheKey, limiter)
  return limiter
}

function memoryLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  const hits = (memoryBuckets.get(key) ?? []).filter((time) => now - time < windowMs)

  if (hits.length >= limit) {
    const retryAfterMs = windowMs - (now - hits[0])
    memoryBuckets.set(key, hits)
    return {
      ok: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }

  hits.push(now)
  memoryBuckets.set(key, hits)

  if (memoryBuckets.size > MEMORY_MAX_KEYS) {
    for (const [bucketKey, times] of memoryBuckets) {
      const live = times.filter((time) => now - time < windowMs)
      if (live.length === 0) memoryBuckets.delete(bucketKey)
      else memoryBuckets.set(bucketKey, live)
    }
  }

  return { ok: true, limit, remaining: limit - hits.length, retryAfterSeconds: 0 }
}

/**
 * Record a request and report whether it stays within `limit` per
 * `windowSeconds`. Never throws — a Redis outage degrades to the in-process
 * limiter instead of blocking traffic.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const limiter = limiterFor(limit, windowSeconds)

  if (limiter) {
    try {
      const result = await limiter.limit(key)
      const resetInSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
      return {
        ok: result.success,
        limit,
        remaining: Math.max(0, result.remaining),
        retryAfterSeconds: result.success ? 0 : resetInSeconds,
      }
    } catch {
      return memoryLimit(key, limit, windowSeconds)
    }
  }

  return memoryLimit(key, limit, windowSeconds)
}

/** Headers to attach to a 429 response. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'Retry-After': String(result.retryAfterSeconds),
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  }
}

/** Client IP from the proxy headers Vercel/Cloudflare set. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]
    if (first) return first.trim()
  }
  return headers.get('x-real-ip') ?? 'unknown'
}