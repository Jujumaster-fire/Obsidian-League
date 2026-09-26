'use client'

import { useState, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
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
  const raw = searchParams.get('tab') ?? DEFAULT_TAB
  const initialTab: Tab = VALID_TABS.includes(raw as Tab) ? (raw as Tab) : DEFAULT_TAB
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)

  const currentSport = searchParams.get('sport') || 'Football'
  const currentGender = searchParams.get('gender') || 'Female'

  // Filter the data down based on global filters
  const { filteredFixtures, filteredTeams, filteredEvents, filteredPlayers } = useMemo(() => {
    const teams = allTeams.filter(
      (t) =>
        (t.team_type ?? 'Football') === currentSport &&
        (t.category ?? 'Female') === currentGender
    )

    const teamIds = new Set(teams.map((t) => t.id))

    const fixtures = allFixtures.filter(
      (f) => teamIds.has(f.home_team_id) || teamIds.has(f.away_team_id)
    )

    const players = allPlayers.filter((p) => p.team_id && teamIds.has(p.team_id))
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

  const navigateTo = (tab: Tab) => {
    const url = new URL(window.location.href)
    if (tab === DEFAULT_TAB) {
      url.searchParams.delete('tab')
    } else {
      url.searchParams.set('tab', tab)
    }
    router.push(url.pathname + url.search, { scroll: false })
    setActiveTab(tab)
  }

  const scrollToSection = (tab: Tab) => {
    const id = `section-${tab}`
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleTabClick = (tab: Tab) => {
    navigateTo(tab)
    scrollToSection(tab)
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
      <div id="section-overview" className="space-y-12">
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

      {/* Results */}
      <div id="section-results">
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

      {/* Fixtures */}
      <div id="section-fixtures">
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

      {/* Stats */}
      <div id="section-stats" className="space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
            <div className="bg-indigo-900/50 p-4 border-b border-white/10">
              <h3 className="font-bold text-lg">Top Scorers</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-black/20 text-gray-400">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Player</th>
                  <th className="p-3 text-right">Goals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {view.topScorers.map((row, idx) => (
                  <tr key={idx} className="hover:bg-white/5">
                    <td className="p-3">{idx + 1}</td>
                    <td className="p-3">
                      <div className="font-semibold">{row.player?.name}</div>
                      <div className="text-xs text-gray-500">{row.player?.team?.name}</div>
                    </td>
                    <td className="p-3 text-right font-bold text-indigo-400">{row.value}</td>
                  </tr>
                ))}
                {view.topScorers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-gray-500">No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
            <div className="bg-blue-900/50 p-4 border-b border-white/10">
              <h3 className="font-bold text-lg">Top Assists</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-black/20 text-gray-400">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Player</th>
                  <th className="p-3 text-right">Assists</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {view.topAssists.map((row, idx) => (
                  <tr key={idx} className="hover:bg-white/5">
                    <td className="p-3">{idx + 1}</td>
                    <td className="p-3">
                      <div className="font-semibold">{row.player?.name}</div>
                      <div className="text-xs text-gray-500">{row.player?.team?.name}</div>
                    </td>
                    <td className="p-3 text-right font-bold text-blue-400">{row.value}</td>
                  </tr>
                ))}
                {view.topAssists.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-gray-500">No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
            <div className="bg-yellow-900/50 p-4 border-b border-white/10">
              <h3 className="font-bold text-lg">Most Yellow Cards</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-black/20 text-gray-400">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Player</th>
                  <th className="p-3 text-right">Cards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {view.topYellow.map((row, idx) => (
                  <tr key={idx} className="hover:bg-white/5">
                    <td className="p-3">{idx + 1}</td>
                    <td className="p-3">
                      <div className="font-semibold">{row.player?.name}</div>
                      <div className="text-xs text-gray-500">{row.player?.team?.name}</div>
                    </td>
                    <td className="p-3 text-right font-bold text-yellow-400">{row.value}</td>
                  </tr>
                ))}
                {view.topYellow.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-gray-500">No data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
            <div className="bg-red-900/50 p-4 border-b border-white/10">
              <h3 className="font-bold text-lg">Most Red Cards</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-black/20 text-gray-400">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Player</th>
                  <th className="p-3 text-right">Cards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {view.topRed.map((row, idx) => (
                  <tr key={idx} className="hover:bg-white/5">
                    <td className="p-3">{idx + 1}</td>
                    <td className="p-3">
                      <div className="font-semibold">{row.player?.name}</div>
                      <div className="text-xs text-gray-500">{row.player?.team?.name}</div>
                    </td>
                    <td className="p-3 text-right font-bold text-red-400">{row.value}</td>
                  </tr>
                ))}
                {view.topRed.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-gray-500">No data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Groups */}
      <div id="section-groups">
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

      {/* Playoffs */}
      <div id="section-playoffs">
        <PlayoffTabs
          quarterFinal={view.playoffMatches.filter((f) => f.stage === 'quarter_final')}
          semiFinal={view.playoffMatches.filter((f) => f.stage === 'semi_final')}
          final={view.playoffMatches.filter((f) => f.stage === 'final')}
        />
      </div>
    </div>
  )
}
