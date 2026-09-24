'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { useAdminAuth } from '@/lib/use-admin-auth'
import {
  canLogEventTypes,
  canRecordStatKeys,
  canWriteLineup,
  canWriteScore,
  type DutyContext,
} from '@/lib/duties'
import {
  groupStatOptions,
  parseSportArrangement,
  resolveFixtureRules,
  type SportArrangement,
} from '@/lib/sports'
import {
  AccessPanel,
  Field,
  SelectInput,
  StatusBanner,
  adminInputClass,
  adminPrimaryButton,
  adminSubtleButton,
} from '@/components/admin/AdminWidgets'
import { RoleTourLauncher } from '@/components/onboarding/RoleTourLauncher'

type Side = 'home' | 'away'
type Stats = Record<Side, Record<string, number | undefined>>

interface TeamRef {
  id: string
  name: string
  short_name: string | null
}

interface FixtureRow {
  id: string
  status: string | null
  current_minute: number | null
  home_score: number | null
  away_score: number | null
  tournament_id: string | null
  sport_id: string | null
  stats: Stats | null
  home_team: TeamRef | null
  away_team: TeamRef | null
}

interface MatchEvent {
  id: string
  event_type: string
  team_id: string | null
  player_id: string | null
  player_name: string | null
  minute: number
  details: string | null
}

interface Player {
  id: string
  team_id: string
  name: string
}

interface LineupRow {
  id: string
  slot: number
  player_id: string | null
  is_captain: boolean
}

const EMPTY_EVENT = { event_type: '', team_id: '', player_id: '', minute: '0', details: '' }

