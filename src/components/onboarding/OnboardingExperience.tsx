'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { stepsForCurrentLeg, tourEntryRoutes, type RoleId, type TourStep } from '@/lib/onboarding'
import {
  OnboardingContext,
  TOUR_SEEN_KEY,
  WELCOME_SEEN_KEY,
  readFlag,
  writeFlag,
  type OnboardingState,
} from './onboarding-context'
import { TourOverlay } from './TourOverlay'
import { WelcomeDialog } from './WelcomeDialog'

/**
 * Mounts the in-app onboarding: a first-run welcome dialog plus the guided tour
 * that spotlights real components through their `data-tour` anchors.
 *
 * The tour never authorizes anything — it only points at UI that RLS and the
 * duty-checked RPCs already gate (see PART 13/14 in `supabase/db-setup.sql`).
 */

/** The spotlightable element for a step, if it is on this page right now. */
function findTarget(step: TourStep): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector(step.selector)
  return element instanceof HTMLElement ? element : null
}

export function OnboardingExperience({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [steps, setSteps] = useState<TourStep[]>([])
  const [stepIndex, setStepIndex] = useState(0)
  const [hasSeenWelcome, setHasSeenWelcome] = useState(true)
  const pendingRole = useRef<RoleId | null>(null)
  const visitedRoutes = useRef<string[]>([])

  // Flags are read after mount so the server and client markup agree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react/set-state-in-effect -- localStorage is only readable on the client, so the flag must be synced after mount
    setHasSeenWelcome(readFlag(WELCOME_SEEN_KEY))
  }, [])

  /**
   * Start a role's tour from where the visitor is. When the role still has tour
   * content on an unvisited route we navigate to the next leg — for example
   * "Scouts → Take the tour" walks the public hub first, then the console.
   */
  const startTour = useCallback(
    (role: RoleId) => {
      const onThisPath = stepsForCurrentLeg(role, pathname)
      if (onThisPath.length > 0) {
        writeFlag(TOUR_SEEN_KEY)
        pendingRole.current = role
        visitedRoutes.current = [pathname]
        setSteps(onThisPath)
        setStepIndex(0)
        return
      }

      const routes = tourEntryRoutes(role)
      if (routes.length === 0) return
      pendingRole.current = role
      writeFlag(TOUR_SEEN_KEY)
      router.push(routes[0])
    },
    [pathname, router]
  )

  // After each navigation, swap in the unvisited steps that belong to the new
  // route. Stale steps are dropped so the tour follows the route, not the data.
  useEffect(() => {
    const role = pendingRole.current
    if (!role) return
    const onThisPath = stepsForCurrentLeg(role, pathname)
    if (onThisPath.length === 0) return
    if (!visitedRoutes.current.includes(pathname)) visitedRoutes.current.push(pathname)
    setSteps(onThisPath)
    setStepIndex(0)
  }, [pathname])

  const stopTour = useCallback(() => {
    setSteps([])
    setStepIndex(0)
    pendingRole.current = null
    visitedRoutes.current = []
  }, [])

  /**
   * Drop steps whose anchor is not on this page (a tournament with no fixtures
   * yet, for instance) so the tour never points at an empty screen. Runs just
   * after paint, once client components have mounted.
   */
  useEffect(() => {
    if (steps.length === 0) return
    const timer = window.setTimeout(() => {
      const available = steps.filter((step) => findTarget(step) !== null)
      if (available.length === 0) {
        stopTour()
        return
      }
      if (available.length !== steps.length) {
        setSteps(available)
        setStepIndex(0)
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [steps, stopTour])

  const previous = useCallback(() => setStepIndex((current) => Math.max(current - 1, 0)), [])

  /** Finish the current leg; continue on the role's next unvisited route when one exists. */
  const next = useCallback(() => {
    const role = pendingRole.current
    if (!role) return
    const atLastStep = stepIndex + 1 >= steps.length
    if (!atLastStep) {
      setStepIndex(stepIndex + 1)
      return
    }
    const remaining = tourEntryRoutes(role).filter((route) => !visitedRoutes.current.includes(route))
    if (remaining.length === 0) {
      stopTour()
      return
    }
    setSteps([])
    setStepIndex(0)
    // The route-matcher effect picks this leg up as soon as it lands.
    router.push(remaining[0])
  }, [router, stepIndex, steps.length, stopTour])

  const value = useMemo<OnboardingState>(
    () => ({
      isActive: steps.length > 0,
      step: steps[stepIndex] ?? null,
      stepIndex,
      total: steps.length,
      hasSeenWelcome,
      startTour,
      next,
      previous,
      stopTour,
      completeWelcome: () => {
        writeFlag(WELCOME_SEEN_KEY)
        setHasSeenWelcome(true)
      },
      markTourSeen: () => writeFlag(TOUR_SEEN_KEY),
    }),
    [steps, stepIndex, hasSeenWelcome, startTour, next, previous, stopTour]
  )

  // The welcome dialog is shown once per browser; the tour, when running, wins.
  const showWelcome = hasSeenWelcome || steps.length > 0 ? null : <WelcomeDialog />

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <TourOverlay />
      {showWelcome}
    </OnboardingContext.Provider>
  )
}

export default OnboardingExperience
