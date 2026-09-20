'use client'

import { useEffect, useState } from 'react'
import type { AppRole, TournamentMembership } from '@/lib/admin-auth'

export interface AdminAuthState {
  loading: boolean
  authenticated: boolean
  role: AppRole | null
  memberships: TournamentMembership[]
  isAppAdmin: boolean
  isTournamentAdmin: boolean
  canAccessAdmin: boolean
}

const INITIAL_STATE: AdminAuthState = {
  loading: true,
  authenticated: false,
  role: null,
  memberships: [],
  isAppAdmin: false,
  isTournamentAdmin: false,
  canAccessAdmin: false,
}

/**
 * Client-side mirror of `getAuthInfo()`.
 *
 * Fetches `/api/admin-auth-info` — a single, cache-free round trip — so client
 * components never have to duplicate role logic. `/api/admin-auth-info` derives
 * everything from the Supabase session cookie on the server.
 */
export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>(INITIAL_STATE)

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      try {
        const response = await fetch('/api/admin-auth-info', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`Request failed: ${response.status}`)

        const data = (await response.json()) as Partial<AdminAuthState>
        setState({
          loading: false,
          authenticated: Boolean(data.authenticated),
          role: (data.role as AppRole | null) ?? null,
          memberships: data.memberships ?? [],
          isAppAdmin: Boolean(data.isAppAdmin),
          isTournamentAdmin: Boolean(data.isTournamentAdmin),
          canAccessAdmin: Boolean(data.canAccessAdmin),
        })
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return
        setState({ ...INITIAL_STATE, loading: false })
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  return state
}

export default useAdminAuth