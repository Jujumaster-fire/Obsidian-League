'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { BrandedLoader, Skeleton } from '@/components/Skeleton'

/**
 * /admin/tournaments — tournament CRUD.
 *
 * `tournaments` is publicly readable but app_admin-only for writes, so the
 * create/edit/delete/activate controls are hidden for tournament members (they
 * get a scope note listing the tournaments they manage instead) and RLS stays
 * the final authority for every request. Only one row may be active at a time
 * (partial unique index `uq_tournaments_single_active`), so "Make active"
 * clears the current active row before setting the target one.
 */

type TournamentStatus = 'upcoming' | 'active' | 'archived'

interface TournamentRow {
  id: string
  name: string
  slug: string
  edition: string | null
  venue_city: string | null
  start_date: string | null
  end_date: string | null
  status: TournamentStatus
  is_active: boolean
}

interface TournamentDraft {
  name: string
  slug: string
  edition: string
  venue_city: string
  start_date: string
  end_date: string
  status: TournamentStatus
}

const STATUS_OPTIONS: TournamentStatus[] = ['upcoming', 'active', 'archived']

const EMPTY_DRAFT: TournamentDraft = {
  name: '',
  slug: '',
  edition: '',
  venue_city: '',
  start_date: '',
  end_date: '',
  status: 'upcoming',
}

const DUTY_LABELS: Record<string, string> = {
  '*': 'Full manager',
  score: 'Scores',
  posts: 'News & posts',
}

const PANEL = 'bg-[#1e293b] rounded-xl border border-white/5 p-6'
const INPUT =
  'w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-white focus:border-indigo-500 focus:outline-none'
const PRIMARY =
  'bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60'
const DANGER =
  'bg-red-600 hover:bg-red-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60'
const SECONDARY =
  'rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 disabled:opacity-60'

/** Lowercase, non-alphanumerics to dashes, trimmed, runs collapsed. */
const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const orNull = (value: string) => {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Not set'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const formatDuties = (duties: string[]) =>
  duties.length > 0 ? duties.map((duty) => DUTY_LABELS[duty] ?? duty).join(', ') : 'No duties yet'

const sortTournaments = (rows: TournamentRow[]): TournamentRow[] =>
  [...rows].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return (b.start_date ?? '').localeCompare(a.start_date ?? '')
  })

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      {children}
    </label>
  )
}

