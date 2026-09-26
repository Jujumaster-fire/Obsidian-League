'use client'

import { useState, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Suspense } from 'react'
import { BrandedLoader } from '@/components/Skeleton'
import {
  computeCompetitionsView,
  type Fixture,
  type Team,
  type Event,
  type Player,
} from '@/lib/competitions-standings'
import { FixtureCard } from '@/components/competitions/FixtureCard'
import { StandingsTable } from '@/components/competitions/Standings'
import { PlayoffTabs } from '@/components/competitions/PlayoffTabs'
import { RealtimeClient } from './RealtimeClient'
import { StatPreviewCard } from '@/components/competitions/StatPreviewCard'
import { StatModal, type StatModalRow } from '@/components/competitions/StatModal'

const VALID_TABS = ['overview', 'results', 'fixtures', 'stats', 'groups', 'playoffs'] as const
type Tab = (typeof VALID_TABS)[number]

const DEFAULT_TAB: Tab = 'overview'

interface CompetitionsTabsProps {
  fixtures: Fixture[]
  teams: Team[]
  events: Event[]
  players: Player[]
}

export function CompetitionsTabs({ fixtures: allFixtures, teams: allTeams, events: allEvents, players: allPlayers }: CompetitionsTabsProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const raw = searchParams.get('tab') ?? DEFAULT_TAB
  const activeTab: Tab = VALID_TABS.includes(raw as Tab) ? (raw as Tab) : DEFAULT_TAB

  const currentSport = searchParams.get('sport') || 'Football'
  const currentGender = searchParams.get('gender') || 'Female'

  // Filter the data down based on global filters
  const { filteredFixtures, filteredTeams, filteredEvents, filteredPlayers } = useMemo(() => {
    // 1. Find all teams that match the filter exactly.
    const primaryTeams = allTeams.filter(
      (t) =>
        (t.team_type ?? 'Football').toLowerCase() === currentSport.toLowerCase() &&
        (t.category ?? 'Female').toLowerCase() === currentGender.toLowerCase()
    )
    const primaryTeamIds = new Set(primaryTeams.map((t) => t.id))

    // 2. Find fixtures where AT LEAST ONE team matches the filter.
    const fixtures = allFixtures.filter(
      (f) => primaryTeamIds.has(f.home_team_id) || primaryTeamIds.has(f.away_team_id)
    )

    // 3. To prevent missing teams in the UI, include all teams that participate in these fixtures.
    const participatingTeamIds = new Set<string>()
    fixtures.forEach(f => {
      participatingTeamIds.add(f.home_team_id)
      participatingTeamIds.add(f.away_team_id)
    })

    const teams = allTeams.filter(t => participatingTeamIds.has(t.id))

    // 4. Filter players and events normally based on the participating teams.
    const players = allPlayers.filter((p) => p.team_id && participatingTeamIds.has(p.team_id))
    const playerIds = new Set(players.map((p) => p.id))

    const events = allEvents.filter(
      (e) => (e.player_id && playerIds.has(e.player_id)) || (e.assist_player_id && playerIds.has(e.assist_player_id))
    )

    return { filteredFixtures: fixtures, filteredTeams: teams, filteredEvents: events, filteredPlayers: players }
  }, [allFixtures, allTeams, allEvents, allPlayers, currentSport, currentGender])

  const view = computeCompetitionsView(filteredFixtures, filteredTeams, filteredEvents, filteredPlayers)

  const isOngoing = (status: string | null | undefined) =>
    status === 'in_progress' || status === 'extra_time' || status === 'paused' || status === 'half_time'

  const liveFixtures = [...view.results, ...view.upcoming]
    .filter((f) => isOngoing(f.status))
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())

  // Upcoming STRICTLY scheduled
  const upcoming = view.upcoming.filter(
    (f) => f.status === 'scheduled' || f.status === 'delayed' || f.status === 'suspended'
  )

  // Results STRICTLY full time
  const results = view.results.filter((f) => f.status === 'full_time')

  const handleTabClick = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === DEFAULT_TAB) {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  // --- STATS STATE ---
  const [modalOpen, setModalOpen] = useState(false)
  const [modalConfig, setModalConfig] = useState<{title: string, headers: [string, string, string], data: StatModalRow[]}>({
    title: '', headers: ['#', 'Name', 'Value'], data: []
  })

  const openStatModal = (title: string, entityLabel: string, valueLabel: string, rawData: { player?: Player, team?: Team, value: number }[]) => {
    const data: StatModalRow[] = rawData.map((row) => {
      if (row.player) {
        return { id: row.player.id, title: row.player.name, subtitle: row.player.team?.name ?? '', value: row.value }
      } else if (row.team) {
        return { id: row.team.id, title: row.team.name, subtitle: row.team.short_name ?? '', value: row.value }
      }
      return { id: Math.random().toString(), title: 'Unknown', value: row.value }
    })
    setModalConfig({ title, headers: ['#', entityLabel, valueLabel], data })
    setModalOpen(true)
  }

  return (
    <div className="space-y-12">
      {/* Section tabs — sticky header strip, pinned under the site nav on all devices. */}
      <nav
        aria-label="Competition sections"
        className="sticky top-16 z-20 -mx-4 border-b border-white/10 bg-[#0f172a]/95 backdrop-blur sm:mx-0"
      >
        <div className="mx-auto flex max-w-3xl justify-start gap-1 overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden">
          {VALID_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabClick(tab)}
              aria-current={activeTab === tab ? 'true' : undefined}
              className={`whitespace-nowrap border-b-[3px] px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-gray-400 hover:border-white/20 hover:text-gray-200'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' ')}
            </button>
          ))}
        </div>
      </nav>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-12 animate-in fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1e293b] rounded-lg p-5 border border-white/5">
              <h3 className="text-lg font-bold mb-2 text-indigo-400">Matches Played</h3>
              <div className="text-3xl font-black">{results.length}</div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-5 border border-white/5">
              <h3 className="text-lg font-bold mb-2 text-emerald-400">Upcoming</h3>
              <div className="text-3xl font-black">{upcoming.length}</div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-5 border border-white/5">
              <h3 className="text-lg font-bold mb-2 text-rose-400">Live Now</h3>
              <div className="text-3xl font-black text-red-400">{liveFixtures.length}</div>
            </div>
          </div>

          <Suspense fallback={<BrandedLoader message="Refreshing live matches…" />}>
            <RealtimeClient liveFixtures={liveFixtures} />
          </Suspense>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-[#1e293b] p-5 rounded-lg border border-white/5">
              <h3 className="text-lg font-bold mb-4 text-emerald-400">Upcoming Fixtures</h3>
              {upcoming.length === 0 ? (
                <p className="text-gray-400 text-sm">No upcoming fixtures scheduled.</p>
              ) : (
                <div className="space-y-4">
                  {upcoming.slice(0, 5).map((f) => (
                    <FixtureCard key={f.id} match={f} />
                  ))}
                  {upcoming.length > 5 && (
                    <div className="text-center">
                      <span className="text-emerald-400 text-sm">
                        +{upcoming.length - 5} more on{' '}
                        <button
                          onClick={() => handleTabClick('fixtures')}
                          className="underline hover:text-emerald-300"
                        >
                          fixtures
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-[#1e293b] p-5 rounded-lg border border-white/5">
              <h3 className="text-lg font-bold mb-4 text-indigo-400">Latest Results</h3>
              {results.length === 0 ? (
                <p className="text-gray-400 text-sm">No matches have been played yet.</p>
              ) : (
                <div className="space-y-4">
                  {results.slice(0, 5).map((f) => (
                    <FixtureCard key={f.id} match={f} />
                  ))}
                  {results.length > 5 && (
                    <div className="text-center">
                      <span className="text-indigo-400 text-sm">
                        +{results.length - 5} more results on{' '}
                        <button
                          onClick={() => handleTabClick('results')}
                          className="underline hover:text-indigo-300"
                        >
                          results
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-black/20 rounded-lg p-5 border border-white/10">
              <h3 className="font-bold text-lg text-emerald-400 mb-4">Top Goal Scorers</h3>
              {view.topScorers.length === 0 ? (
                <p className="text-gray-400 text-sm">No goals have been scored yet.</p>
              ) : (
                <div className="space-y-3">
                  {view.topScorers.slice(0, 8).map((row, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold">{row.player?.name}</div>
                        <div className="text-xs text-gray-500">{row.player?.team?.name}</div>
                      </div>
                      <div className="text-xl font-black text-emerald-400">{row.value}</div>
                    </div>
                  ))}
                  {view.topScorers.length > 8 && (
                    <p className="text-gray-500 text-sm mt-3 pt-3 border-t border-white/5">
                      +{view.topScorers.length - 8} more players on stats tab
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-black/20 rounded-lg p-5 border border-white/10">
              <h3 className="font-bold text-lg text-amber-400 mb-4">Clean Sheets</h3>
              {view.topCleanSheets.length === 0 ? (
                <p className="text-gray-400 text-sm">No clean sheet data yet.</p>
              ) : (
                <div className="space-y-3">
                  {view.topCleanSheets.slice(0, 8).map((row, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold">{row.player?.name}</div>
                        <div className="text-xs text-gray-500">
                          {row.player?.team?.name}
                        </div>
                      </div>
                      <div className="text-xl font-black text-amber-400">{row.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {activeTab === 'results' && (
        <div className="animate-in fade-in">
          <h2 className="text-2xl font-bold mb-6">Match Results</h2>
          {results.length === 0 ? (
            <div className="p-10 text-center bg-[#1e293b] rounded-lg border border-white/5">
              No matches have ended yet.
            </div>
          ) : (
            <div className="grid gap-4">
              {results.map((f) => (
                <FixtureCard key={f.id} match={f} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fixtures */}
      {activeTab === 'fixtures' && (
        <div className="animate-in fade-in">
          <h2 className="text-2xl font-bold mb-6">Upcoming Matches</h2>
          {upcoming.length === 0 ? (
            <div className="p-20 text-center bg-[#1e293b] rounded-lg border border-white/5">
              No upcoming matches scheduled.
            </div>
          ) : (
            <div className="grid gap-4">
              {upcoming.map((f) => (
                <FixtureCard key={f.id} match={f} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {activeTab === 'stats' && (
        <div className="space-y-8 animate-in fade-in">
          <h2 className="text-2xl font-bold mb-6">Competition Statistics</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">

            <StatPreviewCard
              title="Top Scorers (Teams)"
              data={view.teamScorers.map(r => ({ id: r.team.id, title: r.team.name, subtitle: r.team.short_name ?? '', value: r.value }))}
              themeColor="indigo"
              onClick={() => openStatModal('Top Scorers (Teams)', 'Team', 'Goals', view.teamScorers)}
            />

            <StatPreviewCard
              title="Top Scorers (Players)"
              data={view.topScorers.map(r => ({ id: r.player?.id ?? '', title: r.player?.name ?? '', subtitle: r.player?.team?.name ?? '', value: r.value }))}
              themeColor="indigo"
              onClick={() => openStatModal('Top Scorers (Players)', 'Player', 'Goals', view.topScorers)}
            />

            <StatPreviewCard
              title="Top Assists (Players)"
              data={view.topAssists.map(r => ({ id: r.player?.id ?? '', title: r.player?.name ?? '', subtitle: r.player?.team?.name ?? '', value: r.value }))}
              themeColor="blue"
              onClick={() => openStatModal('Top Assists (Players)', 'Player', 'Assists', view.topAssists)}
            />

            <StatPreviewCard
              title="Highest Tackles (Teams)"
              data={view.teamTackles.map(r => ({ id: r.team.id, title: r.team.name, subtitle: r.team.short_name ?? '', value: r.value }))}
              themeColor="emerald"
              onClick={() => openStatModal('Highest Tackles (Teams)', 'Team', 'Tackles', view.teamTackles)}
            />

            <StatPreviewCard
              title="Highest Tackles (Players)"
              data={view.topTacklesPlayers.map(r => ({ id: r.player?.id ?? '', title: r.player?.name ?? '', subtitle: r.player?.team?.name ?? '', value: r.value }))}
              themeColor="emerald"
              onClick={() => openStatModal('Highest Tackles (Players)', 'Player', 'Tackles', view.topTacklesPlayers)}
            />

            <StatPreviewCard
              title="Highest Interceptions (Teams)"
              data={view.teamInterceptions.map(r => ({ id: r.team.id, title: r.team.name, subtitle: r.team.short_name ?? '', value: r.value }))}
              themeColor="yellow"
              onClick={() => openStatModal('Highest Interceptions (Teams)', 'Team', 'Interceptions', view.teamInterceptions)}
            />

            <StatPreviewCard
              title="Top Duels Won (Teams)"
              data={view.teamDuelsWon.map(r => ({ id: r.team.id, title: r.team.name, subtitle: r.team.short_name ?? '', value: r.value }))}
              themeColor="amber"
              onClick={() => openStatModal('Top Duels Won (Teams)', 'Team', 'Duels Won', view.teamDuelsWon)}
            />

            <StatPreviewCard
              title="Clean Sheets (Teams)"
              data={view.teamCleanSheets.map(r => ({ id: r.team.id, title: r.team.name, subtitle: r.team.short_name ?? '', value: r.value }))}
              themeColor="amber"
              onClick={() => openStatModal('Clean Sheets (Teams)', 'Team', 'Clean Sheets', view.teamCleanSheets)}
            />

            <StatPreviewCard
              title="Clean Sheets (Goalkeepers)"
              data={view.topCleanSheets.map(r => ({ id: r.player?.id ?? '', title: r.player?.name ?? '', subtitle: r.player?.team?.name ?? '', value: r.value }))}
              themeColor="amber"
              onClick={() => openStatModal('Clean Sheets (Goalkeepers)', 'Goalkeeper', 'Clean Sheets', view.topCleanSheets)}
            />

            <StatPreviewCard
              title="Highest Shots (Teams)"
              data={view.teamShots.map(r => ({ id: r.team.id, title: r.team.name, subtitle: r.team.short_name ?? '', value: r.value }))}
              themeColor="indigo"
              onClick={() => openStatModal('Highest Shots (Teams)', 'Team', 'Shots', view.teamShots)}
            />

            <StatPreviewCard
              title="Shots On Target (Teams)"
              data={view.teamShotsOnTarget.map(r => ({ id: r.team.id, title: r.team.name, subtitle: r.team.short_name ?? '', value: r.value }))}
              themeColor="indigo"
              onClick={() => openStatModal('Shots On Target (Teams)', 'Team', 'Shots on Target', view.teamShotsOnTarget)}
            />

            <StatPreviewCard
              title="Yellow Cards"
              data={view.topYellow.map(r => ({ id: r.player?.id ?? '', title: r.player?.name ?? '', subtitle: r.player?.team?.name ?? '', value: r.value }))}
              themeColor="yellow"
              isTotalView={true}
              onClick={() => openStatModal('Yellow Cards Leaderboard', 'Player', 'Cards', view.topYellow)}
            />

            <StatPreviewCard
              title="Red Cards"
              data={view.topRed.map(r => ({ id: r.player?.id ?? '', title: r.player?.name ?? '', subtitle: r.player?.team?.name ?? '', value: r.value }))}
              themeColor="rose"
              isTotalView={true}
              onClick={() => openStatModal('Red Cards Leaderboard', 'Player', 'Cards', view.topRed)}
            />

          </div>

          <StatModal
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            title={modalConfig.title}
            headers={modalConfig.headers}
            data={modalConfig.data}
          />

        </div>
      )}

      {/* Groups */}
      {activeTab === 'groups' && (
        <div className="animate-in fade-in">
          <h2 className="text-2xl font-bold mb-6">Group Standings</h2>
          {view.groupNames.length === 0 ? (
            <div className="p-10 text-center bg-[#1e293b] rounded-lg border border-white/5 text-gray-400">
              No groups have been set up yet.
            </div>
          ) : (
            view.groupNames.map((groupName) => (
              <div key={groupName} className="space-y-4">
                <h3 className="text-xl font-semibold text-indigo-400">
                  {groupName.replace(/_/g, ' ')}
                </h3>
                <StandingsTable rows={view.standings[groupName] ?? []} />
              </div>
            ))
          )}
        </div>
      )}

      {/* Playoffs */}
      {activeTab === 'playoffs' && (
        <div className="animate-in fade-in">
          <PlayoffTabs
            playoffMatches={view.playoffMatches}
          />
        </div>
      )}
    </div>
  )
}
