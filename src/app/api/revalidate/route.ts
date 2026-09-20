import { NextResponse, type NextRequest } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getAuthInfo } from '@/lib/admin-auth'
import { PUBLIC_DATA_TAG } from '@/lib/public-api'
import { CACHE_PREFIX, cacheDelPrefix } from '@/lib/cache'
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rate-limit'
import { captureError } from '@/lib/monitoring'

/**
 * POST /api/revalidate — on-demand cache invalidation.
 *
 * Public pages read through `restGet()`/`cachedRestGet()` (see
 * src/lib/public-api.ts), which caches responses in the Next.js Data Cache and,
 * when configured, in Upstash Redis. After an admin write we expire both so the
 * public site reflects the change immediately instead of waiting for the next
 * revalidation window.
 *
 * Authorization: any signed-in user with admin capability. Tournament-scoped
 * writes are already limited by RLS, so a tournament member may legitimately
 * invalidate the public cache after their own edit.
 */
export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(`revalidate:${getClientIp(request.headers)}`, 60, 60)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: rateLimitHeaders(limit) }
    )
  }

  const info = await getAuthInfo()
  if (!info.canAccessAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  revalidateTag(PUBLIC_DATA_TAG, { expire: 0 })
  revalidatePath('/')

  let purgedSharedKeys = 0
  try {
    purgedSharedKeys = await cacheDelPrefix(CACHE_PREFIX)
  } catch (error) {
    captureError(error, { route: 'api/revalidate', stage: 'cacheDelPrefix' })
  }

  return NextResponse.json({
    revalidated: true,
    tag: PUBLIC_DATA_TAG,
    purgedSharedKeys,
    at: Date.now(),
  })
}