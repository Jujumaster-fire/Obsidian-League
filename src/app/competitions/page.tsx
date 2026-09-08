/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, Suspense } from 'react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

function CompetitionsContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'overview'

    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [fixtures, setFixtures] = useState<any[]>([])
    const [teams, setTeams] = useState<any[]>([])
    const [events, setEvents] = useState<any[]>([])
    const [players, setPlayers] = useState<any[]>([])
    const [settings, setSettings] = useState<any>(null)

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true)
            const [fixturesRes, teamsRes, eventsRes, playersRes, settingsRes] = await Promise.all([
                supabase.from('fixtures').select('*, home_team:home_team_id(*), away_team:away_team_id(*)').order('match_date', { ascending: true }),
                supabase.from('teams').select('*').order('name'),
                supabase.from('match_events').select('*, player:player_id(*), assist_player:assist_player_id(*), team:team_id(*)'),
                supabase.from('players').select('*, team:team_id(*)'),
                supabase.from('tournament_settings').select('*').limit(1).single()
            ])

            if (fixturesRes.data) setFixtures(fixturesRes.data)
            if (teamsRes.data) setTeams(teamsRes.data)
            if (eventsRes.data) setEvents(eventsRes.data)
            if (playersRes.data) setPlayers(playersRes.data)
            if (settingsRes.data) setSettings(settingsRes.data)

            setLoading(false)
        }
        fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const setTab = (tab: string) => {
        router.push(`/competitions?tab=${tab}`)
    }

    // --- COMPUTATIONS ---

    // Results: Full time matches
    const results = fixtures.filter(f => f.status === 'full_time').sort((a,b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())

    // Fixtures: Upcoming / In Progress
    const upcoming = fixtures.filter(f => f.status !== 'full_time' && f.status !== 'cancelled')

    // Standings (Groups)
    const groupStats: Record<string, any[]> = {}
    teams.forEach(t => {
        if (t.group_name) {
            if (!groupStats[t.group_name]) groupStats[t.group_name] = []
            groupStats[t.group_name].push({
                id: t.id, name: t.name, short_name: t.short_name, logo: t.logo_url,
                played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gd: 0
            })
        }
    })

    results.filter(f => f.stage === 'group_stage').forEach(f => {
        const homeTeam = teams.find(t => t.id === f.home_team_id)
        const awayTeam = teams.find(t => t.id === f.away_team_id)

        if (homeTeam && homeTeam.group_name && groupStats[homeTeam.group_name]) {
            const hs = groupStats[homeTeam.group_name].find(t => t.id === f.home_team_id)
            if (hs) {
                hs.played++
                hs.goalsFor += f.home_score || 0
                hs.goalsAgainst += f.away_score || 0
                if ((f.home_score || 0) > (f.away_score || 0)) { hs.won++; hs.points += 3 }
                else if (f.home_score === f.away_score) { hs.drawn++; hs.points += 1 }
                else { hs.lost++ }
                hs.gd = hs.goalsFor - hs.goalsAgainst
            }
        }
        if (awayTeam && awayTeam.group_name && groupStats[awayTeam.group_name]) {
            const as = groupStats[awayTeam.group_name].find(t => t.id === f.away_team_id)
            if (as) {
                as.played++
                as.goalsFor += f.away_score || 0
                as.goalsAgainst += f.home_score || 0
                if ((f.away_score || 0) > (f.home_score || 0)) { as.won++; as.points += 3 }
                else if (f.home_score === f.away_score) { as.drawn++; as.points += 1 }
                else { as.lost++ }
                as.gd = as.goalsFor - as.goalsAgainst
            }
        }
    })

    Object.keys(groupStats).forEach(group => {
        groupStats[group].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points
            return b.gd - a.gd
        })
    })

    // Sort group names alphabetically to display A, B, C, D...
    const sortedGroupNames = Object.keys(groupStats).sort()

    // Stats: Top Scorers
    const goalEvents = events.filter(e => e.event_type === 'goal' && e.player_id)
    const scorersMap: Record<string, number> = {}
    goalEvents.forEach(e => { scorersMap[e.player_id] = (scorersMap[e.player_id] || 0) + 1 })
    const topScorers = Object.keys(scorersMap).map(id => ({ player: players.find(p => p.id === id), goals: scorersMap[id] })).sort((a,b) => b.goals - a.goals).slice(0, 10)

    // Stats: Top Assists
    const assistEvents = events.filter(e => e.event_type === 'goal' && e.assist_player_id)
    const assistsMap: Record<string, number> = {}
    assistEvents.forEach(e => { assistsMap[e.assist_player_id] = (assistsMap[e.assist_player_id] || 0) + 1 })
    const topAssists = Object.keys(assistsMap).map(id => ({ player: players.find(p => p.id === id), assists: assistsMap[id] })).sort((a,b) => b.assists - a.assists).slice(0, 10)

    // Stats: Cards
    const yellowMap: Record<string, number> = {}
    const redMap: Record<string, number> = {}
    events.filter(e => e.event_type === 'yellow_card' && e.player_id).forEach(e => { yellowMap[e.player_id] = (yellowMap[e.player_id] || 0) + 1 })
    events.filter(e => e.event_type === 'red_card' && e.player_id).forEach(e => { redMap[e.player_id] = (redMap[e.player_id] || 0) + 1 })
    const topYellow = Object.keys(yellowMap).map(id => ({ player: players.find(p => p.id === id), cards: yellowMap[id] })).sort((a,b) => b.cards - a.cards).slice(0, 10)
    const topRed = Object.keys(redMap).map(id => ({ player: players.find(p => p.id === id), cards: redMap[id] })).sort((a,b) => b.cards - a.cards).slice(0, 10)

    // Stats: Team XG
    const teamXgMap: Record<string, number> = {}
    results.forEach(f => {
        teamXgMap[f.home_team_id] = (teamXgMap[f.home_team_id] || 0) + (f.home_xg || 0)
        teamXgMap[f.away_team_id] = (teamXgMap[f.away_team_id] || 0) + (f.away_xg || 0)
    })
    const teamXg = Object.keys(teamXgMap).map(id => ({ team: teams.find(t => t.id === id), xg: teamXgMap[id] })).sort((a,b) => b.xg - a.xg)

    // Stats: Clean Sheets
    const gkCleanSheetsMap: Record<string, number> = {}
    results.forEach(f => {
        if (f.home_clean_sheet && f.home_goalkeeper_id) gkCleanSheetsMap[f.home_goalkeeper_id] = (gkCleanSheetsMap[f.home_goalkeeper_id] || 0) + 1
        if (f.away_clean_sheet && f.away_goalkeeper_id) gkCleanSheetsMap[f.away_goalkeeper_id] = (gkCleanSheetsMap[f.away_goalkeeper_id] || 0) + 1
    })
    const topCleanSheets = Object.keys(gkCleanSheetsMap).map(id => ({ player: players.find(p => p.id === id), clean_sheets: gkCleanSheetsMap[id] })).sort((a,b) => b.clean_sheets - a.clean_sheets).slice(0, 10)

    // Play-offs Matches & Unique Stages
    const playoffMatches = fixtures.filter(f => f.stage && f.stage !== 'group_stage')
    const playoffStages = Array.from(new Set(playoffMatches.map(f => f.stage)))

    const MatchCard = ({ match }: { match: any }) => (
        <div className="bg-[#1e293b] rounded-lg p-4 flex flex-col md:flex-row items-center justify-between border border-white/10 hover:border-indigo-500 transition-colors">
             <div className="text-sm text-gray-400 mb-2 md:mb-0 w-full md:w-32 text-center md:text-left">
                {new Date(match.match_date).toLocaleDateString()}
                <div className="text-xs uppercase mt-1">{match.stage.replace(/_/g, ' ')}</div>
             </div>
             <div className="flex items-center justify-center gap-4 flex-1">
                 <div className="text-right flex-1 font-bold text-lg">{match.home_team?.name}</div>
                 <div className="bg-slate-900 px-4 py-2 rounded font-mono text-xl tracking-wider min-w-[80px] text-center border border-white/5">
                     {match.status === 'scheduled' ? 'vs' : `${match.home_score} - ${match.away_score}`}
                 </div>
                 <div className="text-left flex-1 font-bold text-lg">{match.away_team?.name}</div>
             </div>
             <div className="w-full md:w-32 flex justify-end mt-2 md:mt-0">
                 {match.status === 'in_progress' ? (
                     <span className="text-red-500 font-bold animate-pulse text-sm">LIVE</span>
                 ) : match.status === 'full_time' ? (
                     <span className="text-gray-500 text-sm">FT</span>
                 ) : (
                     <span className="text-indigo-400 text-sm">{new Date(match.match_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                 )}
             </div>
        </div>
    )

    return (
        <div className="min-h-screen bg-[#0f172a] text-white pb-32">
            <Navigation />

            <div className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                <header className="mb-10 text-center md:text-left flex flex-col md:flex-row justify-between items-center gap-4">
                    <div>
                        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-2">Competitions</h1>
                        <p className="text-gray-400 text-lg">Obsidian Elite Tournament Hub</p>
                    </div>
                </header>

                {/* Navigation Row */}
                <div className="flex overflow-x-auto gap-2 border-b border-white/10 pb-1 mb-8 hide-scrollbar">
                    {['overview', 'results', 'fixtures', 'stats', 'groups', 'playoffs', 'rules'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setTab(tab)}
                            className={`whitespace-nowrap px-6 py-3 font-semibold rounded-t-lg transition-colors ${currentTab === tab ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' ')}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="py-20 text-center text-gray-500">Loading competition data...</div>
                ) : (
                    <div className="space-y-8 animate-fade-in">

                        {/* OVERVIEW TAB */}
                        {currentTab === 'overview' && (
                            <div className="space-y-12">
                                <section>
                                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                                        <span className="w-2 h-8 bg-indigo-500 rounded"></span> Recent Results
                                    </h2>
                                    <div className="grid gap-4">
                                        {results.slice(0, 3).map(f => <MatchCard key={f.id} match={f} />)}
                                        {results.length === 0 && <p className="text-gray-500 italic">No matches played yet.</p>}
                                    </div>
                                    <button onClick={() => setTab('results')} className="mt-4 text-indigo-400 text-sm font-semibold hover:underline">View All Results &rarr;</button>
                                </section>

                                <section>
                                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                                        <span className="w-2 h-8 bg-green-500 rounded"></span> Upcoming Fixtures
                                    </h2>
                                    <div className="grid gap-4">
                                        {upcoming.slice(0, 3).map(f => <MatchCard key={f.id} match={f} />)}
                                        {upcoming.length === 0 && <p className="text-gray-500 italic">No upcoming matches scheduled.</p>}
                                    </div>
                                    <button onClick={() => setTab('fixtures')} className="mt-4 text-green-400 text-sm font-semibold hover:underline">View All Fixtures &rarr;</button>
                                </section>

                                <section>
                                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                                        <span className="w-2 h-8 bg-amber-500 rounded"></span> Tournament Leaders
                                    </h2>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div className="bg-[#1e293b] p-5 rounded-lg border border-white/5">
                                            <h3 className="text-lg font-bold mb-4 text-amber-500">Top Scorer</h3>
                                            {topScorers[0] ? (
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <div className="font-bold text-lg">{topScorers[0].player?.name}</div>
                                                        <div className="text-sm text-gray-400">{topScorers[0].player?.team?.name}</div>
                                                    </div>
                                                    <div className="text-3xl font-black">{topScorers[0].goals} <span className="text-sm font-normal text-gray-500">G</span></div>
                                                </div>
                                            ) : <p className="text-gray-500 text-sm">No data yet</p>}
                                        </div>
                                        <div className="bg-[#1e293b] p-5 rounded-lg border border-white/5">
                                            <h3 className="text-lg font-bold mb-4 text-blue-400">Top Assists</h3>
                                            {topAssists[0] ? (
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <div className="font-bold text-lg">{topAssists[0].player?.name}</div>
                                                        <div className="text-sm text-gray-400">{topAssists[0].player?.team?.name}</div>
                                                    </div>
                                                    <div className="text-3xl font-black">{topAssists[0].assists} <span className="text-sm font-normal text-gray-500">A</span></div>
                                                </div>
                                            ) : <p className="text-gray-500 text-sm">No data yet</p>}
                                        </div>
                                        <div className="bg-[#1e293b] p-5 rounded-lg border border-white/5">
                                            <h3 className="text-lg font-bold mb-4 text-emerald-400">Most Clean Sheets</h3>
                                            {topCleanSheets[0] ? (
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <div className="font-bold text-lg">{topCleanSheets[0].player?.name}</div>
                                                        <div className="text-sm text-gray-400">{topCleanSheets[0].player?.team?.name}</div>
                                                    </div>
                                                    <div className="text-3xl font-black">{topCleanSheets[0].clean_sheets} <span className="text-sm font-normal text-gray-500">CS</span></div>
                                                </div>
                                            ) : <p className="text-gray-500 text-sm">No data yet</p>}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {/* RESULTS TAB */}
                        {currentTab === 'results' && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold">Match Results</h2>
                                <div className="grid gap-4">
                                    {results.map(f => <MatchCard key={f.id} match={f} />)}
                                    {results.length === 0 && <div className="p-10 text-center bg-[#1e293b] rounded-lg border border-white/5">No matches have ended yet.</div>}
                                </div>
                            </div>
                        )}

                        {/* FIXTURES TAB */}
                        {currentTab === 'fixtures' && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold">Upcoming Matches</h2>
                                <div className="grid gap-4">
                                    {upcoming.map(f => <MatchCard key={f.id} match={f} />)}
                                    {upcoming.length === 0 && <div className="p-10 text-center bg-[#1e293b] rounded-lg border border-white/5">No upcoming matches scheduled.</div>}
                                </div>
                            </div>
                        )}

                        {/* STATS TAB */}
                        {currentTab === 'stats' && (
                            <div className="space-y-12">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                                    {/* Top Scorers Table */}
                                    <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
                                        <div className="bg-indigo-900/50 p-4 border-b border-white/10">
                                            <h3 className="font-bold text-lg">Top Scorers</h3>
                                        </div>
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-black/20 text-gray-400">
                                                <tr><th className="p-3">#</th><th className="p-3">Player</th><th className="p-3 text-right">Goals</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {topScorers.map((s, i) => (
                                                    <tr key={i} className="hover:bg-white/5">
                                                        <td className="p-3">{i+1}</td>
                                                        <td className="p-3">
                                                            <div className="font-semibold">{s.player?.name}</div>
                                                            <div className="text-xs text-gray-500">{s.player?.team?.name}</div>
                                                        </td>
                                                        <td className="p-3 text-right font-bold text-indigo-400">{s.goals}</td>
                                                    </tr>
                                                ))}
                                                {topScorers.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">No data available</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Top Assists Table */}
                                    <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
                                        <div className="bg-blue-900/50 p-4 border-b border-white/10">
                                            <h3 className="font-bold text-lg">Top Assists</h3>
                                        </div>
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-black/20 text-gray-400">
                                                <tr><th className="p-3">#</th><th className="p-3">Player</th><th className="p-3 text-right">Assists</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {topAssists.map((s, i) => (
                                                    <tr key={i} className="hover:bg-white/5">
                                                        <td className="p-3">{i+1}</td>
                                                        <td className="p-3">
                                                            <div className="font-semibold">{s.player?.name}</div>
                                                            <div className="text-xs text-gray-500">{s.player?.team?.name}</div>
                                                        </td>
                                                        <td className="p-3 text-right font-bold text-blue-400">{s.assists}</td>
                                                    </tr>
                                                ))}
                                                {topAssists.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">No data available</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Clean Sheets */}
                                    <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
                                        <div className="bg-emerald-900/50 p-4 border-b border-white/10">
                                            <h3 className="font-bold text-lg">Clean Sheets (GK)</h3>
                                        </div>
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-black/20 text-gray-400">
                                                <tr><th className="p-3">#</th><th className="p-3">Player</th><th className="p-3 text-right">CS</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {topCleanSheets.map((s, i) => (
                                                    <tr key={i} className="hover:bg-white/5">
                                                        <td className="p-3">{i+1}</td>
                                                        <td className="p-3">
                                                            <div className="font-semibold">{s.player?.name}</div>
                                                            <div className="text-xs text-gray-500">{s.player?.team?.name}</div>
                                                        </td>
                                                        <td className="p-3 text-right font-bold text-emerald-400">{s.clean_sheets}</td>
                                                    </tr>
                                                ))}
                                                {topCleanSheets.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">No data available</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Team XG */}
                                    <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
                                        <div className="bg-purple-900/50 p-4 border-b border-white/10">
                                            <h3 className="font-bold text-lg">Team Expected Goals (XG)</h3>
                                        </div>
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-black/20 text-gray-400">
                                                <tr><th className="p-3">#</th><th className="p-3">Team</th><th className="p-3 text-right">Total XG</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {teamXg.map((t, i) => (
                                                    <tr key={i} className="hover:bg-white/5">
                                                        <td className="p-3">{i+1}</td>
                                                        <td className="p-3 font-semibold">{t.team?.name}</td>
                                                        <td className="p-3 text-right font-bold text-purple-400">{t.xg.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                                {teamXg.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">No data available</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Cards */}
                                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
                                         {/* Yellow */}
                                        <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
                                            <div className="bg-yellow-900/30 p-4 border-b border-white/10">
                                                <h3 className="font-bold text-lg text-yellow-500">Yellow Cards</h3>
                                            </div>
                                            <table className="w-full text-left text-sm">
                                                <tbody className="divide-y divide-white/5">
                                                    {topYellow.map((s, i) => (
                                                        <tr key={i} className="hover:bg-white/5">
                                                            <td className="p-3">{i+1}</td>
                                                            <td className="p-3">{s.player?.name} <span className="text-gray-500 text-xs">({s.player?.team?.short_name})</span></td>
                                                            <td className="p-3 text-right text-yellow-500 font-bold">{s.cards}</td>
                                                        </tr>
                                                    ))}
                                                     {topYellow.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">No data available</td></tr>}
                                                </tbody>
                                            </table>
                                        </div>
                                         {/* Red */}
                                         <div className="bg-[#1e293b] rounded-lg border border-white/10 overflow-hidden">
                                            <div className="bg-red-900/30 p-4 border-b border-white/10">
                                                <h3 className="font-bold text-lg text-red-500">Red Cards</h3>
                                            </div>
                                            <table className="w-full text-left text-sm">
                                                <tbody className="divide-y divide-white/5">
                                                    {topRed.map((s, i) => (
                                                        <tr key={i} className="hover:bg-white/5">
                                                            <td className="p-3">{i+1}</td>
                                                            <td className="p-3">{s.player?.name} <span className="text-gray-500 text-xs">({s.player?.team?.short_name})</span></td>
                                                            <td className="p-3 text-right text-red-500 font-bold">{s.cards}</td>
                                                        </tr>
                                                    ))}
                                                     {topRed.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">No data available</td></tr>}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        )}

                        {/* GROUPS TAB */}
                        {currentTab === 'groups' && (
                             <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                                 {sortedGroupNames.map(groupName => (
                                     <div key={groupName} className="bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 shadow-xl">
                                         <div className="bg-gradient-to-r from-indigo-900 to-slate-800 p-4 border-b border-white/10">
                                             <h2 className="font-bold text-xl">{groupName}</h2>
                                         </div>
                                         <div className="overflow-x-auto">
                                            <table className="w-full text-sm text-left">
                                                <thead className="text-xs text-gray-400 uppercase bg-black/20">
                                                    <tr>
                                                        <th className="px-4 py-3">Team</th>
                                                        <th className="px-2 py-3 text-center" title="Played">P</th>
                                                        <th className="px-2 py-3 text-center" title="Won">W</th>
                                                        <th className="px-2 py-3 text-center" title="Drawn">D</th>
                                                        <th className="px-2 py-3 text-center" title="Lost">L</th>
                                                        <th className="px-2 py-3 text-center" title="Goal Difference">GD</th>
                                                        <th className="px-4 py-3 text-right font-bold text-indigo-300">Pts</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {groupStats[groupName] ? groupStats[groupName].map((t, index) => (
                                                        <tr key={t.id} className={`hover:bg-white/5 ${index < 2 ? 'border-l-4 border-indigo-500' : ''}`}>
                                                            <td className="px-4 py-3 font-semibold">{index+1}. {t.name}</td>
                                                            <td className="px-2 py-3 text-center">{t.played}</td>
                                                            <td className="px-2 py-3 text-center">{t.won}</td>
                                                            <td className="px-2 py-3 text-center">{t.drawn}</td>
                                                            <td className="px-2 py-3 text-center">{t.lost}</td>
                                                            <td className="px-2 py-3 text-center">{t.gd > 0 ? `+${t.gd}` : t.gd}</td>
                                                            <td className="px-4 py-3 text-right font-bold text-indigo-400 text-lg">{t.points}</td>
                                                        </tr>
                                                    )) : (
                                                        <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">No teams assigned to this group yet.</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                         </div>
                                     </div>
                                 ))}
                                 {sortedGroupNames.length === 0 && (
                                     <div className="col-span-full p-20 text-center bg-[#1e293b] rounded-lg border border-white/5">
                                         No groups have been formed yet.
                                     </div>
                                 )}
                             </div>
                        )}

                        {/* PLAY-OFFS TAB */}
                        {currentTab === 'playoffs' && (
                            <div className="space-y-12">
                                <h2 className="text-2xl font-bold">Tournament Bracket / Play-offs</h2>

                                <div className="space-y-10">
                                    {playoffStages.map(stage => {
                                        const matches = playoffMatches.filter(f => f.stage === stage)
                                        if (matches.length === 0) return null
                                        return (
                                            <div key={stage}>
                                                <h3 className="text-xl font-semibold mb-4 text-indigo-300 uppercase tracking-widest">{(stage as string).replace(/_/g, ' ')}</h3>
                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                    {matches.map(f => <MatchCard key={f.id} match={f} />)}
                                                </div>
                                            </div>
                                        )
                                    })}
                                    {playoffMatches.length === 0 && <div className="p-20 text-center bg-[#1e293b] rounded-lg border border-white/5">No play-off matches have been scheduled yet.</div>}
                                </div>
                            </div>
                        )}

                        {/* RULES TAB */}
                        {currentTab === 'rules' && (
                             <div className="bg-[#1e293b] rounded-2xl shadow-xl border border-white/10 p-8 md:p-12 max-w-4xl mx-auto">
                                 <h2 className="text-3xl font-bold mb-8 border-b border-white/10 pb-4">Tournament Rules & Code of Conduct</h2>

                                 {settings?.rules_pdf_url && (
                                     <div className="mb-10 bg-indigo-900/30 border border-indigo-500/30 p-6 rounded-xl flex items-center justify-between">
                                         <div>
                                            <h3 className="font-bold text-lg text-indigo-300 mb-1">Official Rulebook (PDF)</h3>
                                            <p className="text-sm text-gray-400">Download or view the official tournament rules document.</p>
                                         </div>
                                         <a
                                            href={settings.rules_pdf_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-colors"
                                         >
                                             View Rules PDF
                                         </a>
                                     </div>
                                 )}

                                 <div className="prose prose-invert prose-indigo max-w-none">
                                    {settings?.rules_text ? (
                                        <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-300">
                                            {settings.rules_text}
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 italic">No rules have been uploaded yet.</p>
                                    )}
                                 </div>
                             </div>
                        )}

                    </div>
                )}

            </div>
        </div>
    )
}

export default function CompetitionsPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">Loading...</div>}>
            <CompetitionsContent />
        </Suspense>
    )
}
