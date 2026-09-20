/**
 * Supabase connection values with inert build-time fallbacks.
 *
 * `next build` prerenders every static route, and those render passes evaluate
 * client/server components that construct a Supabase client. CI builds without
 * the Supabase secrets (they live in Vercel), and `@supabase/ssr` throws when
 * the URL or key is falsy — which broke the build on `/admin`.
 *
 * The fallbacks below are deliberately inert: they only ever reach a prerender
 * (whose output is the loading shell, since all data loads in effects). On
 * Vercel the real `NEXT_PUBLIC_*` values are present at build time and are
 * inlined into the bundle, so they are what ships to the browser.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'supabase-anon-key-missing'
