import * as Sentry from '@sentry/nextjs'
import {
  IGNORED_ERRORS,
  REPLAYS_ENABLED,
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  TRACES_SAMPLE_RATE,
} from '@/lib/monitoring'

/**
 * Client-side error + performance reporting (Next.js `instrumentation-client`).
 * Session Replay stays off unless NEXT_PUBLIC_SENTRY_REPLAYS=true, because it
 * consumes quota quickly on the free tier.
 */
Sentry.init({
  dsn: SENTRY_DSN || undefined,
  enabled: Boolean(SENTRY_DSN),
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  sendDefaultPii: false,
  ignoreErrors: IGNORED_ERRORS,
  integrations: REPLAYS_ENABLED ? [Sentry.replayIntegration()] : [],
  replaysSessionSampleRate: REPLAYS_ENABLED ? 0.1 : 0,
  replaysOnErrorSampleRate: REPLAYS_ENABLED ? 1 : 0,
})

/** Traces client-side navigations as performance transactions. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart