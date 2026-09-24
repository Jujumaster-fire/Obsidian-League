import { Suspense } from 'react'
import { createClient } from '@/utils/supabase/client'
import Navigation from '@/components/Navigation'
import { MatchCenterSkeleton } from '@/components/Skeleton'
import { MatchRealtimeClient } from './MatchRealtimeClient'
import { parseSportArrangement } from '@/lib/sports'
import type { CourtConfig } from '@/components/FormationCanvas'
import Link from 'next/link'
import type { Metadata } from 'next'

export const revalidate = 30

interface MatchPageServerProps {
  params: Promise<{ id: string }>
}

/* Match event shape for server-rendered timeline sections. */
export interface MatchEventShape {
  id: string
  minute: number | null
  event_type: string
  player_name: string | null
  details: string | null
  team_id: string | null
}

/* Minimal team/stats shapes used by the server-rendered body. */
export interface MatchTeamShape {
  id: string
  name: string
  short_name: string
  attire_color: string | null
  roster: string | null
  category: string | null
  team_type: string | null
}

export interface MatchStatsShape {
  home?: Record<string, number>
  away?: Record<string, number>
  elapsed_seconds?: number
  timer_started_at?: string | null
  [key: string]: unknown
}

/** One stored formation token (PART 15 `fixture_lineups`) with its team id. */
export interface MatchLineupSlot {
  id: string
  teamId: string
  slot: number
  player_id: string | null
  athlete_id: string | null
  role: string | null
  x: number
  y: number
  is_captain: boolean
}

/** Full squad name lookup for the tokens, so the canvas can label them. */
export interface MatchSquadPlayer {
  id: string
  team_id: string
  name: string
}

export interface MatchFixtureShape {
  id: string
  venue: string | null
  status: string | null
  match_date: string
  home_score: number | null
  away_score: number | null
  current_minute: number | null
  home_team: MatchTeamShape
  away_team: MatchTeamShape
  stats: MatchStatsShape | null
}

