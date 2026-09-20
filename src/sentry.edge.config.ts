import * as Sentry from '@sentry/nextjs'
import {
  IGNORED_ERRORS,
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  TRACES_SAMPLE_RATE,
} from '@/lib/monitoring'

/** Edge-runtime reporting (proxy + edge route handlers). */
Sentry.init({
  dsn: SENTRY_DSN || undefined,
  enabled: Boolean(SENTRY_DSN),
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  sendDefaultPii: false,
  ignoreErrors: IGNORED_ERRORS,
})