/** Reads one cell of the fixture's stats JSONB without ever throwing. */
const statNumber = (stats: Stats, side: Side, key: string): number => {
  const value = stats?.[side]?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * The scout logging surface (`/scout/[id]`).
 *
 * A duty-carrying match-day operator gets exactly the controls their duties
 * cover — score, individual stat counters, event types and the line-up —
 * rendered from the fixture's effective vocabulary (`resolveFixtureRules`),
 * so the same panel serves football, basketball, gymnastics or any other
 * discipline in the catalogue. Every write goes through the duty-checked
 * recorder RPCs (`record_score`, `record_stat`, `set_fixture_stat`,
 * `record_match_event`, `set_fixture_lineup`), and Postgres re-checks the
 * duty on each call.
 *
 * The first time a scout lands here, `RoleTourLauncher` walks them around
 * their own console — and only ever their own level.
 */
export function ScoutLogPanel({ fixtureId }: { fixtureId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const { loading: authLoading, authenticated, isAppAdmin, memberships } = useAdminAuth()

  const [loading, setLoading] = useState(true)
  const [fixture, setFixture] = useState<FixtureRow | null>(null)
  const [sport, setSport] = useState<SportArrangement | null>(null)
  const [stats, setStats] = useState<Stats>({ home: {}, away: {} })
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [lineups, setLineups] = useState<LineupRow[]>([])
  const [homeScore, setHomeScore] = useState(0)
  const [awayScore, setAwayScore] = useState(0)
  const [scoreDraft, setScoreDraft] = useState({ home: '0', away: '0' })
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({})
  const [newEvent, setNewEvent] = useState({ ...EMPTY_EVENT })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  /** Whether `claim_fixture_scope` / `list_fixture_loggers` exist on this DB. */
  const [hasLoggersRpc, setHasLoggersRpc] = useState(true)

  const notify = useCallback(
    (kind: 'success' | 'error', message: string) => setStatus({ kind, message }),
    [],
  )

  const loadMatch = useCallback(async () => {
    const { data, error } = await supabase
      .from('fixtures')
      .select(
        'id, status, current_minute, home_score, away_score, tournament_id, sport_id, stats, home_team:home_team_id(id, name, short_name), away_team:away_team_id(id, name, short_name)',
      )
      .eq('id', fixtureId)
      .maybeSingle()

    if (error) {
      notify('error', `Could not load fixture: ${error.message}`)
      setLoading(false)
      return
    }

    const row = data as unknown as FixtureRow | null
    setFixture(row)
    if (row) {
      setHomeScore(row.home_score ?? 0)
      setAwayScore(row.away_score ?? 0)
      setScoreDraft({ home: String(row.home_score ?? 0), away: String(row.away_score ?? 0) })
      setStats({
        home: { ...(row.stats?.home ?? {}) },
        away: { ...(row.stats?.away ?? {}) },
      })
      setNewEvent((current) => ({ ...current, minute: String(row.current_minute ?? 0) }))
    }

    if (row?.sport_id) {
      const { data: sportRow } = await supabase
        .from('sports')
        .select('id, code, name, scoring_type, stat_vocab, event_vocab, scoring_config')
        .eq('id', row.sport_id)
        .maybeSingle()
      setSport(
        sportRow ? parseSportArrangement(sportRow as Parameters<typeof parseSportArrangement>[0]) : null,
      )
    } else {
      setSport(null)
    }

    const teamIds = [row?.home_team?.id, row?.away_team?.id].filter(Boolean) as string[]
    const [eventsRes, playersRes, lineupRes, loggersProbe] = await Promise.all([
      supabase
        .from('match_events')
        .select('id, event_type, team_id, player_id, player_name, minute, details, created_at')
        .eq('fixture_id', fixtureId)
        .order('minute', { ascending: false }),
      teamIds.length > 0
        ? supabase.from('players').select('id, team_id, name').in('team_id', teamIds)
        : Promise.resolve({ data: [] as Player[] }),
      supabase
        .from('fixture_lineups')
        .select('id, slot, player_id, is_captain')
        .eq('fixture_id', fixtureId)
        .order('slot', { ascending: true }),
      supabase.rpc('list_fixture_loggers', { p_fixture_id: fixtureId }),
    ])

    setEvents((Array.isArray(eventsRes.data) ? eventsRes.data : []) as MatchEvent[])
    setPlayers((Array.isArray(playersRes.data) ? playersRes.data : []) as Player[])
    if (!lineupRes.error && Array.isArray(lineupRes.data)) {
      setLineups(
        (lineupRes.data as Record<string, unknown>[]).map((entry) => ({
          id: String(entry.id),
          slot: Number(entry.slot),
          player_id: (entry.player_id as string | null) ?? null,
          is_captain: Boolean(entry.is_captain),
        })),
      )
    }
    setHasLoggersRpc(!loggersProbe.error)
    setLoading(false)
  }, [supabase, fixtureId, notify])

  useEffect(() => {
    if (authLoading || !authenticated) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void loadMatch()
  }, [authLoading, authenticated, loadMatch])
  /* Live scoreboard: another operator's writes stream straight into this panel. */
  useEffect(() => {
    if (!fixture) return
    const channel = supabase
      .channel(`scout-fixture-${fixtureId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'fixtures', filter: `id=eq.${fixtureId}` },
        (payload) => {
          const next = payload.new as {
            home_score?: number
            away_score?: number
            current_minute?: number
            status?: string
            stats?: Stats
          }
          setHomeScore(next.home_score ?? 0)
          setAwayScore(next.away_score ?? 0)
          setStats({
            home: { ...(next.stats?.home ?? {}) },
            away: { ...(next.stats?.away ?? {}) },
          })
          setFixture((current) =>
            current
              ? {
                  ...current,
                  home_score: next.home_score ?? current.home_score,
                  away_score: next.away_score ?? current.away_score,
                  current_minute: next.current_minute ?? current.current_minute,
                  status: next.status ?? current.status,
                }
              : current,
          )
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_events',
          filter: `fixture_id=eq.${fixtureId}`,
        },
        (payload) => {
          const row = payload.new as MatchEvent
          setEvents((current) => [row, ...current.filter((entry) => entry.id !== row.id)])
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, fixtureId, fixture])

  /** Reserve a logging stream for this operator; one holder per stream per match. */
  const claimScope = useCallback(
    async (scope: string) => {
      if (!hasLoggersRpc) return true
      const { error } = await supabase.rpc('claim_fixture_scope', {
        p_fixture_id: fixtureId,
        p_scope: scope,
      })
      if (error) {
        notify('error', error.message)
        return false
      }
      return true
    },
    [supabase, fixtureId, hasLoggersRpc, notify],
  )

  /* Effective vocabulary for this fixture, exactly as the write RPCs see it. */
  const resolvedRules = useMemo(
    () =>
      resolveFixtureRules({
        sport,
        scoringType: fixture?.sport_id ? sport?.scoringType ?? null : null,
        rulesOverride: null,
        fallbackName: fixture?.home_team?.name
          ? `${fixture.home_team.name} vs ${fixture?.away_team?.name ?? 'Away'}`
          : 'Match',
      }),
    [sport, fixture],
  )
  const { statOptions, eventOptions } = resolvedRules

  const dutyContext: DutyContext = useMemo(() => {
    const membership = memberships.find((row) => row.tournament_id === fixture?.tournament_id)
    return {
      isAppAdmin,
      duties: membership?.duties ?? [],
      fixtureId: fixture?.id ?? null,
    }
  }, [memberships, fixture, isAppAdmin])

  const canScore = canWriteScore(dutyContext)
  const canLineup = canWriteLineup(dutyContext)
  const statAccess = useMemo(
    () => canRecordStatKeys(dutyContext, statOptions.map((option) => option.key)),
    [dutyContext, statOptions],
  )
  const eventAccess = useMemo(
    () => canLogEventTypes(dutyContext, eventOptions.map((option) => option.type)),
    [dutyContext, eventOptions],
  )
  const statGroups = useMemo(() => groupStatOptions(statOptions), [statOptions])
  const loggableEvents = eventOptions.filter((option) => eventAccess[option.type])

  /** This account holds no duty on this fixture's tournament at all. */
  const hasAnyDuty =
    isAppAdmin ||
    (memberships.find((row) => row.tournament_id === fixture?.tournament_id)?.duties?.length ?? 0) > 0

  const bustPublicCache = async () => {
    try {
      await fetch('/api/revalidate', { method: 'POST' })
    } catch {
      /* best effort — the ISR window still converges */
    }
  }


  /** Atomic score write via `record_score()` (duty-checked in Postgres). */
  const saveScore = async (event: React.FormEvent) => {
    event.preventDefault()
    const home = Number.parseInt(scoreDraft.home, 10)
    const away = Number.parseInt(scoreDraft.away, 10)
    if (Number.isNaN(home) || Number.isNaN(away) || home < 0 || away < 0) {
      notify('error', 'Enter whole, non-negative scores.')
      return
    }
    if (!(await claimScope('score'))) return
    setBusy(true)
    const { error } = await supabase.rpc('record_score', {
      p_fixture_id: fixtureId,
      p_home: home,
      p_away: away,
    })
    setBusy(false)
    if (error) {
      notify('error', error.message)
      return
    }
    setHomeScore(home)
    setAwayScore(away)
    notify('success', `Score saved: ${home}-${away}.`)
    await bustPublicCache()
  }

  /**
   * Atomic per-stat increment via `record_stat()`; measured stats
   * (`input: 'value'` in the vocab) go through `set_fixture_stat()`. Both
   * return the authoritative value, so local state mirrors the database.
   */
  const bumpStat = async (side: Side, key: string) => {
    if (!(await claimScope(`stat:${key}`))) return
    setBusy(true)
    const { data, error } = await supabase.rpc('record_stat', {
      p_fixture_id: fixtureId,
      p_side: side,
      p_stat_key: key,
    })
    setBusy(false)
    if (error) {
      notify('error', error.message)
      return
    }
    const nextValue = typeof data === 'number' ? data : statNumber(stats, side, key) + 1
    setStats((current) => ({ ...current, [side]: { ...current[side], [key]: nextValue } }))
  }

  const setStatValue = async (side: Side, key: string) => {
    const raw = (valueInputs[`${side}:${key}`] ?? '').trim()
    const parsed = Number(raw)
    if (raw === '' || Number.isNaN(parsed)) {
      notify('error', 'Enter a numeric value for this stat.')
      return
    }
    if (!(await claimScope(`stat:${key}`))) return
    setBusy(true)
    const { data, error } = await supabase.rpc('set_fixture_stat', {
      p_fixture_id: fixtureId,
      p_side: side,
      p_stat_key: key,
      p_value: parsed,
    })
    setBusy(false)
    if (error) {
      notify('error', error.message)
      return
    }
    const nextValue = typeof data === 'number' ? data : parsed
    setStats((current) => ({ ...current, [side]: { ...current[side], [key]: nextValue } }))
    setValueInputs((current) => ({ ...current, [`${side}:${key}`]: '' }))
    notify('success', 'Value recorded.')
  }


  /** Timeline write via the duty-checked `record_match_event()` RPC. */
  const addEvent = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loggableEvents.length === 0) return
    const eventType = newEvent.event_type || loggableEvents[0].type
    const teamId = newEvent.team_id || fixture?.home_team?.id || null
    const scorer = players.find((row) => row.id === newEvent.player_id) ?? null
    const parsedMinute = Number.parseInt(newEvent.minute, 10)
    const minuteValue = Number.isNaN(parsedMinute) || parsedMinute < 0 ? 0 : parsedMinute
    const details = newEvent.details.trim() || null

    if (!(await claimScope(`event:${eventType}`))) return
    setBusy(true)
    const { error } = await supabase.rpc('record_match_event', {
      p_fixture_id: fixtureId,
      p_event_type: eventType,
      p_team_id: teamId,
      p_player_id: scorer?.id ?? null,
      p_player_name: scorer?.name ?? null,
      p_assist_player_id: null,
      p_minute: minuteValue,
      p_details: details,
    })
    setBusy(false)
    if (error) {
      notify('error', `Could not log the event: ${error.message}`)
      return
    }
    setNewEvent({ ...EMPTY_EVENT, event_type: eventType, team_id: teamId ?? '', minute: String(minuteValue) })
    notify('success', 'Event logged.')
    await bustPublicCache()
  }

  const deleteEvent = async (eventId: string) => {
    const target = events.find((row) => row.id === eventId)
    if (target && !(await claimScope(`event:${target.event_type}`))) return
    setBusy(true)
    const { error } = await supabase.rpc('delete_match_event', {
      p_event_id: eventId,
      p_force: false,
    })
    setBusy(false)
    if (error) {
      notify('error', `Could not delete the event: ${error.message}`)
      return
    }
    setEvents((current) => current.filter((row) => row.id !== eventId))
    notify('success', 'Event deleted.')
    await bustPublicCache()
  }

  /** Line-up naming via `set_fixture_lineup()` — its own duty, separate from scoring. */
  const addToLineup = async (teamId: string, playerId: string) => {
    if (!playerId) return
    if (!(await claimScope('lineup'))) return
    const used = new Set(
      lineups
        .filter((row) => players.some((p) => p.id === row.player_id && p.team_id === teamId))
        .map((row) => row.slot),
    )
    let slot = 1
    while (used.has(slot) && slot < 99) slot += 1
    setBusy(true)
    const { error } = await supabase.rpc('set_fixture_lineup', {
      p_fixture_id: fixtureId,
      p_team_id: teamId,
      p_slot: slot,
      p_x: null,
      p_y: null,
      p_player_id: playerId,
      p_athlete_id: null,
      p_role: null,
      p_is_captain: false,
      p_remove: false,
    })
    setBusy(false)
    if (error) {
      notify('error', `Could not name the line-up: ${error.message}`)
      return
    }
    notify('success', 'Added to the line-up.')
    await loadMatch()
  }

  const removeFromLineup = async (row: LineupRow, teamId: string) => {
    if (!(await claimScope('lineup'))) return
    setBusy(true)
    const { error } = await supabase.rpc('set_fixture_lineup', {
      p_fixture_id: fixtureId,
      p_team_id: teamId,
      p_slot: row.slot,
      p_x: null,
      p_y: null,
      p_player_id: row.player_id,
      p_remove: true,
    })
    setBusy(false)
    if (error) {
      notify('error', `Could not update the line-up: ${error.message}`)
      return
    }
    setLineups((current) => current.filter((entry) => entry.id !== row.id))
    notify('success', 'Removed from the line-up.')
  }


  if (authLoading || loading) {
    return <div className="h-48 animate-pulse rounded-xl bg-white/10" />
  }

  if (!authenticated) {
    return (
      <AccessPanel
        title="Sign in required"
        body="The logging panel is only available to signed-in match staff."
        href={`/login?next=${encodeURIComponent(`/scout/${fixtureId}`)}`}
        linkLabel="Sign in"
      />
    )
  }

  if (!fixture) {
    return (
      <AccessPanel
        title="Match not found"
        body="This fixture does not exist or is not visible to your account."
        href="/competitions"
        linkLabel="Browse competitions"
      />
    )
  }

  if (!hasAnyDuty) {
    return (
      <AccessPanel
        title="No logging duties"
        body="Your account holds no logging duties for this match. Duties are granted by the people who run the tournament."
        href="/"
        linkLabel="Back to the site"
      />
    )
  }

  const sides: { id: Side; team: TeamRef | null }[] = [
    { id: 'home', team: fixture.home_team },
    { id: 'away', team: fixture.away_team },
  ]
  const teamOptions = sides
    .filter((side) => side.team)
    .map((side) => ({ value: side.team!.id, label: side.team!.name }))

  return (
    <div className="space-y-8">
      {/* First visit: walk this operator around their own console. */}
      <RoleTourLauncher minRole="scout" />

      <header
        data-tour="console-header"
        className="rounded-xl border border-white/5 bg-[#1e293b] p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
          Match logging
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          {fixture.home_team?.name ?? 'Home'}{' '}
          <span className="text-indigo-300">
            {homeScore} – {awayScore}
          </span>{' '}
          {fixture.away_team?.name ?? 'Away'}
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {(fixture.status ?? 'scheduled').replace(/_/g, ' ')} · minute {fixture.current_minute ?? 0}
        </p>
        <p className="mt-3 text-xs text-gray-500">
          You see only the controls your duties cover; every tap is re-checked in the database.
        </p>
      </header>

      <StatusBanner status={status} />

      {canScore && (
        <section className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
          <h2 className="mb-4 text-lg font-semibold">Score</h2>
          <form onSubmit={(event) => void saveScore(event)} className="flex flex-wrap items-end gap-4">
            <Field label={fixture.home_team?.name ?? 'Home'}>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className={adminInputClass}
                value={scoreDraft.home}
                onChange={(event) => setScoreDraft({ ...scoreDraft, home: event.target.value })}
              />
            </Field>
            <Field label={fixture.away_team?.name ?? 'Away'}>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className={adminInputClass}
                value={scoreDraft.away}
                onChange={(event) => setScoreDraft({ ...scoreDraft, away: event.target.value })}
              />
            </Field>
            <button type="submit" disabled={busy} className={adminPrimaryButton}>
              {busy ? 'Saving…' : 'Save score'}
            </button>
          </form>
        </section>
      )}


      {statGroups.some((group) => group.options.some((option) => statAccess[option.key])) && (
        <section data-tour="console-stats" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
          <h2 className="mb-4 text-lg font-semibold">Statistics</h2>
          <div className="space-y-6">
            {statGroups.map((group) => {
              const writable = group.options.filter((option) => statAccess[option.key])
              if (writable.length === 0) return null
              return (
                <div key={group.group ?? 'General'}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-400">
                    {group.group ?? 'General'}
                  </h3>
                  <div className="space-y-2">
                    {writable.map((option) => (
                      <div
                        key={option.key}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg bg-white/5 px-3 py-2"
                      >
                        <span className="text-sm text-gray-200">{option.label}</span>
                        {sides.map((side) => (
                          <div key={side.id} className="flex items-center gap-2">
                            <span className="w-8 text-center text-sm font-semibold text-indigo-300">
                              {statNumber(stats, side.id, option.key)}
                            </span>
                            {option.input === 'value' ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder={side.team?.short_name ?? side.id}
                                  className="w-20 rounded-md border border-white/10 bg-[#0f172a] px-2 py-1 text-sm"
                                  value={valueInputs[`${side.id}:${option.key}`] ?? ''}
                                  onChange={(event) =>
                                    setValueInputs((current) => ({
                                      ...current,
                                      [`${side.id}:${option.key}`]: event.target.value,
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void setStatValue(side.id, option.key)}
                                  className={adminSubtleButton}
                                >
                                  Set
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void bumpStat(side.id, option.key)}
                                className={adminSubtleButton}
                                title={side.team?.name ?? side.id}
                              >
                                +1 {side.team?.short_name ?? side.id}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}


      {loggableEvents.length > 0 && (
        <section data-tour="console-timeline" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
          <h2 className="mb-4 text-lg font-semibold">Timeline</h2>
          <form
            onSubmit={(event) => void addEvent(event)}
            className="mb-6 grid gap-4 md:grid-cols-5"
          >
            <Field label="Event">
              <SelectInput
                value={
                  loggableEvents.some((option) => option.type === newEvent.event_type)
                    ? newEvent.event_type
                    : loggableEvents[0].type
                }
                onValueChange={(value) => setNewEvent({ ...newEvent, event_type: value })}
                options={loggableEvents.map((option) => ({ value: option.type, label: option.label }))}
              />
            </Field>
            <Field label="Team">
              <SelectInput
                value={
                  teamOptions.some((option) => option.value === newEvent.team_id)
                    ? newEvent.team_id
                    : (teamOptions[0]?.value ?? '')
                }
                onValueChange={(value) => setNewEvent({ ...newEvent, team_id: value, player_id: '' })}
                options={teamOptions}
              />
            </Field>
            <Field label="Player">
              <SelectInput
                value={newEvent.player_id}
                onValueChange={(value) => setNewEvent({ ...newEvent, player_id: value })}
                options={[
                  { value: '', label: '—' },
                  ...players
                    .filter(
                      (row) =>
                        !newEvent.team_id ||
                        row.team_id ===
                          (teamOptions.some((option) => option.value === newEvent.team_id)
                            ? newEvent.team_id
                            : teamOptions[0]?.value),
                    )
                    .map((row) => ({ value: row.id, label: row.name })),
                ]}
              />
            </Field>
            <Field label="Minute">
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className={adminInputClass}
                value={newEvent.minute}
                onChange={(event) => setNewEvent({ ...newEvent, minute: event.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <button type="submit" disabled={busy} className={adminPrimaryButton}>
                {busy ? 'Logging…' : 'Log event'}
              </button>
            </div>
          </form>

          {events.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm"
                >
                  <span className="text-gray-200">
                    <span className="font-semibold text-indigo-300">{row.minute}&prime;</span>{' '}
                    {row.event_type.replace(/_/g, ' ')}
                    {row.player_name ? ` — ${row.player_name}` : ''}
                    {row.details ? ` (${row.details})` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteEvent(row.id)}
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}


      {canLineup && (
        <section data-tour="console-lineup" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
          <h2 className="mb-4 text-lg font-semibold">Line-ups</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {sides.map((side) => {
              if (!side.team) return null
              const squad = players.filter((row) => row.team_id === side.team!.id)
              const named = lineups.filter((row) =>
                squad.some((player) => player.id === row.player_id),
              )
              const unnamed = squad.filter(
                (player) => !named.some((row) => row.player_id === player.id),
              )
              return (
                <div key={side.id} className="space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-300">
                    {side.team.name}
                  </h3>
                  {named.length === 0 ? (
                    <p className="text-sm text-gray-500">No one named yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {named.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm"
                        >
                          <span className="text-gray-200">
                            {row.slot}.{' '}
                            {players.find((player) => player.id === row.player_id)?.name ?? '—'}
                            {row.is_captain ? ' (c)' : ''}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeFromLineup(row, side.team!.id)}
                            className="text-xs text-red-300 hover:text-red-200"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {unnamed.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        className={adminInputClass}
                        value=""
                        onChange={(event) => {
                          void addToLineup(side.team!.id, event.target.value)
                          event.target.value = ''
                        }}
                      >
                        <option value="">Add a player…</option>
                        {unnamed.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <p className="text-xs text-gray-500">
        Prefer the full console? <Link href={`/admin/match/${fixtureId}`} className="text-indigo-400 hover:text-indigo-300">Open the match console</Link>.
      </p>
    </div>
  )
}

export default ScoutLogPanel

