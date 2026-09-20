import type { NextConfig } from 'next'
// The subpath export is required: the top-level `@sentry/nextjs` re-export is
// deprecated and stops working in Sentry v11.
import { withSentryConfig } from '@sentry/nextjs/config'

/**
 * Baseline security headers (FESO Batch 6).
 *
 * The CSP keeps `'unsafe-inline'`/`'unsafe-eval'` for scripts so Next's dev
 * tooling and Supabase Realtime websockets keep working, and allows images from
 * any https host because tournament posts may embed external artwork. Tighten
 * with nonces once a report-only run confirms nothing else is needed.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
]

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : undefined
  } catch {
    return undefined
  }
})()

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      ...(supabaseHost
        ? [
            {
              protocol: 'https' as const,
              hostname: supabaseHost,
              pathname: '/storage/v1/object/public/**',
            },
          ]
        : []),
    ],
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

/**
 * withSentryConfig wraps the Next config so that during `next build`:
 *   1. Source maps are generated (devtool: 'source-map' for server, default for client).
 *   2. If SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are set, the built artifacts
 *      are uploaded to sentry.io automatically — no separate CI step needed.
 *
 * When those vars are absent (local dev, preview without secrets), Sentry stays
 * disabled silently; the build succeeds with minified traces only.
 */
export default withSentryConfig(nextConfig, {
  // Only upload when we have credentials — prevents noisy failures in local builds.
  org: process.env.SENTRY_ORG ?? undefined,
  project: process.env.SENTRY_PROJECT ?? undefined,
  authToken: process.env.SENTRY_AUTH_TOKEN ?? undefined,
  // Silent mode: don't fail the build if Sentry is misconfigured.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring-tunnel',
  // Nested under `webpack` since the flat form is deprecated (and the
  // instrumentation is a webpack feature — Turbopack builds skip it).
  webpack: {
    autoInstrumentServerFunctions: true,
  },
})
