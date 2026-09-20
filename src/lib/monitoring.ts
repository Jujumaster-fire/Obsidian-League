import * as Sentry from '@sentry/nextjs'

/**
 * Error + performance reporting.
 *
 * Configuration (all optional — the app runs normally without a DSN):
 *   NEXT_PUBLIC_SENTRY_DSN              – client + server (single project is fine)
 *   SENTRY_DSN                          – server-only alternative
 *   NEXT_PUBLIC_SENTRY_ENVIRONMENT      – e.g. production / preview / development
 *   NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE – performance sampling, default 0.1
 *   NEXT_PUBLIC_SENTRY_REPLAYS          – 'true' to enable session replay
 *
 * Sampling is deliberately low by default (10%) so the free tier lasts: every
 * error is still captured, but only a slice of successful performance
 * transactions are recorded. Raise the rate on a paid plan if needed.
 */

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? ''

export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
  process.env.SENTRY_ENVIRONMENT ??
  process.env.NODE_ENV ??
  'development'

const rawSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1
)

/** Clamped to a valid Sentry range so a typo in the env var cannot break init. */
export const TRACES_SAMPLE_RATE = Number.isFinite(rawSampleRate)
  ? Math.min(1, Math.max(0, rawSampleRate))
  : 0.1

export const REPLAYS_ENABLED = process.env.NEXT_PUBLIC_SENTRY_REPLAYS === 'true'

export const isSentryEnabled = Boolean(SENTRY_DSN)

/** Noise that is not actionable (Offline Safari, browser extensions, etc.). */
export const IGNORED_ERRORS: (string | RegExp)[] = [
  'ResizeObserver loop limit exceeded',
  'Non-Error promise rejection captured',
  /Loading chunk .* failed/,
  /Failed to fetch/i,
]

/** Attach the caller's identity/scope to every captured event. */
export function identifyUser(user: { id: string; email?: string | null } | null): void {
  try {
    Sentry.setUser(user ? { id: user.id, email: user.email ?? undefined } : null)
  } catch {
    // Never let telemetry break the request.
  }
}

/**
 * Report an exception. Safe to call from anywhere (server, edge or client) and
 * never throws — telemetry must not take a page down.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[captureError]', error, context ?? {})
  }

  try {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  } catch {
    // ignore
  }
}

/** Report a non-exception signal (e.g. a silent data-source failure). */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'warning',
  context?: Record<string, unknown>
): void {
  try {
    Sentry.captureMessage(message, { level, extra: context })
  } catch {
    // ignore
  }
}

/** Adds a breadcrumb for flows that matter (admin writes, cache busts). */
export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  category = 'app'
): void {
  try {
    Sentry.addBreadcrumb({ message, category, data, level: 'info' })
  } catch {
    // ignore
  }
}