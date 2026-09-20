'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * Root error boundary (replaces the whole document, so it must render
 * <html>/<body> itself). Report once per error and offer a retry.
 */
export default function GlobalError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset?: () => void
  unstable_retry?: () => void
}) {
  const retry = unstable_retry ?? reset

  useEffect(() => {
    try {
      Sentry.captureException(error)
    } catch {
      // Telemetry must never break the fallback UI.
    }
  }, [error])

  return (
    <html lang="en">
      <body style={{ background: '#0f172a', color: '#ffffff', fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
          }}
        >
          <div
            style={{
              maxWidth: '28rem',
              textAlign: 'center',
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '0.75rem',
              padding: '2rem',
            }}
          >
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Something went wrong</h1>
            <p style={{ marginTop: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
              The application hit an unexpected error. The team has been notified.
            </p>
            {error?.digest && (
              <p style={{ marginTop: '0.5rem', color: '#64748b', fontSize: '0.75rem' }}>
                Reference: {error.digest}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (retry) retry()
                else window.location.reload()
              }}
              style={{
                marginTop: '1.5rem',
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                padding: '0.6rem 1.2rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}