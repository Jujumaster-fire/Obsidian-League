import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './utils/supabase/env'

/**
 * Next.js 16 Proxy (formerly Middleware).
 *
 * Responsibilities:
 *   1. Refresh the Supabase session cookie on every matched request and write
 *      the rotated tokens onto the outgoing response.
 *   2. Optimistically gate `/admin/**` so unauthenticated visitors are sent to
 *      `/login?next=…` and signed-in users without any admin capability are
 *      sent home.
 *
 * This is a *coarse* gate for UX only: `public.is_app_admin()` /
 * `public.is_tournament_admin()` inside Postgres RLS (plus the helpers in
 * `src/lib/admin-auth.ts`) remain the authoritative authorization layer, so a
 * forged request can never escalate privileges here.
 */

/** Copy cookies rotated by `getUser()` onto a redirect response. */
function withRefreshedCookies(response: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: `getUser()` revalidates against the Auth server; do not run
  // application logic between client creation and this call.
  //
  // A network failure — or a missing Supabase env in local dev — must not take
  // the whole site down, so degrade to "anonymous" and let the coarse gate
  // below redirect `/admin/**` to /login. RLS stays authoritative.
  let user: { id: string } | null = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user ? { id: data.user.id } : null
  } catch {
    user = null
  }

  const { pathname, search } = request.nextUrl
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')

  if (!isAdminRoute) {
    return supabaseResponse
  }

  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`
    return withRefreshedCookies(NextResponse.redirect(loginUrl), supabaseResponse)
  }

  const [roleResult, membershipResult] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('tournament_members')
      .select('tournament_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle(),
  ])

  const isAppAdmin = roleResult.data?.role === 'app_admin'
  const isMember = Boolean(membershipResult.data)

  if (!isAppAdmin && !isMember) {
    return withRefreshedCookies(
      NextResponse.redirect(new URL('/', request.url)),
      supabaseResponse
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|webmanifest)$).*)',
  ],
}