export async function generateMetadata({ params }: MatchPageServerProps): Promise<Metadata> {
  const { id } = await params
  const supabase = createClient()
  const { data: fixture } = await supabase
    .from('fixtures')
    .select('*, home_team:home_team_id(name,short_name), away_team:away_team_id(name,short_name)')
    .eq('id', id)
    .single()

  if (!fixture) {
    return { title: 'Match Not Found | Obsidian Elite' }
  }

  const home = fixture.home_team as { name: string; short_name: string } | null
  const away = fixture.away_team as { name: string; short_name: string } | null
  const label =
    fixture.status === 'in_progress'
      ? 'LIVE'
      : fixture.status === 'full_time'
        ? 'FT'
        : fixture.status === 'cancelled'
          ? 'CANCELLED'
          : 'vs'
  const title = `${home?.name ?? 'Home'} ${label} ${away?.name ?? 'Away'} | Obsidian Elite`
  const desc =
    home && away
      ? `${home.name} vs ${away.name}${fixture.status === 'in_progress' ? ' (LIVE)' : ''}`
      : 'Obsidian Elite match details'

  return {
    title,
    description: desc,
    openGraph: { title, description: desc },
  }
}
export default async function MatchServer({ params }: MatchPageServerProps) {
  const { id } = await params
  const supabase = createClient()

  const [fixtureRes, eventsRes] = await Promise.all([
    supabase
      .from('fixtures')
      .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
      .eq('id', id)
      .single(),
    supabase
      .from('match_events')
      .select('*, player:player_id(*), assist_player:assist_player_id(*), team:team_id(*)')
      .eq('fixture_id', id)
      .order('minute', { ascending: true }),
  ])

  const rawFixture = fixtureRes.data as Record<string, unknown> | null
  const rawEvents = (eventsRes.data ?? []) as Record<string, unknown>[]

  if (!rawFixture) {
    return null
  }

  const homeTeam = rawFixture.home_team as MatchTeamShape
  const awayTeam = rawFixture.away_team as MatchTeamShape
  const fixture: MatchFixtureShape = {
    id: id,
    venue: (rawFixture.venue as string | null) ?? null,
    status: (rawFixture.status as string | null) ?? null,
    match_date: rawFixture.match_date as string,
    home_score: (rawFixture.home_score as number | null) ?? null,
    away_score: (rawFixture.away_score as number | null) ?? null,
    current_minute: (rawFixture.current_minute as number | null) ?? null,
    home_team: homeTeam,
    away_team: awayTeam,
    stats: (rawFixture.stats as MatchStatsShape | null) ?? null,
  }

  const events: MatchEventShape[] = rawEvents.map((e) => ({
    id: e.id as string,
    minute: (e.minute as number | null) ?? null,
    event_type: e.event_type as string,
    player_name: (e.player_name as string | null) ?? null,
    details: (e.details as string | null) ?? null,
    team_id: (e.team_id as string | null) ?? null,
  }))

  // PART 15: the sport's court shape + this fixture's stored formation and the
  // two squads, so the Line-up tab renders server-side on first paint.
  const sportId = (rawFixture.sport_id as string | null) ?? null
  const teamIds = [homeTeam?.id, awayTeam?.id].filter(Boolean) as string[]
  const [sportRes, lineupRes, squadRes] = await Promise.all([
    sportId
      ? supabase
          .from('sports')
          .select('id, code, name, scoring_type, stat_vocab, event_vocab, scoring_config')
          .eq('id', sportId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('fixture_lineups')
      .select('id, team_id, slot, player_id, athlete_id, role, x, y, is_captain')
      .eq('fixture_id', id)
      .order('slot', { ascending: true }),
    teamIds.length > 0
      ? supabase.from('players').select('id, team_id, name').in('team_id', teamIds)
      : Promise.resolve({ data: [] as MatchSquadPlayer[] }),
  ])

  const court: CourtConfig = sportRes.data
    ? parseSportArrangement(sportRes.data as Parameters<typeof parseSportArrangement>[0]).court
    : { shape: 'pitch', orientation: 'horizontal' }

  const initialLineups: MatchLineupSlot[] = Array.isArray(lineupRes.data)
    ? (lineupRes.data as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        teamId: String(row.team_id),
        slot: Number(row.slot),
        player_id: (row.player_id as string | null) ?? null,
        athlete_id: (row.athlete_id as string | null) ?? null,
        role: (row.role as string | null) ?? null,
        x: Number(row.x),
        y: Number(row.y),
        is_captain: Boolean(row.is_captain),
      }))
    : []

  const squad = (Array.isArray(squadRes.data) ? squadRes.data : []) as MatchSquadPlayer[]

  const isLive = fixture.status === 'in_progress' || fixture.status === 'extra_time'
  const initialEvents = events.slice(0, 5)

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <MatchHeader fixture={fixture} isLive={isLive} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2">
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
          <MatchMetaCard fixture={fixture} />
          <MatchMiniEvents initialEvents={initialEvents} />

          <Suspense fallback={<MatchCenterSkeleton />}>
            <MatchRealtimeClient
              key={id}
              fixtureId={id}
              fixture={fixture}
              initialEvents={events}
              initialLineups={initialLineups}
              squad={squad}
              court={court}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function MatchHeader({ fixture, isLive }: { fixture: MatchFixtureShape; isLive: boolean }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
      <div className="max-w-5xl mx-auto mb-8">
        <div className="flex items-center justify-center gap-6 flex-wrap">
          <Link href={`/team/${fixture.home_team.id}`} className="flex flex-col items-center gap-4 flex-1 group">
            <div
              className="w-20 h-20 sm:w-32 sm:h-32 rounded-full flex items-center justify-center font-black text-2xl sm:text-5xl text-white/50 border border-white/10 group-hover:scale-105 transition-transform shadow-xl"
              style={{
                backgroundColor:
                  fixture.home_team.attire_color === 'Yet to be decided'
                    ? '#334155'
                    : (fixture.home_team.attire_color ?? '#334155'),
              }}
            >
              {fixture.home_team.short_name}
            </div>
            <span className="font-bold text-lg sm:text-2xl text-center group-hover:text-indigo-300 transition-colors">
              {fixture.home_team.name}
            </span>
          </Link>

          <div className="flex flex-col items-center px-4 sm:px-8 shrink-0">
            <div className={`text-3xl sm:text-6xl font-black ${isLive ? 'text-red-400 drop-shadow-lg' : 'text-white drop-shadow-lg'}`}>
              {fixture.home_score} - {fixture.away_score}
            </div>
            <div className={`text-sm font-medium mt-2 ${isLive ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>
              {isLive
                ? 'LIVE'
                : fixture.status === 'full_time'
                  ? 'FT'
                  : fixture.status === 'cancelled'
                    ? 'CANCELLED'
                    : new Date(fixture.match_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>

          <Link href={`/team/${fixture.away_team.id}`} className="flex flex-col items-center gap-4 flex-1 group">
            <div
              className="w-20 h-20 sm:w-32 sm:h-32 rounded-full flex items-center justify-center font-black text-2xl sm:text-5xl text-white/50 border border-white/10 group-hover:scale-105 transition-transform shadow-xl"
              style={{
                backgroundColor:
                  fixture.away_team.attire_color === 'Yet to be decided'
                    ? '#334155'
                    : (fixture.away_team.attire_color ?? '#334155'),
              }}
            >
              {fixture.away_team.short_name}
            </div>
            <span className="font-bold text-lg sm:text-2xl text-center group-hover:text-indigo-300 transition-colors">
              {fixture.away_team.name}
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}

function MatchMetaCard({ fixture }: { fixture: MatchFixtureShape }) {
  return (
    <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5 text-center text-gray-400">
      <p>
        Venue: <span className="text-white font-medium">{fixture.venue || 'TBD'}</span>
      </p>
      <p className="mt-2">
        Competition:{' '}
        <span className="text-white font-medium">
          Obsidian Elite {fixture.home_team.category} {fixture.home_team.team_type}
        </span>
      </p>
    </div>
  )
}

function MatchMiniEvents({ initialEvents }: { initialEvents: MatchEventShape[] }) {
  return (
    <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5">
      <h3 className="font-bold text-lg mb-4 text-center">Match Events</h3>
      {initialEvents.length === 0 ? (
        <p className="text-gray-500 text-center text-sm">No events logged yet.</p>
      ) : (
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {initialEvents.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-sm py-2 border-b border-white/5 last:border-0">
              <span className="text-gray-400 w-12">{e.minute}&apos;</span>
              <span className="flex-1 font-medium text-center text-white">
                {e.event_type.replace(/_/g, ' ')}
              </span>
              <span className="text-gray-400 flex-1 text-right truncate">
                {e.player_name || 'N/A'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
