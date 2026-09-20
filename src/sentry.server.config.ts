import * as Sentry from '@sentry/nextjs'
import {
  IGNORED_ERRORS,
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  TRACES_SAMPLE_RATE,
} from '@/lib/monitoring'

/** Server-side (Node runtime) error + performance reporting. */
Sentry.init({
  dsn: SENTRY_DSN || undefined,
  enabled: Boolean(SENTRY_DSN),
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  sendDefaultPii: false,
  ignoreErrors: IGNORED_ERRORS,
})