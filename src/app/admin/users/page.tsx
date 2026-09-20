'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { BrandedLoader, Skeleton } from '@/components/Skeleton'

/**
 * /admin/users — app-admin-only user administration.
 *
 * Emails live in `auth.users`, which the anon key cannot read, so every row
 * comes from the `list_app_users()` RPC (SECURITY DEFINER, app_admin-gated)
 * and role changes go through `set_user_role()`. That RPC also rejects
 * self-demotion, so the current user's own row is locked in the UI and the
 * reason is spelled out instead of letting the request fail.
 */

type RoleValue = 'app_admin' | 'tournament_admin' | 'user'

interface AppUserRow {
  user_id: string
  email: string | null
  role: RoleValue
  created_at: string | null
}

const ROLE_OPTIONS: { value: RoleValue; label: string }[] = [
  { value: 'app_admin', label: 'App admin' },
  { value: 'tournament_admin', label: 'Tournament admin' },
  { value: 'user', label: 'User' },
]

const ROLE_LABELS: Record<RoleValue, string> = {
  app_admin: 'App admin',
  tournament_admin: 'Tournament admin',
  user: 'User',
}

const PANEL = 'bg-[#1e293b] rounded-xl border border-white/5 p-6'
const INPUT =
  'w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-white focus:border-indigo-500 focus:outline-none'
const PRIMARY =
  'bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60'
const SECONDARY =
  'rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 disabled:opacity-60'

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const roleLabel = (role: RoleValue) => ROLE_LABELS[role] ?? role

function GatePanel({
  title,
  body,
  href,
  action,
}: {
  title: string
  body: string
  href: string
  action: string
}) {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24">
        <div className="mx-auto max-w-lg bg-[#1e293b] rounded-xl border border-white/5 p-8 text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-gray-400">{body}</p>
          <Link href={href} className={`mt-6 inline-block ${PRIMARY}`}>
            {action}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function AdminUsersPage() {
  const { loading: authLoading, authenticated, isAppAdmin } = useAdminAuth()
  const supabase = useMemo(() => createClient(), [])
  const pathname = usePathname()

  const [users, setUsers] = useState<AppUserRow[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<Record<string, RoleValue>>({})
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setDataLoading(true)
    setError(null)

    const [usersResult, userResult] = await Promise.all([
      supabase.rpc('list_app_users'),
      supabase.auth.getUser(),
    ])

    const rows = Array.isArray(usersResult.data) ? (usersResult.data as AppUserRow[]) : []
    setUsers(rows)
    setSelectedRole(
      rows.reduce<Record<string, RoleValue>>((accumulator, row) => {
        accumulator[row.user_id] = row.role
        return accumulator
      }, {})
    )
    setCurrentUserId(userResult.data.user?.id ?? null)
    if (usersResult.error) setError(usersResult.error.message)
    setDataLoading(false)
  }, [supabase])

  useEffect(() => {
    if (authLoading || !authenticated || !isAppAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void load()
  }, [authLoading, authenticated, isAppAdmin, load])

  const selectRole = (userId: string, role: RoleValue) => {
    setSelectedRole((previous) => ({ ...previous, [userId]: role }))
    setConfirmingId(null)
    setNotice(null)
  }

  const saveRole = async (user: AppUserRow) => {
    const nextRole = selectedRole[user.user_id] ?? user.role
    if (nextRole === user.role) {
      setError(`${user.email ?? 'This user'} already has that role.`)
      setConfirmingId(null)
      return
    }

    setSavingId(user.user_id)
    setError(null)
    setNotice(null)

    const { error: rpcError } = await supabase.rpc('set_user_role', {
      p_user_id: user.user_id,
      p_role: nextRole,
    })

    if (rpcError) {
      setError(rpcError.message)
      setSavingId(null)
      setConfirmingId(null)
      return
    }

    setUsers((previous) =>
      previous.map((row) => (row.user_id === user.user_id ? { ...row, role: nextRole } : row))
    )
    setNotice(`${user.email ?? 'User'} is now ${roleLabel(nextRole)}.`)
    setSavingId(null)
    setConfirmingId(null)
  }

  const adminCount = users.filter((user) => user.role === 'app_admin').length

  if (authLoading) return <BrandedLoader message="Checking access…" />

  if (!authenticated) {
    return (
      <GatePanel
        title="Sign in required"
        body="You need an account to view the user directory."
        href={`/login?next=${encodeURIComponent(pathname)}`}
        action="Sign in"
      />
    )
  }

  if (!isAppAdmin) {
    return (
      <GatePanel
        title="App admins only"
        body="Only an app admin may list users or change global roles. Tournament access is granted per tournament through invites."
        href="/admin"
        action="Back to dashboard"
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Admin</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Users</h1>
          <p className="text-sm text-gray-400">
            Global roles come from <code className="text-gray-300">user_roles</code>. Tournament
            access is granted per tournament through invites, not here.
          </p>
        </header>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-green-400">{notice}</p>}

        <section data-tour="users-directory" className={PANEL}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Directory</h2>
              <p className="mt-1 text-sm text-gray-400">
                {users.length} {users.length === 1 ? 'user' : 'users'} · {adminCount}{' '}
                {adminCount === 1 ? 'app admin' : 'app admins'}
              </p>
            </div>
            <button
              type="button"
              className={SECONDARY}
              onClick={() => void load()}
              disabled={dataLoading}
            >
              {dataLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {dataLoading ? (
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 text-right font-medium">Change role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map((user) => {
                    const isSelf = user.user_id === currentUserId
                    const pendingRole = selectedRole[user.user_id] ?? user.role
                    const saving = savingId === user.user_id

                    return (
                      <tr key={user.user_id} className="align-top">
                        <td className="px-3 py-3">
                          <p className="font-medium break-all">
                            {user.email ?? 'No email on file'}
                          </p>
                          {isSelf && <p className="mt-1 text-xs text-indigo-300">This is you</p>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{roleLabel(user.role)}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-400">
                          {formatDateTime(user.created_at)}
                        </td>
                        <td className="px-3 py-3">
                          {isSelf ? (
                            <p className="ml-auto max-w-xs text-xs text-gray-400">
                              Your own role is locked: the database rejects self-demotion so an app
                              admin can never lock the last admin out. Ask another app admin to
                              change it.
                            </p>
                          ) : (
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <select
                                  value={pendingRole}
                                  onChange={(event) =>
                                    selectRole(user.user_id, event.target.value as RoleValue)
                                  }
                                  disabled={saving}
                                  className={`${INPUT} sm:w-48`}
                                  aria-label={`Role for ${user.email ?? user.user_id}`}
                                >
                                  {ROLE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className={PRIMARY}
                                  disabled={saving || pendingRole === user.role}
                                  onClick={() => setConfirmingId(user.user_id)}
                                >
                                  Update
                                </button>
                              </div>

                              {confirmingId === user.user_id && (
                                <div className="w-full max-w-sm rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                                  <p>
                                    Change {user.email ?? 'this user'} from {roleLabel(user.role)}{' '}
                                    to {roleLabel(pendingRole)}?
                                  </p>
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      type="button"
                                      className={PRIMARY}
                                      disabled={saving}
                                      onClick={() => void saveRole(user)}
                                    >
                                      {saving ? 'Saving…' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      className={SECONDARY}
                                      disabled={saving}
                                      onClick={() => setConfirmingId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}

                  {users.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                        No users were returned by the directory.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}