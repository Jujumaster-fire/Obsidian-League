import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Simple in-memory store for demonstration of rate limiting logic.
// In production, MUST use Redis (e.g., Upstash) as this resets on serverless cold starts.
const rateLimit = new Map<string, { count: number; timestamp: number }>();

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // 1. RATE LIMITING LOGIC (Auth endpoints only)
  if (request.nextUrl.pathname.startsWith('/auth') || request.nextUrl.pathname.startsWith('/login')) {
    const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1';
    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minutes
    const maxRequests = 5; // Max 5 login attempts per 5 mins

    const currentLimit = rateLimit.get(ip) ?? { count: 0, timestamp: now };

    if (now - currentLimit.timestamp > windowMs) {
      // Reset window
      rateLimit.set(ip, { count: 1, timestamp: now });
    } else {
      if (currentLimit.count >= maxRequests) {
        return new NextResponse('Too Many Requests', { status: 429 });
      }
      rateLimit.set(ip, { count: currentLimit.count + 1, timestamp: currentLimit.timestamp });
    }
  }


  // 2. SUPABASE SESSION REFRESH
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 3. ROUTE PROTECTION
  // Protect admin routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Verify admin role in database
    const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

    if (!roleData || roleData.role !== 'admin') {
        return NextResponse.redirect(new URL('/', request.url)) // Redirect non-admins to home
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
