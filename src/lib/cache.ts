import { Redis } from '@upstash/redis'

/**
 * Shared cache layer (Upstash Redis) with a safe in-process fallback.
 *
 * Why: the free Upstash tier is request-metered, so this module is deliberately
 * conservative — it only caches **heavy, semi-static** reads (article lists and
 * detail pages, medal tallies, team directories, tournament configuration, the
 * sports catalogue). Live data (fixtures, scores, match events) is never cached
 * here; it stays on the short window provided by the Next.js Data Cache.
 *
 * Configuration (both optional — the app works without them):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * When the variables are absent, or when Upstash is temporarily unreachable,
 * every call degrades to an in-memory map for the lifetime of the instance and
 * then straight to the loader. Cache failures must never break a page, so no
 * function in this module throws.
 */

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

const redis = url && token ? new Redis({ url, token }) : null

/** `true` when a shared Upstash cache is configured. */
export const hasSharedCache = Boolean(redis)

/** Every key written here lives under this prefix so it can be purged at once. */
export const CACHE_PREFIX = 'ol:'

interface MemoryEntry {
  value: string
  expiresAt: number
}

const memory = new Map<string, MemoryEntry>()
const MEMORY_MAX_ENTRIES = 500

function memoryGet(key: string): string | null {
  const entry = memory.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key)
    return null
  }
  return entry.value
}

function memorySet(key: string, value: string, ttlSeconds: number) {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value
    if (oldest) memory.delete(oldest)
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

/** Namespaced cache key, e.g. `cacheKey('news', 'list')` → `ol:news:list`. */
export function cacheKey(...parts: (string | number | null | undefined)[]): string {
  return (
    CACHE_PREFIX +
    parts
      .filter((part) => part !== null && part !== undefined && `${part}`.length > 0)
      .map((part) => `${part}`.trim().toLowerCase().replace(/\s+/g, '-'))
      .join(':')
  )
}

/** Read a JSON value; `null` on miss or failure. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (redis) {
      const value = await redis.get<T>(key)
      return value ?? null
    }
    const raw = memoryGet(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Write a JSON value with a TTL (seconds). Failures are ignored. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const payload = JSON.stringify(value)
    if (redis) {
      await redis.set(key, payload, { ex: ttlSeconds })
      return
    }
    memorySet(key, payload, ttlSeconds)
  } catch {
    // Cache writes are best effort.
  }
}

/** Delete specific keys. */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    if (redis) {
      await redis.del(...keys)
      return
    }
    keys.forEach((key) => memory.delete(key))
  } catch {
    // ignore
  }
}

/**
 * Delete every key under a prefix (used by POST /api/revalidate to drop all
 * cached public reads after an admin write). Uses SCAN so it never blocks Redis.
 */
export async function cacheDelPrefix(prefix: string): Promise<number> {
  let deleted = 0
  try {
    if (redis) {
      let cursor = 0
      do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 100 })
        cursor = Number(nextCursor)
        if (keys.length > 0) {
          await redis.del(...keys)
          deleted += keys.length
        }
      } while (cursor !== 0)
      return deleted
    }

    for (const key of Array.from(memory.keys())) {
      if (key.startsWith(prefix)) {
        memory.delete(key)
        deleted += 1
      }
    }
  } catch {
    // ignore
  }
  return deleted
}

/**
 * Cache-aside helper: return the cached value when present, otherwise run
 * `loader`, store the result and return it. Never throws.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const hit = await cacheGet<T>(key)
  if (hit !== null) return hit

  const fresh = await loader()
  await cacheSet(key, fresh, ttlSeconds)
  return fresh
}
