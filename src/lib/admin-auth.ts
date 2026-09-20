import type { User } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'

/**
 * Canonical server-side authorization helper.
 *
 * Roles live in `public.user_roles` (app_admin | tournament_admin | user) and
 * per-tournament scope lives in `public.tournament_members.duties`
 * (`'*'` = full manager, otherwise an explicit duty list such as
 * `score` / `posts` / `passes`). The frontend never decides a role: every
 * helper here resolves it against Supabase using the request cookies, and RLS
 * remains the final authority for writes.
 *
 * Prefer these helpers over ad-hoc `user_roles` queries so role semantics stay
 * in one place. Client components should use `useAdminAuth()`
 * (`@/lib/use-admin-auth`), which proxies `/api/admin-auth-info`.
 */

export type AppRole = 'app_admin' | 'tournament_admin' | 'user'

export interface TournamentMembership {
  id: string
  tournament_id: string
  tournament_slug: string
  tournament_name: string
  duties: string[]
}

export interface AuthInfo {
  user: User | null
  role: AppRole | null
  memberships: TournamentMembership[]
  /** Global administrator — may manage every tournament and app-wide data. */
  isAppAdmin: boolean
  /** Member of at least one tournament (scoped write access). */
  isTournamentAdmin: boolean
  /** Allowed into /admin surfaces at all. */
  canAccessAdmin: boolean
}

export const EMPTY_AUTH_INFO: AuthInfo = {
  user: null,
  role: null,
  memberships: [],
  isAppAdmin: false,
  isTournamentAdmin: false,
  canAccessAdmin: false,
}

/**
 * Validated current user (talks to the Auth server — safe for authorization,
 * unlike `getSession()` which only reads the cookie).
 */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ?? null
}

/**
 * Resolve the signed-in user's global role plus every tournament membership.
 * Returns `EMPTY_AUTH_INFO` when signed out or when the role row is missing.
 */
export async function getAuthInfo(): Promise<AuthInfo> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return EMPTY_AUTH_INFO

  const [roleResult, memberResult] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('tournament_members')
      .select('id, tournament_id, duties, tournaments (slug, name)')
      .eq('user_id', user.id),
  ])

  const role = (roleResult.data?.role as AppRole | undefined) ?? null

  const memberships: TournamentMembership[] = (memberResult.data ?? []).map((row) => {
    const tournament = row.tournaments as { slug?: string; name?: string } | null
    return {
      id: String(row.id),
      tournament_id: String(row.tournament_id),
      tournament_slug: tournament?.slug ?? '',
      tournament_name: tournament?.name ?? '',
      duties: (row.duties as string[] | null) ?? [],
    }
  })

  const isAppAdmin = role === 'app_admin'

  return {
    user,
    role,
    memberships,
    isAppAdmin,
    isTournamentAdmin: memberships.length > 0,
    canAccessAdmin: isAppAdmin || memberships.length > 0,
  }
}

/** `true` when the membership duty list grants `duty` (or the `'*'` wildcard). */
export function membershipHasDuty(
  membership: TournamentMembership | undefined,
  duty: string
): boolean {
  if (!membership) return false
  return membership.duties.includes('*') || membership.duties.includes(duty)
}

/** `true` when the current user may write inside `tournamentId` for `duty`. */
export async function canManageTournament(
  tournamentId: string,
  duty = '*'
): Promise<boolean> {
  const info = await getAuthInfo()
  if (info.isAppAdmin) return true
  const membership = info.memberships.find((m) => m.tournament_id === tournamentId)
  return membershipHasDuty(membership, duty)
}
