import { NextResponse, type NextRequest } from 'next/server'
import { getAuthInfo } from '@/lib/admin-auth'
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rate-limit'

/**
 * GET /api/admin-auth-info
 *
 * App Router route handler returning the caller's role and tournament
 * memberships for client components. Always 200 with nulls when signed out so
 * the UI can render the signed-out state without special casing.
 *
 * Security: response is `no-store` and never contains tokens, emails, or
 * anything beyond the caller's own membership scope (RLS also enforces this).
 */
export async function GET(request: NextRequest) {
  const limit = await checkRateLimit(`admin-auth-info:${getClientIp(request.headers)}`, 120, 60)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...rateLimitHeaders(limit), 'Cache-Control': 'no-store' } }
    )
  }

  const info = await getAuthInfo()

  return NextResponse.json(
    {
      authenticated: Boolean(info.user),
      role: info.role,
      memberships: info.memberships,
      isAppAdmin: info.isAppAdmin,
      isTournamentAdmin: info.isTournamentAdmin,
      canAccessAdmin: info.canAccessAdmin,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
