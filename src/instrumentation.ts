import * as Sentry from '@sentry/nextjs'

/**
 * Next.js instrumentation hook.
 *
 * Loads the runtime-specific Sentry config and forwards server-side request
 * errors (including React Server Component render failures) to Sentry.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError