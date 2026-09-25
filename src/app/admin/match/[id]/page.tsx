'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { AdminMatchSkeleton } from '@/components/Skeleton'
import {
  AccessPanel,
  Field,
  SelectInput,
  StatusBanner,
  TextInput,
  adminInputClass,
  adminPrimaryButton,
  adminSubtleButton,
} from '@/components/admin/AdminWidgets'
import {
  canEditRules,
  canRecordStatKeys,
  canWriteClock,
  canWriteLineup,
  canWriteScore,
  type DutyContext,
} from '@/lib/duties'
import { FormationCanvas, type FormationSlot } from '@/components/FormationCanvas'
import {
  groupStatOptions,
  parseSportArrangement,
  resolveFixtureRules,
  scoreLabel,
  type SportArrangement,
  type StatInput,
} from '@/lib/sports'

type ScopeId = 'score' | 'clock' | 'stats' | 'timeline' | 'rules' | 'lineup'

type Side = 'home' | 'away'
type Stats = Record<Side, Record<string, number | undefined>> & {
  added_minutes?: number
}

export interface CustomEventCategory {
  key: string
  label: string
}

const EVENT_CATEGORIES: CustomEventCategory[] = [
  { key: 'goal', label: 'Goal' },
  { key: 'card_punishment', label: 'Card punishment' },
  { key: 'foul', label: 'Foul' },
  { key: 'corner', label: 'Corner' },
  { key: 'penalty', label: 'Penalty' },
  { key: 'free_kick', label: 'Free kick' },
  { key: 'throw_in', label: 'Throw-in' },
  { key: 'match_paused', label: 'Match paused' },
  { key: 'half_time', label: 'Half-time' },
  { key: 'full_time', label: 'Full-time' },
  { key: 'substitution', label: 'Substitutions' },
]

const CARD_PUNISHMENTS = [
  { type: 'yellow_card', label: 'Yellow card' },
  { type: 'red_card', label: 'Red card' },
  { type: 'green_card', label: 'Green card' },
  { type: 'suspension', label: '2-Min Suspension' },
]

interface MatchEvent {
  id: string
  event_type: string
  team_id: string | null
  player_id: string | null
  player_name: string | null
  minute: number
  details: string | null
  created_at?: string
}

interface Player {
  id: string
  team_id: string
  name: string
}

/** One row of the live "who is logging what" roster (`fixture_loggers`). */
interface LoggerRow {
  scope: string
  user_id: string
  email: string | null
  claimed_at: string
  last_seen_at: string
  is_stale: boolean
}

/** Which PART 13–14 writer RPCs exist on the connected database. */
interface ConsoleRuntime {
  hasLoggersRpc: boolean
  hasRecordEventRpc: boolean
  hasSetStatRpc: boolean
  hasRulesRpc: boolean
  hasEffectiveRulesRpc: boolean
  hasLineupRpc: boolean
}

