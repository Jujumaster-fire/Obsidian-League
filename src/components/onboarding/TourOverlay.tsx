'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOnboarding } from './onboarding-context'

/**
 * The guided component tour.
 *
 * Draws a spotlight over the element a step points at (`[data-tour="…"]`) and a
 * tooltip card beside it. Steps whose element is missing are filtered out by the
 * provider, so this component only measures and navigates.
 */

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/** Space kept between the spotlight ring and the highlighted element. */
const RING_PADDING = 8
/** Rough tooltip height, used to decide whether it fits below the target. */
const TOOLTIP_RESERVE = 210

export function TourOverlay() {
  const { isActive, step, stepIndex, total, next, previous, stopTour } = useOnboarding()
  const [rect, setRect] = useState<Rect | null>(null)

  const measure = useCallback(() => {
    if (!step) {
      setRect(null)
      return
    }
    const element = document.querySelector(step.selector)
    if (!(element instanceof HTMLElement)) {
      setRect(null)
      return
    }
    const bounds = element.getBoundingClientRect()
    setRect({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height })
  }, [step])

  useEffect(() => {
    if (!isActive || !step) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react/set-state-in-effect -- clears the highlight ring when the tour stops or has no step
      setRect(null)
      return
    }

    document.querySelector(step.selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' })

    // Measure now, on the next frame, and once more after the smooth scroll
    // settles, so the ring lands on the element whichever way it scrolls.
    measure()
    const frame = window.requestAnimationFrame(measure)
    const settle = window.setTimeout(measure, 320)

    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [isActive, step, measure])

  useEffect(() => {
    if (!isActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        stopTour()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isActive, next, previous, stopTour])

  if (!isActive || !step) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const cardWidth = Math.min(360, viewportWidth - 32)

  const fitsBelow = rect ? rect.top + rect.height + TOOLTIP_RESERVE < viewportHeight : true
  const cardTop = rect
    ? fitsBelow
      ? rect.top + rect.height + RING_PADDING * 3
      : Math.max(16, rect.top - TOOLTIP_RESERVE)
    : Math.max(16, viewportHeight / 2 - 120)
  const cardLeft = rect
    ? Math.min(Math.max(16, rect.left + rect.width / 2 - cardWidth / 2), viewportWidth - cardWidth - 16)
    : Math.max(16, viewportWidth / 2 - cardWidth / 2)
  const isLast = stepIndex + 1 >= total

  return (
    <div
      className="fixed inset-0 z-[9998]"
      role="dialog"
      aria-modal="true"
      aria-label={`Guided tour: step ${stepIndex + 1} of ${total}`}
    >
      {/* Click-catcher: the spotlight below supplies the darkening. */}
      <div className="absolute inset-0" onClick={stopTour} />

      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-indigo-400/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.82)] transition-all duration-200"
          style={{
            top: rect.top - RING_PADDING,
            left: rect.left - RING_PADDING,
            width: rect.width + RING_PADDING * 2,
            height: rect.height + RING_PADDING * 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#020617]/80" />
      )}

      <div
        className="absolute rounded-2xl border border-indigo-400/30 bg-[#1e293b] p-5 shadow-2xl"
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-indigo-300">
            Step {stepIndex + 1} of {total}
          </span>
          <button
            type="button"
            onClick={stopTour}
            className="text-xs text-gray-400 underline decoration-dotted hover:text-white"
          >
            Skip tour
          </button>
        </div>

        <h3 className="text-base font-bold text-white">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-300">{step.body}</p>

        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-200"
            style={{ width: `${((stepIndex + 1) / total) * 100}%` }}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={previous}
            disabled={stepIndex === 0}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-40"
          >
            Back
          </button>
          <div className="flex items-center gap-2">
            <a
              href="/onboarding"
              className="rounded-lg px-2 py-2 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
            >
              Full guide
            </a>
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TourOverlay