export default function AdminTournamentsPage() {
  const { loading: authLoading, authenticated, canAccessAdmin, isAppAdmin, memberships } =
    useAdminAuth()
  const supabase = useMemo(() => createClient(), [])
  const pathname = usePathname()

  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [createDraft, setCreateDraft] = useState<TournamentDraft>(EMPTY_DRAFT)
  const [slugEdited, setSlugEdited] = useState(false)
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<TournamentDraft>(EMPTY_DRAFT)
  const [savingEdit, setSavingEdit] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setDataLoading(true)
    const { data, error: queryError } = await supabase
      .from('tournaments')
      .select('id, name, slug, edition, venue_city, start_date, end_date, status, is_active')
      .order('is_active', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false })

    if (queryError) {
      setError(queryError.message)
      setTournaments([])
      setDataLoading(false)
      return
    }

    const rows = Array.isArray(data) ? (data as TournamentRow[]) : []
    setTournaments(sortTournaments(rows))
    setDataLoading(false)
  }, [supabase])

  useEffect(() => {
    if (authLoading || !authenticated || !canAccessAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void load()
  }, [authLoading, authenticated, canAccessAdmin, load])

  const createTournament = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isAppAdmin) {
      setError('Only app admins can create tournaments.')
      return
    }

    const name = createDraft.name.trim()
    const slug = slugify(createDraft.slug.trim() || createDraft.name)
    if (!name) {
      setError('A tournament name is required.')
      return
    }
    if (!slug) {
      setError('The slug needs at least one letter or number.')
      return
    }

    setCreating(true)
    setError(null)
    setNotice(null)

    const { error: insertError } = await supabase.from('tournaments').insert({
      name,
      slug,
      edition: orNull(createDraft.edition),
      venue_city: orNull(createDraft.venue_city),
      start_date: orNull(createDraft.start_date),
      end_date: orNull(createDraft.end_date),
      status: createDraft.status,
    })

    if (insertError) {
      setError(insertError.message)
      setCreating(false)
      return
    }

    setCreateDraft(EMPTY_DRAFT)
    setSlugEdited(false)
    setCreating(false)
    setNotice(`Created ${name}.`)
    await load()
  }

  const startEdit = (row: TournamentRow) => {
    setEditingId(row.id)
    setEditDraft({
      name: row.name,
      slug: row.slug,
      edition: row.edition ?? '',
      venue_city: row.venue_city ?? '',
      start_date: row.start_date ?? '',
      end_date: row.end_date ?? '',
      status: row.status,
    })
    setConfirmingDeleteId(null)
    setError(null)
    setNotice(null)
  }

  const saveEdit = async (event: React.FormEvent, row: TournamentRow) => {
    event.preventDefault()
    if (!isAppAdmin) {
      setError('Only app admins can edit tournaments.')
      return
    }

    const name = editDraft.name.trim()
    const slug = slugify(editDraft.slug.trim() || editDraft.name)
    if (!name) {
      setError('A tournament name is required.')
      return
    }
    if (!slug) {
      setError('The slug needs at least one letter or number.')
      return
    }

    setSavingEdit(true)
    setError(null)
    setNotice(null)

    const { error: updateError } = await supabase
      .from('tournaments')
      .update({
        name,
        slug,
        edition: orNull(editDraft.edition),
        venue_city: orNull(editDraft.venue_city),
        start_date: orNull(editDraft.start_date),
        end_date: orNull(editDraft.end_date),
        status: editDraft.status,
      })
      .eq('id', row.id)

    if (updateError) {
      setError(updateError.message)
      setSavingEdit(false)
      return
    }

    setSavingEdit(false)
    setEditingId(null)
    setNotice(`Saved ${name}.`)
    await load()
  }

  const deleteTournament = async (row: TournamentRow) => {
    setBusyId(row.id)
    setError(null)
    setNotice(null)

    const { error: deleteError } = await supabase.from('tournaments').delete().eq('id', row.id)

    if (deleteError) {
      setError(deleteError.message)
      setBusyId(null)
      return
    }

    setConfirmingDeleteId(null)
    setBusyId(null)
    setNotice(`Deleted ${row.name}.`)
    await load()
  }

  const makeActive = async (row: TournamentRow) => {
    if (row.is_active) return
    setBusyId(row.id)
    setError(null)
    setNotice(null)

    // Clear the current active row first: the partial unique index allows at
    // most one `is_active = true` row, so setting the target first would fail.
    const { error: clearError } = await supabase
      .from('tournaments')
      .update({ is_active: false })
      .eq('is_active', true)
      .neq('id', row.id)

    if (clearError) {
      setError(clearError.message)
      setBusyId(null)
      return
    }

    const { error: activateError } = await supabase
      .from('tournaments')
      .update({ is_active: true })
      .eq('id', row.id)

    if (activateError) {
      setError(activateError.message)
      setBusyId(null)
      return
    }

    setBusyId(null)
    setNotice(`${row.name} is now the active tournament.`)
    await load()
  }

  const updateCreateDraft = (patch: Partial<TournamentDraft>) =>
    setCreateDraft((previous) => ({ ...previous, ...patch }))

  const updateEditDraft = (patch: Partial<TournamentDraft>) =>
    setEditDraft((previous) => ({ ...previous, ...patch }))

  if (authLoading) return <BrandedLoader message="Checking access…" />

  if (!authenticated) {
    return (
      <GatePanel
        title="Sign in required"
        body="You need an account to manage tournaments."
        href={`/login?next=${encodeURIComponent(pathname)}`}
        action="Sign in"
      />
    )
  }

  if (!canAccessAdmin) {
    return (
      <GatePanel
        title="No access"
        body="Your account is not an app admin and does not manage any tournament."
        href="/"
        action="Back to home"
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Admin</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Tournaments</h1>
            <p className="text-sm text-gray-400">
              Every edition in the database. Open one to manage its settings, posts, invites,
              members and sports.
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
        </header>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-green-400">{notice}</p>}

        {!isAppAdmin && (
          <section className={PANEL}>
            <h2 className="text-lg font-semibold">Your manager scope</h2>
            <p className="mt-1 text-sm text-gray-400">
              Creating, editing, deleting or activating tournaments is limited to app admins. You
              manage the tournaments below.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {memberships.length === 0 && (
                <li className="text-gray-400">You have no tournament memberships yet.</li>
              )}
              {memberships.map((membership) => (
                <li
                  key={membership.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-[#0f172a] px-3 py-2"
                >
                  <Link
                    href={`/admin/tournaments/${membership.tournament_id}`}
                    className="font-medium text-indigo-300 hover:text-indigo-200"
                  >
                    {membership.tournament_name || membership.tournament_slug || 'Tournament'}
                  </Link>
                  <span className="text-xs text-gray-400">{formatDuties(membership.duties)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {isAppAdmin && (
          <section data-tour="tournaments-new" className={PANEL}>
            <h2 className="text-lg font-semibold">New tournament</h2>
            <p className="mt-1 text-sm text-gray-400">
              The slug is derived from the name (lower case, dashes) but stays editable, and must be
              unique.
            </p>
            <form
              onSubmit={createTournament}
              className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <Field label="Name">
                <input
                  className={INPUT}
                  value={createDraft.name}
                  onChange={(event) => {
                    const name = event.target.value
                    updateCreateDraft({
                      name,
                      slug: slugEdited ? createDraft.slug : slugify(name),
                    })
                  }}
                  placeholder="City Games 2027"
                />
              </Field>
              <Field label="Slug">
                <input
                  className={INPUT}
                  value={createDraft.slug}
                  onChange={(event) => {
                    setSlugEdited(true)
                    updateCreateDraft({ slug: event.target.value })
                  }}
                  placeholder="city-games-2027"
                />
              </Field>
              <Field label="Edition">
                <input
                  className={INPUT}
                  value={createDraft.edition}
                  onChange={(event) => updateCreateDraft({ edition: event.target.value })}
                  placeholder="3rd edition"
                />
              </Field>
              <Field label="Venue city">
                <input
                  className={INPUT}
                  value={createDraft.venue_city}
                  onChange={(event) => updateCreateDraft({ venue_city: event.target.value })}
                  placeholder="Kigali"
                />
              </Field>
              <Field label="Start date">
                <input
                  type="date"
                  className={INPUT}
                  value={createDraft.start_date}
                  onChange={(event) => updateCreateDraft({ start_date: event.target.value })}
                />
              </Field>
              <Field label="End date">
                <input
                  type="date"
                  className={INPUT}
                  value={createDraft.end_date}
                  onChange={(event) => updateCreateDraft({ end_date: event.target.value })}
                />
              </Field>
              <Field label="Status">
                <select
                  className={INPUT}
                  value={createDraft.status}
                  onChange={(event) =>
                    updateCreateDraft({ status: event.target.value as TournamentStatus })
                  }
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end sm:col-span-2 lg:col-span-3">
                <button type="submit" className={PRIMARY} disabled={creating}>
                  {creating ? 'Creating…' : 'Create tournament'}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="space-y-4">
          {dataLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          ) : tournaments.length === 0 ? (
            <p className={`${PANEL} text-sm text-gray-400`}>
              No tournaments in the database yet. Create the first one above.
            </p>
          ) : (
            <ul className="space-y-4">
              {tournaments.map((row) => {
                const busy = busyId === row.id
                const editing = editingId === row.id
                const confirmingDelete = confirmingDeleteId === row.id

                return (
                  <li key={row.id} className={PANEL}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/tournaments/${row.id}`}
                            className="text-lg font-semibold hover:text-indigo-300"
                          >
                            {row.name}
                          </Link>
                          {row.is_active && (
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-400">
                              Active
                            </span>
                          )}
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                            {row.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-400">
                          {row.edition ?? 'No edition'} · {row.venue_city ?? 'No venue'}
                        </p>
                        <p className="text-sm text-gray-400">
                          {formatDate(row.start_date)} to {formatDate(row.end_date)} · /{row.slug}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/tournaments/${row.id}`} className={SECONDARY}>
                          Manage
                        </Link>
                        {isAppAdmin && (
                          <>
                            <button
                              type="button"
                              className={SECONDARY}
                              disabled={busy}
                              onClick={() => (editing ? setEditingId(null) : startEdit(row))}
                            >
                              {editing ? 'Close editor' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              className={SECONDARY}
                              disabled={busy || row.is_active || editing}
                              onClick={() => void makeActive(row)}
                            >
                              {busy
                                ? 'Working…'
                                : row.is_active
                                  ? 'Currently active'
                                  : 'Make active'}
                            </button>
                            <button
                              type="button"
                              className={DANGER}
                              disabled={busy || editing}
                              onClick={() => setConfirmingDeleteId(row.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {confirmingDelete && (
                      <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                        <p>
                          Delete {row.name}? This also removes its settings, posts, sport links and
                          fixtures. Teams are kept but unlinked from the tournament.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={DANGER}
                            disabled={busy}
                            onClick={() => void deleteTournament(row)}
                          >
                            {busy ? 'Deleting…' : 'Confirm delete'}
                          </button>
                          <button
                            type="button"
                            className={SECONDARY}
                            disabled={busy}
                            onClick={() => setConfirmingDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {editing && (
                      <form
                        onSubmit={(event) => {
                          void saveEdit(event, row)
                        }}
                        className="mt-4 grid grid-cols-1 gap-4 border-t border-white/5 pt-4 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        <Field label="Name">
                          <input
                            className={INPUT}
                            value={editDraft.name}
                            onChange={(event) => updateEditDraft({ name: event.target.value })}
                          />
                        </Field>
                        <Field label="Slug">
                          <input
                            className={INPUT}
                            value={editDraft.slug}
                            onChange={(event) => updateEditDraft({ slug: event.target.value })}
                          />
                        </Field>
                        <Field label="Edition">
                          <input
                            className={INPUT}
                            value={editDraft.edition}
                            onChange={(event) => updateEditDraft({ edition: event.target.value })}
                          />
                        </Field>
                        <Field label="Venue city">
                          <input
                            className={INPUT}
                            value={editDraft.venue_city}
                            onChange={(event) =>
                              updateEditDraft({ venue_city: event.target.value })
                            }
                          />
                        </Field>
                        <Field label="Start date">
                          <input
                            type="date"
                            className={INPUT}
                            value={editDraft.start_date}
                            onChange={(event) =>
                              updateEditDraft({ start_date: event.target.value })
                            }
                          />
                        </Field>
                        <Field label="End date">
                          <input
                            type="date"
                            className={INPUT}
                            value={editDraft.end_date}
                            onChange={(event) => updateEditDraft({ end_date: event.target.value })}
                          />
                        </Field>
                        <Field label="Status">
                          <select
                            className={INPUT}
                            value={editDraft.status}
                            onChange={(event) =>
                              updateEditDraft({ status: event.target.value as TournamentStatus })
                            }
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
                          <button type="submit" className={PRIMARY} disabled={savingEdit}>
                            {savingEdit ? 'Saving…' : 'Save changes'}
                          </button>
                          <button
                            type="button"
                            className={SECONDARY}
                            disabled={savingEdit}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}