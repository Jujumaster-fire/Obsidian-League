'use client'

import { createContext, useContext } from 'react'
import type { RoleId, TourStep } from '@/lib/onboarding'

/**
 * Shared onboarding state (guided tour + first-run welcome).
 *
 * Split out of `OnboardingExperience.tsx` so the tour overlay, the welcome
 * dialog and the `/onboarding` guide page can all consume the same context
 * without importing each other.
 */

export const TOUR_SEEN_KEY = 'obsidian.tour.seen'
export const WELCOME_SEEN_KEY = 'obsidian.welcome.seen'

export interface OnboardingState {
  /** A tour is currently running. */
  isActive: boolean
  step: TourStep | null
  stepIndex: number
  total: number
  hasSeenWelcome: boolean
  startTour: (role: RoleId) => void
  next: () => void
  previous: () => void
  stopTour: () => void
  completeWelcome: () => void
  markTourSeen: () => void
}

/** No-op fallback: pages render fine even if the provider is absent. */
export const IDLE_ONBOARDING: OnboardingState = {
  isActive: false,
  step: null,
  stepIndex: 0,
  total: 0,
  hasSeenWelcome: true,
  startTour: () => {},
  next: () => {},
  previous: () => {},
  stopTour: () => {},
  completeWelcome: () => {},
  markTourSeen: () => {},
}

export const OnboardingContext = createContext<OnboardingState>(IDLE_ONBOARDING)

export function useOnboarding(): OnboardingState {
  return useContext(OnboardingContext)
}

/**
 * `'/onboarding'` matches itself; `'/'` only matches the exact home path.
 * Mirrors `pathMatches` in `onboarding.ts` — the pure test suite covers the
 * same rule there, so keep the two in step.
 */
export function pathMatches(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export const readFlag = (key: string): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export const writeFlag = (key: string): void => {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    /* private mode — the tour simply reappears next visit */
  }
}