/** Reads one cell of the fixture's stats JSONB without ever throwing. */
const statNumber = (stats: Stats, side: Side, key: string): number => {
  const value = stats?.[side]?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

interface FixtureDetail {
  id: string
  status: string
  current_minute: number | null
  home_score: number | null
  away_score: number | null
  tournament_id: string | null
  sport_id: string | null
  /** Per-fixture clock/vocab overrides, edited via `set_fixture_rules()`. Absent on old DBs. */
  rules_override?: unknown
  stats: (Stats & { elapsed_seconds?: number; timer_started_at?: string | null; added_minutes?: number }) | null
  home_team: { id: string; name: string; short_name: string | null; roster: string | null } | null
  away_team: { id: string; name: string; short_name: string | null; roster: string | null } | null
  article_md?: string | null
}

const EMPTY_STATS: Stats = { home: {}, away: {} }

const emptyEvent = {
  category: 'goal',
  card_type: 'yellow_card',
  team_id: '',
  player_name: '',
  assist_name: '',
  player_in: '',
  player_out: '',
  minute: '',
  details: '',
}

export default function LiveMatchManager({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = useMemo(() => createClient(), [])
  const {
    loading: authLoading,
    authenticated,
    canAccessAdmin,
    isAppAdmin,
    memberships,
  } = useAdminAuth()

  const [loading, setLoading] = useState(true)
  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [sport, setSport] = useState<SportArrangement | null>(null)
  const [rulesOverride, setRulesOverride] = useState<unknown>({})
  const [loggers, setLoggers] = useState<LoggerRow[]>([])
  const [lineups, setLineups] = useState<FormationSlot[]>([])
  const [lineupSaving, setLineupSaving] = useState(false)
  const [articleMd, setArticleMd] = useState('')
  const [articleSaving, setArticleSaving] = useState(false)
  const [runtime, setRuntime] = useState<ConsoleRuntime>({
    hasLoggersRpc: false,
    hasRecordEventRpc: false,
    hasSetStatRpc: false,
    hasRulesRpc: false,
    hasEffectiveRulesRpc: false,
    hasLineupRpc: false,
  })
  const [rawActiveScope, setActiveScope] = useState<ScopeId>('score')
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({})

  const [status, setStatus] = useState('scheduled')
  const [minute, setMinute] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null)
  const [addedMinutes, setAddedMinutes] = useState(0)
  const [customStoppageInput, setCustomStoppageInput] = useState('')
  const [homeScore, setHomeScore] = useState(0)
  const [awayScore, setAwayScore] = useState(0)
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [minuteInput, setMinuteInput] = useState('')

  const [newEvent, setNewEvent] = useState({ ...emptyEvent })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const baseElapsedRef = useRef(0)
  const loggersRef = useRef<LoggerRow[]>([])
  const userIdRef = useRef<string | null>(null)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setSessionUserId(data.user?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [supabase])

  useEffect(() => {
    userIdRef.current = sessionUserId
  }, [sessionUserId])

  const notify = useCallback(
    (kind: 'success' | 'error', message: string) => setMessage({ kind, message }),
    []
  )

  const loadMatch = useCallback(async () => {
    const { data, error } = await supabase
      .from('fixtures')
      .select(
        'id, status, current_minute, home_score, away_score, tournament_id, sport_id, rules_override, stats, article_md, home_team:home_team_id(id, name, short_name, roster), away_team:away_team_id(id, name, short_name, roster)',
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      notify('error', `Could not load fixture: ${error.message}`)
      setLoading(false)
      return
    }

    const row = data as unknown as FixtureDetail | null
    setFixture(row)
    setRulesOverride(row?.rules_override ?? {})
    setArticleMd(row?.article_md ?? '')

    if (row) {
      setStatus(row.status ?? 'scheduled')
      setMinute(row.current_minute ?? 0)
      setHomeScore(row.home_score ?? 0)
      setAwayScore(row.away_score ?? 0)
      setStats({
        home: { ...(row.stats?.home ?? {}) },
        away: { ...(row.stats?.away ?? {}) },
        added_minutes: row.stats?.added_minutes ?? 0,
      })
      setAddedMinutes(row.stats?.added_minutes ?? 0)
      setElapsedSeconds(
        row.stats?.elapsed_seconds ?? (row.current_minute ? row.current_minute * 60 : 0)
      )
      setTimerStartedAt(row.stats?.timer_started_at ?? null)
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

    const [eventsRes, playersRes] = await Promise.all([
      supabase
        .from('match_events')
        .select('id, event_type, team_id, player_id, player_name, minute, details, created_at')
        .eq('fixture_id', id)
        .order('minute', { ascending: false }),
      teamIds.length > 0
        ? supabase.from('players').select('id, team_id, name').in('team_id', teamIds)
        : Promise.resolve({ data: [] as Player[] }),
    ])

    setEvents((Array.isArray(eventsRes.data) ? eventsRes.data : []) as MatchEvent[])
    setPlayers((Array.isArray(playersRes.data) ? playersRes.data : []) as Player[])

    const lineupRes = await supabase
      .from('fixture_lineups')
      .select('id, slot, player_id, athlete_id, role, x, y, is_captain')
      .eq('fixture_id', id)
      .order('slot', { ascending: true })
    if (!lineupRes.error && Array.isArray(lineupRes.data)) {
      setLineups(
        (lineupRes.data as Record<string, unknown>[]).map((row) => ({
          id: String(row.id),
          slot: Number(row.slot),
          player_id: (row.player_id as string | null) ?? null,
          athlete_id: (row.athlete_id as string | null) ?? null,
          role: (row.role as string | null) ?? null,
          x: Number(row.x),
          y: Number(row.y),
          is_captain: Boolean(row.is_captain),
        })),
      )
    } else {
      setLineups([])
    }

    const [loggersRes, setStatProbe, rulesProbe] = await Promise.all([
      supabase.rpc('list_fixture_loggers', { p_fixture_id: id }),
      supabase.rpc('fixture_stat_input', {
        p_fixture_id: id,
        p_stat_key: '__console_probe__',
      }),
      row?.rules_override !== undefined
        ? supabase.rpc('fixture_effective_rules', { p_fixture_id: id })
        : Promise.resolve({ data: null, error: { message: 'no rules_override column' } }),
    ])

    setRuntime((current) => ({
      ...current,
      hasLoggersRpc: !loggersRes.error,
      hasSetStatRpc:
        !setStatProbe.error || !String(setStatProbe.error.message ?? '').match(/does not exist|not exist|PGRST202|42883/i),
      hasEffectiveRulesRpc: !rulesProbe.error,
      hasLineupRpc: !lineupRes.error,
      hasRecordEventRpc: current.hasRecordEventRpc,
      hasRulesRpc: current.hasRulesRpc,
    }))

    if (!loggersRes.error && Array.isArray(loggersRes.data)) {
      setLoggers(loggersRes.data as LoggerRow[])
    }

    try {
      await fetch('/api/revalidate', { method: 'POST' })
    } catch {
      // best effort
    }

    setLoading(false)
  }, [supabase, id, notify])

  const refreshLoggers = useCallback(async () => {
    if (!runtime.hasLoggersRpc) return
    const { data, error } = await supabase.rpc('list_fixture_loggers', { p_fixture_id: id })
    if (error || !Array.isArray(data)) return
    const rows = data as LoggerRow[]
    loggersRef.current = rows
    setLoggers(rows)
  }, [supabase, id, runtime.hasLoggersRpc])

  const heartbeatMyScopes = useCallback(async () => {
    if (!runtime.hasLoggersRpc) return
    const userId = userIdRef.current
    if (!userId) return
    const mine = loggersRef.current.filter((row) => row.user_id === userId && !row.is_stale)
    if (mine.length === 0) return
    await Promise.all(
      mine.map((row) =>
        supabase.rpc('heartbeat_fixture_scope', {
          p_fixture_id: id,
          p_scope: row.scope,
        })
      )
    )
  }, [supabase, id, runtime.hasLoggersRpc])

  const releaseMyScopes = useCallback(
    (userId: string | null) => {
      if (!runtime.hasLoggersRpc || !userId) return
      const mine = loggersRef.current.filter((row) => row.user_id === userId)
      if (mine.length === 0 || typeof navigator === 'undefined' || typeof window === 'undefined') return
      const params = new URLSearchParams({ fixture_id: id })
      for (const row of mine.slice(0, 24)) params.append('scope', row.scope)
      navigator.sendBeacon(`/api/fixture-loggers/release?${params.toString()}`)
    },
    [id, runtime.hasLoggersRpc]
  )

  useEffect(() => {
    userIdRef.current = sessionUserId
  }, [sessionUserId])

  useEffect(() => {
    if (!runtime.hasLoggersRpc) return
    const timer = window.setInterval(() => {
      void heartbeatMyScopes()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [heartbeatMyScopes, runtime.hasLoggersRpc])

  useEffect(() => {
    if (!runtime.hasLoggersRpc) return
    const handleUnload = () => releaseMyScopes(sessionUserId)
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      releaseMyScopes(sessionUserId)
    }
  }, [releaseMyScopes, runtime.hasLoggersRpc, sessionUserId])

  useEffect(() => {
    if (!fixture?.id) return
    const fixtureId = fixture.id

    const applyFixtureRow = (row: Record<string, unknown>) => {
      if (row.home_score !== undefined && row.home_score !== null)
        setHomeScore(Number(row.home_score) || 0)
      if (row.away_score !== undefined && row.away_score !== null)
        setAwayScore(Number(row.away_score) || 0)
      if (typeof row.status === 'string') setStatus(row.status)
      if (typeof row.current_minute === 'number') {
        setMinute(row.current_minute)
        if (!timerStartedAt) setElapsedSeconds(row.current_minute * 60)
      }
      if (typeof row.article_md === 'string') {
        setArticleMd(row.article_md)
      }
      const statsValue = row.stats as Record<string, unknown> | null | undefined
      if (statsValue && typeof statsValue === 'object') {
        setStats({
          home: { ...(statsValue.home ?? {}) },
          away: { ...(statsValue.away ?? {}) },
          added_minutes: typeof statsValue.added_minutes === 'number' ? statsValue.added_minutes : 0,
        })
        if (typeof statsValue.added_minutes === 'number') {
          setAddedMinutes(statsValue.added_minutes)
        }
        const statsRecord = statsValue as Record<string, unknown>
        if (typeof statsRecord.elapsed_seconds === 'number') {
          baseElapsedRef.current = statsRecord.elapsed_seconds
          setElapsedSeconds(statsRecord.elapsed_seconds)
        }
        setTimerStartedAt(typeof statsRecord.timer_started_at === 'string' ? statsRecord.timer_started_at : null)
      }
      if (row.rules_override !== undefined) setRulesOverride(row.rules_override ?? {})
    }

    const channel = supabase
      .channel(`console_${fixtureId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fixtures', filter: `id=eq.${fixtureId}` },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            applyFixtureRow(payload.new as Record<string, unknown>)
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_events', filter: `fixture_id=eq.${fixtureId}` },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const row = payload.new as Record<string, unknown>
            setEvents((current) => {
              if (current.some((event) => event.id === row.id)) return current
              return [
                {
                  id: String(row.id),
                  event_type: String(row.event_type ?? ''),
                  team_id: (row.team_id as string | null) ?? null,
                  player_id: (row.player_id as string | null) ?? null,
                  player_name: (row.player_name as string | null) ?? null,
                  minute: typeof row.minute === 'number' ? row.minute : 0,
                  details: (row.details as string | null) ?? null,
                  created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
                },
                ...current,
              ]
            })
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'match_events', filter: `fixture_id=eq.${fixtureId}` },
        (payload) => {
          const old = payload.old as Record<string, unknown> | null
          if (old?.id) {
            setEvents((current) => current.filter((event) => event.id !== String(old.id)))
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fixture_loggers', filter: `fixture_id=eq.${fixtureId}` },
        () => {
          void refreshLoggers()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fixture_lineups', filter: `fixture_id=eq.${fixtureId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown> | null
          if (!row || row.team_id === undefined) return
          if (payload.eventType === 'DELETE') {
            setLineups((current) => current.filter((entry) => entry.id !== String(row.id)))
            return
          }
          const mapped: FormationSlot = {
            id: String(row.id),
            slot: Number(row.slot),
            player_id: (row.player_id as string | null) ?? null,
            athlete_id: (row.athlete_id as string | null) ?? null,
            role: (row.role as string | null) ?? null,
            x: Number(row.x),
            y: Number(row.y),
            is_captain: Boolean(row.is_captain),
          }
          setLineups((current) => {
            const others = current.filter((entry) => entry.id !== mapped.id)
            return [...others, mapped].sort((a, b) => a.slot - b.slot)
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, fixture, refreshLoggers, timerStartedAt])

  const claimScope = useCallback(
    async (scope: string) => {
      if (!runtime.hasLoggersRpc) return true
      const { error } = await supabase.rpc('claim_fixture_scope', {
        p_fixture_id: id,
        p_scope: scope,
      })
      if (error) {
        notify('error', error.message)
        return false
      }
      await refreshLoggers()
      return true
    },
    [supabase, id, runtime.hasLoggersRpc, refreshLoggers, notify],
  )

  useEffect(() => {
    if (authLoading || !canAccessAdmin) return
    // oxlint-disable-next-line react/set-state-in-effect
    void loadMatch()
  }, [authLoading, canAccessAdmin, id, loadMatch])

  useEffect(() => {
    const running = status === 'in_progress' || status === 'extra_time'
    if (!timerStartedAt || !running) return

    const tick = () => {
      const started = new Date(timerStartedAt).getTime()
      const delta = Math.max(0, Math.floor((Date.now() - started) / 1000))
      setElapsedSeconds(baseElapsedRef.current + delta)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [timerStartedAt, status])

  const saveArticle = async () => {
    setArticleSaving(true)
    const { error } = await supabase
      .from('fixtures')
      .update({ article_md: articleMd.trim() || null })
      .eq('id', id)
    setArticleSaving(false)

    if (error) {
      notify('error', `Could not save article: ${error.message}`)
      return
    }
    notify('success', 'Match insights article saved successfully.')
  }

  const persistClock = async (
    nextStatus: string,
    nextMinute: number,
    nextElapsed: number,
    startedAt: string | null,
    nextAddedMinutes?: number
  ) => {
    setBusy(true)
    const effectiveAdded = nextAddedMinutes !== undefined ? nextAddedMinutes : addedMinutes
    const updatedStats = {
      ...(stats ?? {}),
      elapsed_seconds: nextElapsed,
      timer_started_at: startedAt,
      added_minutes: effectiveAdded,
    }

    const { error } = await supabase
      .from('fixtures')
      .update({
        status: nextStatus,
        current_minute: nextMinute,
        stats: updatedStats,
      })
      .eq('id', id)

    setBusy(false)

    if (error) {
      notify('error', `Could not update the clock: ${error.message}`)
      return false
    }
    return true
  }

  const setStoppageTime = async (addMins: number) => {
    setAddedMinutes(addMins)
    setStats((current) => ({ ...current, added_minutes: addMins }))
    const ok = await persistClock(status, minute, elapsedSeconds, timerStartedAt, addMins)
    if (ok) notify('success', `Stoppage time set to +${addMins} mins.`)
  }

  const handleApplyCustomStoppage = () => {
    const parsed = Number.parseInt(customStoppageInput, 10)
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 30) {
      notify('error', 'Enter a stoppage time between 0 and 30 minutes.')
      return
    }
    setCustomStoppageInput('')
    void setStoppageTime(parsed)
  }

  const startClock = async (nextStatus: string, nextMinute: number) => {
    const startedAt = new Date().toISOString()
    baseElapsedRef.current = nextMinute * 60
    setStatus(nextStatus)
    setMinute(nextMinute)
    setElapsedSeconds(nextMinute * 60)
    setTimerStartedAt(startedAt)
    const ok = await persistClock(nextStatus, nextMinute, nextMinute * 60, startedAt)
    if (ok) notify('success', 'Clock running.')
  }

  const pauseClock = async () => {
    const stoppedAt = elapsedSeconds
    setStatus('paused')
    setTimerStartedAt(null)
    const ok = await persistClock('paused', Math.floor(stoppedAt / 60), stoppedAt, null)
    if (ok) notify('success', 'Clock paused.')
  }

  const endClock = async (nextStatus: string, nextMinute: number) => {
    setStatus(nextStatus)
    setMinute(nextMinute)
    setElapsedSeconds(nextMinute * 60)
    setTimerStartedAt(null)
    const ok = await persistClock(nextStatus, nextMinute, nextMinute * 60, null)
    if (ok) notify('success', `Match status: ${nextStatus.replace(/_/g, ' ')}.`)
  }

  const overrideMinute = async () => {
    const parsed = Number.parseInt(minuteInput, 10)
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 130) {
      notify('error', 'Enter a minute between 0 and 130.')
      return
    }
    setMinuteInput('')
    setMinute(parsed)
    setElapsedSeconds(parsed * 60)
    baseElapsedRef.current = parsed * 60
    const startedAt = status === 'in_progress' || status === 'extra_time'
      ? new Date().toISOString()
      : null
    setTimerStartedAt(startedAt)
    const ok = await persistClock(status, parsed, parsed * 60, startedAt)
    if (ok) notify('success', `Clock set to ${parsed}'.`)
  }

  const saveScore = async (home: number, away: number) => {
    if (!(await claimScope('score'))) return
    setBusy(true)
    const { error } = await supabase.rpc('record_score', {
      p_fixture_id: id,
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
  }

  const incrementStat = async (side: Side, key: string, valueInput?: StatInput) => {
    if (!(await claimScope(`stat:${key}`))) return
    setBusy(true)

    if (valueInput === 'value') {
      const raw = (valueInputs[`${side}:${key}`] ?? '').trim()
      const parsed = Number(raw)
      if (raw === '' || Number.isNaN(parsed)) {
        setBusy(false)
        notify('error', 'Enter a numeric value for this stat.')
        return
      }
      const { data, error } = await supabase.rpc('set_fixture_stat', {
        p_fixture_id: id,
        p_side: side,
        p_stat_key: key,
        p_value: parsed,
      })
      setBusy(false)

      if (error) {
        if (isMissingRpc(error)) {
          setRuntime((current) => ({ ...current, hasSetStatRpc: false }))
          notify('error', 'Recorded values need the latest database setup (db-setup.sql).')
        } else {
          notify('error', error.message)
        }
        return
      }

      const nextValue = typeof data === 'number' ? data : parsed
      setStats((current) => ({ ...current, [side]: { ...current[side], [key]: nextValue } }))
      notify('success', 'Value recorded.')
      return
    }

    const { data, error } = await supabase.rpc('record_stat', {
      p_fixture_id: id,
      p_side: side,
      p_stat_key: key,
    })
    setBusy(false)

    if (error) {
      notify('error', error.message)
      return
    }

    const nextValue = typeof data === 'number' ? data : (stats[side][key] ?? 0) + 1
    setStats((current) => ({
      ...current,
      [side]: { ...current[side], [key]: nextValue },
    }))
  }

  const isMissingRpc = (error: { message?: string; code?: string } | null | undefined) =>
    !!error &&
    (error.code === '42883' ||
      error.code === 'PGRST202' ||
      /does not exist|not exist|PGRST202|42883|schema cache/i.test(error.message ?? ''))

  const logEvent = async (event: React.FormEvent) => {
    event.preventDefault()
    const minuteValue = Number.parseInt(newEvent.minute || String(minute), 10)
    if (Number.isNaN(minuteValue) || minuteValue < 0) {
      notify('error', 'Enter a valid minute for the event.')
      return
    }

    const finalEventType = newEvent.category === 'card_punishment' ? newEvent.card_type : newEvent.category

    const teamId = newEvent.team_id || null
    const squad = teamId ? players.filter((player) => player.team_id === teamId) : []

    let playerName = newEvent.player_name.trim()
    let details = newEvent.details.trim()

    if (newEvent.category === 'substitution') {
      const pIn = newEvent.player_in.trim()
      const pOut = newEvent.player_out.trim()
      playerName = pIn ? `In: ${pIn}` : playerName
      const subDetails = `Out: ${pOut || 'N/A'}${pIn ? ` • In: ${pIn}` : ''}`
      details = details ? `${subDetails} • ${details}` : subDetails
    } else {
      details = [
        newEvent.assist_name.trim() ? `Assist: ${newEvent.assist_name.trim()}` : '',
        details,
      ].filter(Boolean).join(' • ')
    }

    const scorer = squad.find((player) => player.name === playerName)

    if (!(await claimScope(`event:${finalEventType}`))) return
    setBusy(true)

    const insertPayload = {
      fixture_id: id,
      tournament_id: fixture?.tournament_id ?? null,
      event_type: finalEventType,
      team_id: teamId,
      player_id: scorer?.id ?? null,
      player_name: playerName || null,
      assist_player_id: null,
      minute: minuteValue,
      details: details || null,
    }

    let logged = false
    if (runtime.hasRecordEventRpc) {
      const { error } = await supabase.rpc('record_match_event', {
        p_fixture_id: insertPayload.fixture_id,
        p_event_type: insertPayload.event_type,
        p_team_id: insertPayload.team_id,
        p_player_id: insertPayload.player_id,
        p_player_name: insertPayload.player_name,
        p_assist_player_id: insertPayload.assist_player_id,
        p_minute: insertPayload.minute,
        p_details: insertPayload.details,
      })

      if (error && isMissingRpc(error)) {
        setRuntime((current) => ({ ...current, hasRecordEventRpc: false }))
      } else if (error) {
        setBusy(false)
        notify('error', `Could not log the event: ${error.message}`)
        return
      } else {
        logged = true
      }
    }

    if (!logged) {
      const { error } = await supabase.from('match_events').insert([insertPayload])
      if (error) {
        setBusy(false)
        notify('error', `Could not log the event: ${error.message}`)
        return
      }
    }
    setBusy(false)

    setNewEvent((current) => ({
      ...emptyEvent,
      category: current.category,
      card_type: current.card_type,
      team_id: current.team_id,
      minute: String(minute),
    }))
    notify('success', 'Event logged.')

    const { data } = await supabase
      .from('match_events')
      .select('id, event_type, team_id, player_id, player_name, minute, details, created_at')
      .eq('fixture_id', id)
      .order('minute', { ascending: false })
    setEvents((Array.isArray(data) ? data : []) as MatchEvent[])

    try {
      await fetch('/api/revalidate', { method: 'POST' })
    } catch {
      // best effort
    }
  }

  const deleteEvent = async (eventId: string) => {
    const target = events.find((row) => row.id === eventId)
    if (target && !(await claimScope(`event:${target.event_type}`))) return

    if (runtime.hasRecordEventRpc) {
      setBusy(true)
      const { error } = await supabase.rpc('delete_match_event', {
        p_event_id: eventId,
        p_force: false,
      })
      setBusy(false)

      if (error && isMissingRpc(error)) {
        setRuntime((current) => ({ ...current, hasRecordEventRpc: false }))
      } else if (error) {
        notify('error', `Could not delete the event: ${error.message}`)
        return
      } else {
        setEvents((current) => current.filter((row) => row.id !== eventId))
        notify('success', 'Event deleted.')
        return
      }
    }

    setBusy(true)
    const { error } = await supabase.from('match_events').delete().eq('id', eventId)
    setBusy(false)

    if (error) {
      notify('error', `Could not delete the event: ${error.message}`)
      return
    }

    setEvents((current) => current.filter((row) => row.id !== eventId))
    notify('success', 'Event deleted.')
  }

  const resolvedRules = useMemo(
    () =>
      resolveFixtureRules({
        sport,
        scoringType: fixture?.sport_id ? sport?.scoringType ?? null : null,
        rulesOverride,
        fallbackName: fixture?.home_team?.name
          ? `${fixture.home_team.name} vs ${fixture?.away_team?.name ?? 'Away'}`
          : 'Match',
      }),
    [sport, fixture, rulesOverride],
  )
  const { arrangement, statOptions, isOverride, allowNegativeScore } = resolvedRules

  const dutyContext: DutyContext = useMemo(() => {
    const membership = memberships.find((row) => row.tournament_id === fixture?.tournament_id)
    return {
      isAppAdmin,
      duties: membership?.duties ?? [],
      fixtureId: fixture?.id ?? null,
    }
  }, [memberships, fixture, isAppAdmin])

  const canScore = isAppAdmin || canWriteScore(dutyContext)
  const canClock = isAppAdmin || canWriteClock(dutyContext)
  const canRules = isAppAdmin || canEditRules(dutyContext)
  const canLineup = isAppAdmin || canWriteLineup(dutyContext)
  const statAccess = useMemo(
    () => isAppAdmin ? Object.fromEntries(statOptions.map((o) => [o.key, true])) : canRecordStatKeys(dutyContext, statOptions.map((option) => option.key)),
    [dutyContext, statOptions, isAppAdmin],
  )
  const statGroups = useMemo(() => groupStatOptions(statOptions), [statOptions])

  const availableScopes = useMemo(() => {
    const list: { id: ScopeId; label: string; enabled: boolean; lockedReason?: string }[] = [
      {
        id: 'score',
        label: 'Score',
        enabled: canScore,
        lockedReason: 'Needs the score duty for this tournament.',
      },
      {
        id: 'clock',
        label: 'Clock',
        enabled: canClock,
        lockedReason: 'Needs the score or clock duty for this tournament.',
      },
      {
        id: 'stats',
        label: 'Stats',
        enabled: statOptions.some((option) => statAccess[option.key]) || canScore,
        lockedReason: 'Your duties do not cover any stat on this match.',
      },
      { id: 'timeline', label: 'Timeline & Events', enabled: true },
      {
        id: 'lineup',
        label: 'Lineup',
        enabled: canLineup,
        lockedReason: 'Needs the lineup duty for this tournament.',
      },
      {
        id: 'rules',
        label: canClock ? 'Clock & rules' : 'Rules',
        enabled: canRules,
        lockedReason: 'Only a score-duty operator may edit allocations.',
      },
    ]
    return list
  }, [canScore, canClock, canRules, canLineup, statOptions, statAccess])

  const activeScope = useMemo(() => {
    if (availableScopes.some((scope) => scope.id === rawActiveScope && scope.enabled)) {
      return rawActiveScope
    }
    return availableScopes.find((scope) => scope.enabled)?.id ?? 'score'
  }, [availableScopes, rawActiveScope])

  const [ruleDraft, setRuleDraft] = useState({ periods: '', period_minutes: '', break_minutes: '' })
  const [rulesSaving, setRulesSaving] = useState(false)

  const saveRules = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canRules) {
      notify('error', 'Only a score-duty operator may edit allocations.')
      return
    }

    const periods = ruleDraft.periods.trim() === '' ? null : Number.parseInt(ruleDraft.periods, 10)
    const periodMinutes =
      ruleDraft.period_minutes.trim() === '' ? null : Number.parseInt(ruleDraft.period_minutes, 10)
    const breakMinutes =
      ruleDraft.break_minutes.trim() === '' ? null : Number.parseInt(ruleDraft.break_minutes, 10)

    const invalid =
      (periods !== null && (!Number.isInteger(periods) || periods < 1 || periods > 30)) ||
      (periodMinutes !== null &&
        (!Number.isInteger(periodMinutes) || periodMinutes < 1 || periodMinutes > 300)) ||
      (breakMinutes !== null &&
        (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 180))
    if (invalid) {
      notify('error', 'Allocations must be whole numbers: periods 1–30, minutes 1–300, break 0–180.')
      return
    }

    if (!(await claimScope('score'))) return
    setRulesSaving(true)
    const { data, error } = await supabase.rpc('set_fixture_rules', {
      p_fixture_id: id,
      p_rules: {
        clock: {
          ...(periods !== null ? { periods } : {}),
          ...(periodMinutes !== null ? { period_minutes: periodMinutes } : {}),
          ...(breakMinutes !== null ? { break_minutes: breakMinutes } : {}),
        },
      },
    })
    setRulesSaving(false)

    if (error) {
      if (isMissingRpc(error)) {
        notify('error', 'Editable allocations need the latest database setup (db-setup.sql).')
      } else {
        notify('error', `Could not save allocations: ${error.message}`)
      }
      return
    }

    const next = (data as { clock?: unknown } | null)?.clock
    setRulesOverride((current: unknown) => ({
      ...(((current as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
      ...(typeof next === 'object' && next !== null ? { clock: next } : {}),
    }))
    setRuleDraft({ periods: '', period_minutes: '', break_minutes: '' })
    notify('success', 'Allocations saved for this match.')
  }

  const resetRules = async () => {
    if (!canRules) {
      notify('error', 'Only a score-duty operator may edit allocations.')
      return
    }
    if (!(await claimScope('score'))) return
    setRulesSaving(true)
    const { error } = await supabase.rpc('clear_fixture_rules', { p_fixture_id: id })
    setRulesSaving(false)
    if (error) {
      notify('error', `Could not reset allocations: ${error.message}`)
      return
    }
    setRulesOverride({})
    notify('success', 'Allocations reset to the sport defaults.')
  }

  const nextSlotFor = (teamId: string): number => {
    const used = new Set(
      lineups
        .filter((slot) =>
          players.some((player) => player.id === slot.player_id && player.team_id === teamId),
        )
        .map((slot) => slot.slot),
    )
    let slot = 1
    while (used.has(slot) && slot < 99) slot += 1
    return slot
  }

  const writeLineup = async (args: {
    teamId: string
    slot: number
    x?: number
    y?: number
    playerId?: string | null
    athleteId?: string | null
    role?: string | null
    isCaptain?: boolean
    remove?: boolean
    id?: string
  }) => {
    if (!canLineup) {
      notify('error', 'Needs the lineup duty for this tournament.')
      return
    }
    if (!(await claimScope('lineup'))) return
    setLineupSaving(true)
    const { error } = await supabase.rpc('set_fixture_lineup', {
      p_fixture_id: id,
      p_team_id: args.teamId,
      p_slot: args.slot,
      p_x: args.x ?? null,
      p_y: args.y ?? null,
      p_player_id: args.playerId ?? null,
      p_athlete_id: args.athleteId ?? null,
      p_role: args.role ?? null,
      p_is_captain: args.isCaptain ?? false,
      p_remove: args.remove ?? false,
    })
    setLineupSaving(false)
    if (error) {
      if (isMissingRpc(error)) {
        notify('error', 'Formations need the latest database setup (db-setup.sql).')
      } else {
        notify('error', `Could not save the lineup: ${error.message}`)
      }
      return
    }
    if (args.remove) {
      setLineups((current) =>
        current.filter((entry) => (args.id ? entry.id !== args.id : entry.slot !== args.slot)),
      )
    }
  }

  const lineupCourt = arrangement?.court ?? { shape: 'pitch', orientation: 'horizontal' }
  const slotsForTeam = (teamId: string | undefined): FormationSlot[] =>
    teamId
      ? lineups.filter((slot) =>
          players.some((player) => player.id === slot.player_id && player.team_id === teamId),
        )
      : []
  const homeSlots = slotsForTeam(fixture?.home_team?.id)
  const awaySlots = slotsForTeam(fixture?.away_team?.id)

  const clock = arrangement?.clock ?? null
  const scoreName =
    fixture && arrangement.name !== 'Match'
      ? `${arrangement.name} · ${scoreLabel(arrangement.scoringType)}`
      : 'Score'

  const clockDisplay = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(
    elapsedSeconds % 60,
  ).padStart(2, '0')}`

  const isRunning = status === 'in_progress' || status === 'extra_time'

  const renderFallbackClockControls = () => {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          {status === 'scheduled' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startClock('in_progress', 0)}
              className={adminPrimaryButton}
            >
              Start 1st half
            </button>
          )}
          {isRunning && minute < 45 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void endClock('half_time', 45)}
              className={adminSubtleButton}
            >
              End 1st half (HT)
            </button>
          )}
          {status === 'half_time' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startClock('in_progress', 45)}
              className={adminPrimaryButton}
            >
              Start 2nd half
            </button>
          )}
          {isRunning && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void pauseClock()}
              className={adminSubtleButton}
            >
              Pause
            </button>
          )}
          {status === 'paused' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startClock(minute >= 90 ? 'extra_time' : 'in_progress', minute)}
              className={adminPrimaryButton}
            >
              Resume
            </button>
          )}
          {isRunning && minute >= 45 && minute < 90 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void endClock('full_time', 90)}
              className={adminSubtleButton}
            >
              End 2nd half (FT)
            </button>
          )}

          {/* Knockout Stage Extra Time (3rd & 4th Periods) */}
          {(status === 'full_time' || (status === 'paused' && minute >= 90) || (isRunning && minute >= 90)) && (
            <>
              {(status === 'full_time' || (status === 'paused' && minute === 90)) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startClock('extra_time', 90)}
                  className={adminPrimaryButton}
                >
                  Start 3rd Period (ET 1st Half)
                </button>
              )}
              {isRunning && minute >= 90 && minute < 105 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void endClock('extra_time', 105)}
                  className={adminSubtleButton}
                >
                  End 3rd Period (ET HT at 105&apos;)
                </button>
              )}
              {(status === 'paused' && minute === 105) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startClock('extra_time', 105)}
                  className={adminPrimaryButton}
                >
                  Start 4th Period (ET 2nd Half)
                </button>
              )}
              {isRunning && minute >= 105 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void endClock('full_time', 120)}
                  className={adminSubtleButton}
                >
                  End 4th Period (ET FT at 120&apos;)
                </button>
              )}
            </>
          )}
        </div>

        {/* Stoppage Time / Extra Minutes Quick & Manual Controls */}
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
          <span className="text-xs font-semibold text-gray-400">
            Add Stoppage Time:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3, 5].map((mins) => (
              <button
                key={mins}
                type="button"
                disabled={busy}
                onClick={() => void setStoppageTime(mins)}
                className={
                  'px-3 py-1.5 text-xs font-bold rounded-lg border transition ' +
                  (addedMinutes === mins
                    ? 'bg-amber-500 text-black border-amber-400'
                    : 'bg-white/5 text-amber-300 border-amber-500/30 hover:bg-amber-500/20')
                }
              >
                +{mins} min
              </button>
            ))}
            {addedMinutes > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setStoppageTime(0)}
                className="px-2 py-1 text-xs text-gray-400 hover:text-white underline"
              >
                Clear (+0)
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <input
              type="number"
              min={0}
              max={30}
              placeholder="e.g. 7"
              value={customStoppageInput}
              onChange={(e) => setCustomStoppageInput(e.target.value)}
              className={adminInputClass + ' w-20 text-xs py-1'}
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleApplyCustomStoppage}
              className={adminSubtleButton + ' text-xs py-1'}
            >
              Set Mins
            </button>
          </div>
        </div>
      </div>
    )
  }

  const teamOptions = [
    { value: '', label: 'None / neutral' },
    ...(fixture?.home_team ? [{ value: fixture.home_team.id, label: `${fixture.home_team.name} (home)` }] : []),
    ...(fixture?.away_team ? [{ value: fixture.away_team.id, label: `${fixture.away_team.name} (away)` }] : []),
  ]
  const squadForEvent = newEvent.team_id
    ? players.filter((player) => player.team_id === newEvent.team_id)
    : players

  const fieldPlayerOptions = newEvent.team_id
    ? (() => {
        const teamLineups = lineups.filter((slot) => slot.teamId === newEvent.team_id)
        return squadForEvent.filter((p) => teamLineups.some((slot) => slot.player_id === p.id))
      })()
    : squadForEvent

  const benchPlayerOptions = newEvent.team_id
    ? (() => {
        const teamLineups = lineups.filter((slot) => slot.teamId === newEvent.team_id)
        return squadForEvent.filter((p) => !teamLineups.some((slot) => slot.player_id === p.id))
      })()
    : squadForEvent

  const writableStatGroups = statGroups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => statAccess[option.key]),
    }))
    .filter((group) => group.options.length > 0)
  const myClaims = loggers.filter((row) => !row.is_stale)
  const claimBusy = busy || rulesSaving

  if (authLoading) return <AdminMatchSkeleton />

  if (!authenticated) {
    return (
      <AccessPanel
        title="Sign in required"
        body="The live match manager is only available to signed-in tournament staff."
        href={`/login?next=${encodeURIComponent(`/admin/match/${id}`)}`}
        linkLabel="Sign in"
      />
    )
  }

  if (!canAccessAdmin) {
    return (
      <AccessPanel
        title="No match access"
        body="Your account is not an app admin and is not a member of any tournament."
        href="/admin"
        linkLabel="Back to the dashboard"
      />
    )
  }

  if (loading) return <AdminMatchSkeleton />

  if (!fixture) {
    return (
      <AccessPanel
        title="Match not found"
        body="This fixture no longer exists or you do not have access to it."
        href="/admin"
        linkLabel="Back to the dashboard"
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#0f172a] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm text-gray-400 hover:text-white">
              ← Dashboard
            </Link>
            <h1 className="text-lg font-bold">Live match manager</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span
              className={
                'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ' +
                (isRunning ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-gray-300')
              }
            >
              {isRunning ? 'Live' : status.replace(/_/g, ' ')}
            </span>
            <span className="font-mono text-lg tabular-nums">
              {clockDisplay}
              {addedMinutes > 0 ? ` (+${addedMinutes}')` : ''}
            </span>
            {fixture.tournament_id && (
              <Link
                href={`/admin/tournaments/${fixture.tournament_id}`}
                className="text-indigo-400 hover:text-indigo-300"
              >
                Tournament
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-8 px-4 pt-8 sm:px-6 lg:px-8">
        <StatusBanner status={message} />

        <nav
          data-tour="console-scopes"
          aria-label="Logging scopes"
          className="flex gap-2 overflow-x-auto rounded-xl border border-white/5 bg-[#1e293b] p-3"
        >
          {availableScopes.map((scope) => (
            <button
              key={scope.id}
              type="button"
              onClick={() => setActiveScope(scope.id)}
              title={scope.enabled ? undefined : scope.lockedReason}
              className={
                'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ' +
                (activeScope === scope.id
                  ? 'bg-indigo-600 text-white'
                  : scope.enabled
                    ? 'bg-white/5 text-gray-300 hover:bg-white/10'
                    : 'bg-white/5 text-gray-500') +
                (scope.enabled ? '' : ' cursor-not-allowed opacity-60')
              }
            >
              {scope.label}
              {scope.enabled ? '' : ' 🔒'}
            </button>
          ))}
        </nav>

        <section data-tour="console-header" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Logging now</h2>
            <span className="text-xs text-gray-500">
              One logger per stream: two people cannot record the same scope on this match.
            </span>
          </div>
          {myClaims.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">Nobody has claimed a stream yet.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {myClaims.map((row) => (
                <li
                  key={`${row.scope}:${row.user_id}`}
                  className="rounded-full bg-white/5 px-3 py-1 text-xs text-gray-300"
                >
                  <span className="font-semibold text-indigo-300">{row.scope}</span>
                  {row.email ? ` · ${row.email}` : ''}
                  {row.is_stale ? ' · stale' : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        {activeScope === 'score' && (
          <section className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
            <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
              <div className="text-center md:text-right">
                <p className="text-xl font-bold">{fixture.home_team?.name ?? 'Home'}</p>
                <p className="text-xs text-gray-400">Home</p>
              </div>

              <div className="flex items-center justify-center gap-3">
                <div className="flex flex-col items-center gap-1">
                  <input
                    type="number"
                    min={allowNegativeScore ? undefined : 0}
                    value={homeScore}
                    onChange={(event) => setHomeScore(Number.parseInt(event.target.value, 10) || 0)}
                    className="h-16 w-16 rounded-xl border border-white/10 bg-[#0f172a] text-center text-3xl font-black focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveScore(homeScore + 1, awayScore)}
                    className={adminSubtleButton}
                  >
                    +1
                  </button>
                </div>
                <span className="text-2xl font-bold text-gray-500">–</span>
                <div className="flex flex-col items-center gap-1">
                  <input
                    type="number"
                    min={allowNegativeScore ? undefined : 0}
                    value={awayScore}
                    onChange={(event) => setAwayScore(Number.parseInt(event.target.value, 10) || 0)}
                    className="h-16 w-16 rounded-xl border border-white/10 bg-[#0f172a] text-center text-3xl font-black focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveScore(homeScore, awayScore + 1)}
                    className={adminSubtleButton}
                  >
                    +1
                  </button>
                </div>
              </div>

              <div className="text-center md:text-left">
                <p className="text-xl font-bold">{fixture.away_team?.name ?? 'Away'}</p>
                <p className="text-xs text-gray-400">Away</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveScore(homeScore, awayScore)}
                className={adminPrimaryButton}
              >
                Save {arrangement ? scoreLabel(arrangement.scoringType) : 'score'}
              </button>
              <span className="text-xs text-gray-500">
                {scoreName || 'Score'} is written atomically through <code>record_score()</code>.
              </span>
            </div>
          </section>
        )}

        {activeScope === 'clock' && (
          <section data-tour="console-clock" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
            <h2 className="mb-4 text-lg font-semibold">Clock &amp; status</h2>
            {renderFallbackClockControls()}

            <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
              <Field label="Override minute">
                <TextInput
                  value={minuteInput}
                  onValueChange={setMinuteInput}
                  placeholder={String(minute)}
                  inputMode="numeric"
                  className={adminInputClass + ' w-32'}
                />
              </Field>
              <button
                type="button"
                disabled={busy}
                onClick={() => void overrideMinute()}
                className={adminSubtleButton}
              >
                Apply
              </button>
              <p className="text-xs text-gray-500">
                Elapsed: {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}{' '}
                &bull; minute {minute}
              </p>
            </div>
          </section>
        )}

        {activeScope === 'clock' && canRules && (
          <section data-tour="console-rules" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Allocated times for this match</h2>
              <span className="text-xs text-gray-500">
                {isOverride
                  ? 'This match overrides the sport defaults.'
                  : 'Using the sport catalogue defaults.'}
              </span>
            </div>
            <form onSubmit={(event) => void saveRules(event)} className="grid gap-4 md:grid-cols-4">
              <Field label="Periods">
                <input
                  type="number"
                  min={1}
                  max={30}
                  inputMode="numeric"
                  className={adminInputClass}
                  placeholder={clock?.periods ? String(clock.periods) : '2'}
                  value={ruleDraft.periods}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, periods: event.target.value })
                  }
                />
              </Field>
              <Field label="Minutes per period">
                <input
                  type="number"
                  min={1}
                  max={300}
                  inputMode="numeric"
                  className={adminInputClass}
                  placeholder={clock?.period_minutes ? String(clock.period_minutes) : '45'}
                  value={ruleDraft.period_minutes}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, period_minutes: event.target.value })
                  }
                />
              </Field>
              <Field label="Break minutes">
                <input
                  type="number"
                  min={0}
                  max={180}
                  inputMode="numeric"
                  className={adminInputClass}
                  placeholder={clock?.break_minutes ? String(clock.break_minutes) : '0'}
                  value={ruleDraft.break_minutes}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, break_minutes: event.target.value })
                  }
                />
              </Field>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={claimBusy}
                  className={adminPrimaryButton}
                >
                  {rulesSaving ? 'Saving…' : 'Save allocations'}
                </button>
                <button
                  type="button"
                  disabled={claimBusy || !isOverride}
                  onClick={() => void resetRules()}
                  className={adminSubtleButton}
                >
                  Reset
                </button>
              </div>
            </form>
          </section>
        )}

        {activeScope === 'stats' && (
          <section data-tour="console-stats" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Match statistics</h2>
              <span className="text-xs text-gray-500">
                Each tap calls <code>record_stat()</code> (atomic + duty checked).
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {(['home', 'away'] as Side[]).map((side) => (
                <div key={side}>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-indigo-300">
                    {side === 'home'
                      ? fixture.home_team?.name ?? 'Home'
                      : fixture.away_team?.name ?? 'Away'}
                  </h3>
                  {writableStatGroups.map((group) => (
                    <div key={group.group ?? 'other'} className="mb-4">
                      {group.group && (
                        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                          {group.group}
                        </p>
                      )}
                      <ul className="space-y-2">
                        {group.options.map((stat) => (
                          <li
                            key={stat.key}
                            className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2"
                          >
                            <span className="text-sm text-gray-300">{stat.label}</span>
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-sm tabular-nums">
                                {statNumber(stats, side, stat.key)}
                              </span>
                              {stat.input === 'value' ? (
                                <>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    aria-label={`Value for ${stat.label} (${side})`}
                                    className={`${adminInputClass} w-20 text-sm`}
                                    value={valueInputs[`${side}:${stat.key}`] ?? ''}
                                    onChange={(event) =>
                                      setValueInputs((current) => ({
                                        ...current,
                                        [`${side}:${stat.key}`]: event.target.value,
                                      }))
                                    }
                                  />
                                  <button
                                    type="button"
                                    disabled={claimBusy}
                                    aria-label={`Record ${stat.label} for ${side}`}
                                    onClick={() => void incrementStat(side, stat.key, stat.input)}
                                    className={adminSubtleButton}
                                  >
                                    Save
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={claimBusy}
                                  aria-label={`Add ${stat.label} for ${side}`}
                                  onClick={() => void incrementStat(side, stat.key, stat.input)}
                                  className={adminSubtleButton}
                                >
                                  +1
                                </button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeScope === 'lineup' && (
          <section data-tour="console-lineup" className="rounded-xl border border-white/5 bg-[#1e293b] p-6 space-y-8">
            <div>
              <h2 className="mb-1 text-lg font-semibold">Lineups &amp; formation</h2>
              <p className="mb-4 text-xs text-gray-500">
                Drag tokens to set each player&apos;s position. Coordinates are stored on{' '}
                <code>fixture_lineups</code> and streamed live to the public page.
              </p>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {(['home', 'away'] as const).map((side) => {
                  const team = side === 'home' ? fixture.home_team : fixture.away_team
                  if (!team) return null
                  const slots = side === 'home' ? homeSlots : awaySlots
                  const squad = players.filter((player) => player.team_id === team.id)
                  const save = (args: {
                    slot: FormationSlot
                    x?: number
                    y?: number
                    role?: string | null
                    isCaptain?: boolean
                  }) =>
                    void writeLineup({
                      teamId: team.id,
                      slot: args.slot.slot,
                      x: args.x ?? args.slot.x,
                      y: args.y ?? args.slot.y,
                      playerId: args.slot.player_id,
                      athleteId: args.slot.athlete_id,
                      role: args.role !== undefined ? args.role : args.slot.role,
                      isCaptain: args.isCaptain ?? args.slot.is_captain,
                    })
                  return (
                    <div key={side} className="space-y-3">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-gray-300">
                        {team.name}
                      </h3>
                      <FormationCanvas
                        court={lineupCourt}
                        slots={slots}
                        teamName={team.name}
                        accent={side}
                        players={squad}
                        saving={lineupSaving}
                        onMove={(slot, x, y) => {
                          setLineups((current) =>
                            current.map((entry) => (entry.id === slot.id ? { ...entry, x, y } : entry)),
                          )
                          save({ slot, x, y })
                        }}
                        onAdd={(playerId, x, y) =>
                          void writeLineup({
                            teamId: team.id,
                            slot: nextSlotFor(team.id),
                            x,
                            y,
                            playerId,
                            isCaptain: false,
                          })
                        }
                        onRemove={(slot) => {
                          if (!slot.id) return
                          void writeLineup({
                            teamId: team.id,
                            slot: slot.slot,
                            playerId: slot.player_id,
                            remove: true,
                            id: slot.id,
                          })
                        }}
                        onToggleCaptain={(slot) => {
                          setLineups((current) =>
                            current.map((entry) =>
                              entry.id === slot.id ? { ...entry, is_captain: !entry.is_captain } : entry,
                            ),
                          )
                          save({ slot, isCaptain: !slot.is_captain })
                        }}
                        onRoleChange={(slot, role) => {
                          setLineups((current) =>
                            current.map((entry) =>
                              entry.id === slot.id ? { ...entry, role: role || null } : entry,
                            ),
                          )
                          save({ slot, role })
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Match Article / Insights Writer */}
            <div className="border-t border-white/10 pt-6">
              <h3 className="text-lg font-bold mb-2">Match Report &amp; Insights Article</h3>
              <p className="text-xs text-gray-400 mb-4">
                Write match insights, tactical summaries, or match reports in Markdown. These insights render directly on the live match overview tab.
              </p>
              <textarea
                rows={8}
                value={articleMd}
                onChange={(e) => setArticleMd(e.target.value)}
                placeholder="# Match Summary&#10;&#10;An intense first half ended 1-1 with both teams pressing high..."
                className={adminInputClass + ' w-full font-mono text-sm'}
              />
              <button
                type="button"
                disabled={articleSaving}
                onClick={() => void saveArticle()}
                className={adminPrimaryButton + ' mt-3'}
              >
                {articleSaving ? 'Saving Article…' : 'Save Insights Article'}
              </button>
            </div>
          </section>
        )}

        {activeScope === 'timeline' ? (
          <div data-tour="console-timeline" className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <section className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
              <h2 className="mb-4 text-lg font-semibold">Timeline ({events.length})</h2>
              {events.length === 0 ? (
                <p className="text-sm text-gray-500">No events logged yet.</p>
              ) : (
                <ul className="space-y-3">
                  {events.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#0f172a] p-3"
                    >
                      <span className="w-10 shrink-0 font-bold text-indigo-400">{row.minute}&apos;</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold capitalize">
                          {row.event_type.replace(/_/g, ' ')}
                        </p>
                        {row.player_name && (
                          <p className="text-xs text-gray-300">{row.player_name}</p>
                        )}
                        {row.details && <p className="text-xs text-gray-500">{row.details}</p>}
                      </div>
                      <button
                        type="button"
                        disabled={claimBusy}
                        onClick={() => void deleteEvent(row.id)}
                        className={adminSubtleButton}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
              <h2 className="mb-4 text-lg font-semibold">Log an event</h2>
              <form onSubmit={logEvent} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Event category">
                    <SelectInput
                      value={newEvent.category}
                      options={EVENT_CATEGORIES.map((cat) => ({
                        value: cat.key,
                        label: cat.label,
                      }))}
                      onValueChange={(value) => setNewEvent({ ...newEvent, category: value })}
                    />
                  </Field>

                  {newEvent.category === 'card_punishment' ? (
                    <Field label="Card Punishment Type">
                      <SelectInput
                        value={newEvent.card_type}
                        options={CARD_PUNISHMENTS.map((card) => ({
                          value: card.type,
                          label: card.label,
                        }))}
                        onValueChange={(value) => setNewEvent({ ...newEvent, card_type: value })}
                      />
                    </Field>
                  ) : (
                    <Field label="Minute">
                      <input
                        type="number"
                        min={0}
                        max={130}
                        className={adminInputClass}
                        value={newEvent.minute}
                        onChange={(event) => setNewEvent({ ...newEvent, minute: event.target.value })}
                      />
                    </Field>
                  )}
                </div>

                {newEvent.category === 'card_punishment' && (
                  <Field label="Minute">
                    <input
                      type="number"
                      min={0}
                      max={130}
                      className={adminInputClass}
                      value={newEvent.minute}
                      onChange={(event) => setNewEvent({ ...newEvent, minute: event.target.value })}
                    />
                  </Field>
                )}

                <Field label="Team">
                  <SelectInput
                    value={newEvent.team_id}
                    options={teamOptions}
                    onValueChange={(value) => setNewEvent({ ...newEvent, team_id: value })}
                  />
                </Field>

                {newEvent.category === 'substitution' ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Player Out (On-Field)">
                      <input
                        type="text"
                        list="match-squad-field"
                        className={adminInputClass}
                        placeholder="Select on-field player"
                        value={newEvent.player_out}
                        onChange={(event) =>
                          setNewEvent({ ...newEvent, player_out: event.target.value })
                        }
                      />
                      <datalist id="match-squad-field">
                        {fieldPlayerOptions.map((player) => (
                          <option key={player.id} value={player.name} />
                        ))}
                      </datalist>
                    </Field>

                    <Field label="Player In (Bench)">
                      <input
                        type="text"
                        list="match-squad-bench"
                        className={adminInputClass}
                        placeholder="Select bench player"
                        value={newEvent.player_in}
                        onChange={(event) =>
                          setNewEvent({ ...newEvent, player_in: event.target.value })
                        }
                      />
                      <datalist id="match-squad-bench">
                        {benchPlayerOptions.map((player) => (
                          <option key={player.id} value={player.name} />
                        ))}
                      </datalist>
                    </Field>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Player">
                      <input
                        type="text"
                        list="match-squad"
                        className={adminInputClass}
                        placeholder="Type or pick a squad member"
                        value={newEvent.player_name}
                        onChange={(event) =>
                          setNewEvent({ ...newEvent, player_name: event.target.value })
                        }
                      />
                      <datalist id="match-squad">
                        {squadForEvent.map((player) => (
                          <option key={player.id} value={player.name} />
                        ))}
                      </datalist>
                    </Field>

                    <Field label="Assist (goals only)">
                      <input
                        type="text"
                        list="match-squad-assist"
                        className={adminInputClass}
                        value={newEvent.assist_name}
                        onChange={(event) =>
                          setNewEvent({ ...newEvent, assist_name: event.target.value })
                        }
                      />
                      <datalist id="match-squad-assist">
                        {squadForEvent.map((player) => (
                          <option key={player.id} value={player.name} />
                        ))}
                      </datalist>
                    </Field>
                  </div>
                )}

                <Field label="Details / notes">
                  <TextInput
                    placeholder="e.g. Tactical substitution, tactical change"
                    value={newEvent.details}
                    onValueChange={(value) => setNewEvent({ ...newEvent, details: value })}
                  />
                </Field>

                <button type="submit" disabled={claimBusy} className={adminPrimaryButton}>
                  {busy ? 'Saving…' : 'Log event'}
                </button>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}
