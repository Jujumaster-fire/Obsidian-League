import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rate-limit'

/**
 * POST /api/fixture-loggers/release — console lifecycle helper.
 *
 * Releases one or more of the caller's held logging scopes
 * (`fixture_loggers` rows) so another operator can take over immediately
 * instead of waiting out the 5-minute staleness window. Called with
 * `navigator.sendBeacon` on console unload, and re-runnable at any time.
 *
 * Authorization: the caller must own the claim. Ownership is enforced inside
 * `release_fixture_scope()` (SECURITY DEFINER, errcode `insufficient_privilege`
 * for foreign claims); this route additionally checks the caller's scope list
 * against their own rows so malformed requests are rejected cheaply.
 */
export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(`fixture-loggers-release:${getClientIp(request.headers)}`, 120, 60)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: rateLimitHeaders(limit) }
    )
  }

  let payload: { fixture_id?: unknown; scope?: unknown; scopes?: unknown } = {}
  // sendBeacon keeps the query string and an empty body; other callers may
  // send JSON instead. content-type decides which one we parse.
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      payload = (await request.json()) as typeof payload
    } catch {
      return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
    }
  }
  const search = request.nextUrl.searchParams

  const fixtureId = String(payload.fixture_id ?? search.get('fixture_id') ?? '')
  const repeated = search.getAll('scope').map(String).filter(Boolean)
  const parsedScopes = Array.isArray(payload.scopes)
    ? payload.scopes.map(String)
    : [String(payload.scope ?? '')].filter(Boolean)
  const scopes = [...repeated, ...parsedScopes].filter(Boolean)

  if (!fixtureId || scopes.length === 0 || scopes.length > 24) {
    return NextResponse.json({ error: 'fixture_id and scope(s) are required.' }, { status: 400 })
  }

  const supabase = await createClient()
  const released: string[] = []
  const skipped: { scope: string; reason: string }[] = []

  for (const scope of scopes) {
    const { error } = await supabase.rpc('release_fixture_scope', {
      p_fixture_id: fixtureId,
      p_scope: scope,
    })
    if (error) {
      skipped.push({ scope, reason: error.message })
    } else {
      released.push(scope)
    }
  }

  return NextResponse.json(
    { fixture_id: fixtureId, released, skipped },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
