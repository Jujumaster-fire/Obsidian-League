import { cached } from '@/lib/cache'
import { captureMessage } from '@/lib/monitoring'

/**
 * Cache-aware public data reader.
 *
 * Public pages are read-mostly and must survive traffic spikes without hammering
 * Postgres. Instead of the cookie-bound `@supabase/ssr` client — which opts a
 * route into dynamic rendering — public surfaces read PostgREST directly through
 * `fetch()` with Next's Data Cache:
 *
 *   * `revalidate` is the fast, always-on layer (30s for scoreboards, longer for
 *     articles and directories).
 *   * the shared `public-data` tag lets an admin write bust the cache instantly
 *     via `POST /api/revalidate`.
 *   * `cachedRestGet()` adds an optional Upstash Redis layer on top for heavy,
 *     semi-static reads (article lists/details, medal tallies, team directory,
 *     tournament configuration). Live data is never put behind that layer.
 *
 * Only the anon key is used, so Row Level Security still applies and nothing
 * beyond publicly readable rows can ever be returned. Failures are never thrown
 * — a page degrades to an empty list and the failure is reported to Sentry so it
 * cannot stay invisible.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** Tag applied to every cached public read; revalidated by /api/revalidate. */
export const PUBLIC_DATA_TAG = 'public-data'

/** Recommended freshness for live-ish public data (seconds). */
export const PUBLIC_REVALIDATE_SECONDS = 30

/** Freshness for heavy, semi-static public data (seconds). */
export const STATIC_REVALIDATE_SECONDS = 300

export interface RestGetOptions {
  /** Seconds before the cached entry is refreshed (default 30). */
  revalidate?: number
  /** Extra cache tags in addition to `public-data`. */
  tags?: string[]
}

export interface CachedRestGetOptions extends RestGetOptions {
  /**
   * Identity of the shared (Upstash) cache entry. Pass a stable key such as
   * `cacheKey('news', 'list')` to enable the Redis layer; omit it to use only
   * the Next.js Data Cache.
   */
  sharedKey?: string
  /** TTL for the shared layer in seconds (default 300). */
  sharedTtlSeconds?: number
}

/**
 * GET a PostgREST resource with Next's Data Cache.
 *
 * `resource` is the table/view name plus the PostgREST query string, e.g.
 * `'fixtures?select=*,home_team:home_team_id(*)&order=match_date.asc&limit=20'`.
 *
 * Never throws: a misconfigured environment or a failing query returns `[]` so
 * a single unavailable table cannot take a public page down. Failures are
 * reported so they do not stay silent.
 */
export async function restGet<T = Record<string, unknown>>(
  resource: string,
  { revalidate = PUBLIC_REVALIDATE_SECONDS, tags = [] }: RestGetOptions = {}
): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    captureMessage('Supabase environment variables are missing for a public read', 'error', {
      resource,
    })
    return []
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
      next: { revalidate, tags: [PUBLIC_DATA_TAG, ...tags] },
    })

    if (!response.ok) {
      captureMessage('PostgREST read failed', 'error', {
        resource,
        status: response.status,
        body: await response.text().catch(() => ''),
      })
      return []
    }

    const payload = await response.json()
    return Array.isArray(payload) ? (payload as T[]) : []
  } catch (error) {
    captureMessage('PostgREST read threw', 'error', {
      resource,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/**
 * `restGet` with an optional shared-cache layer for heavy, semi-static reads.
 *
 * The Next.js Data Cache already deduplicates per region; Upstash adds a global
 * layer that survives deployments and cold edge instances. Keep the TTL short
 * enough that editors see their changes (every admin write also purges the
 * shared keys through `POST /api/revalidate`).
 */
export async function cachedRestGet<T = Record<string, unknown>>(
  resource: string,
  {
    sharedKey,
    sharedTtlSeconds = STATIC_REVALIDATE_SECONDS,
    revalidate,
    tags,
  }: CachedRestGetOptions = {}
): Promise<T[]> {
  if (!sharedKey) {
    return restGet<T>(resource, { revalidate, tags })
  }

  return cached<T[]>(sharedKey, sharedTtlSeconds, () =>
    restGet<T>(resource, { revalidate, tags })
  )
}