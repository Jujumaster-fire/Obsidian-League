'use client'

import { useEffect } from 'react'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { viewerRoleFor, type RoleId } from '@/lib/onboarding'
import { readFlag, useOnboarding, writeFlag } from './onboarding-context'

const ROLE_ORDER: readonly RoleId[] = ['fan', 'user', 'scout', 'tournament_admin', 'app_admin']

/**
 * Introduces staff to their own console the first time they open it.
 *
 * Mount inside a staff-only surface with the minimum role that surface
 * serves. The launcher detects the visitor's real level and starts that
 * level's tour exactly once per browser — a visitor below `minRole` is
 * never told such a tour exists, and nobody is ever shown a level above
 * their own.
 */
export function RoleTourLauncher({ minRole }: { minRole: RoleId }) {
  const { loading, authenticated, role, memberships } = useAdminAuth()
  const { isActive, startTour } = useOnboarding()

  useEffect(() => {
    if (loading || isActive) return
    const detected = viewerRoleFor({ authenticated, role, memberships })
    if (ROLE_ORDER.indexOf(detected) < ROLE_ORDER.indexOf(minRole)) return
    const key = `obsidian.tour.role.${detected}`
    if (readFlag(key)) return
    writeFlag(key)
    startTour(detected)
  }, [loading, authenticated, role, memberships, isActive, minRole, startTour])

  return null
}

export default RoleTourLauncher
