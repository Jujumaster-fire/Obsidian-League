'use client'

import Navigation from '@/components/Navigation'
import { createClient } from '@/utils/supabase/client'
import { useEffect, useState, use } from 'react'
import Link from 'next/link'

export default function MatchCenter({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const supabase = createClient()
  const [loading, setLoading] = useState(true)

  const [match, setMatch] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState('Overview')

  // Local timer state to keep it ticking responsively
  const [localMinute, setLocalMinute] = useState<number>(0)


  useEffect(() => {
    fetchMatchData()

    // Subscribe to live updates
    const channel = supabase.channel('match_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fixtures', filter: `id=eq.${resolvedParams.id}` }, (payload) => {

        if (payload.new) {
          setMatch(payload.new as any)
          setLocalMinute((payload.new as any).current_minute || 0)
        }

      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events', filter: `fixture_id=eq.${resolvedParams.id}` }, (payload) => {
        setEvents(prev => [...prev, payload.new].sort((a,b) => b.minute - a.minute))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [resolvedParams.id, supabase])

  const fetchMatchData = async () => {
    setLoading(true)
    const { data: fixture } = await supabase
      .from('fixtures')
      .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
      .eq('id', resolvedParams.id)
      .single()

    if (fixture) {
      setMatch(fixture)
      const { data: eventData } = await supabase
        .from('match_events')
        .select('*')
        .eq('fixture_id', fixture.id)
        .order('minute', { ascending: false })
      if(eventData) setEvents(eventData)
    }
    setLoading(false)
  }


  // Local ticking timer for the public UI
  useEffect(() => {
    let interval: NodeJS.Timeout
    const isLive = match?.status === 'in_progress' || match?.status === 'extra_time'
    if (isLive) {
      interval = setInterval(() => {
        setLocalMinute(m => m + 1)
      }, 60000)
    }
    return () => clearInterval(interval)
  }, [match?.status])

  if (loading) return <div className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center">Loading Match Data...</div>
  if (!match) return <div className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center">Match not found.</div>



  const isLive = match.status === 'in_progress' || match.status === 'extra_time'

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      {/* Match Header */}
      <div className="pt-16 bg-[#1e293b] border-b border-white/10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -ml-32 -mb-32"></div>

        <div className="max-w-7xl mx-auto px-4 py-10 sm:py-16 relative z-10">
            {/* Status / Date */}
            <div className="text-center mb-8">
                {isLive ? (
                    <span className="inline-flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-1 rounded-full font-bold uppercase tracking-wider text-sm border border-red-500/30">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                        LIVE &bull; {match.status === 'full_time' ? 'Full Time' : match.status === 'half_time' ? 'Half Time' : `${localMinute}'`}
                    </span>
                ) : (
                    <span className="inline-block bg-white/10 text-gray-300 px-4 py-1 rounded-full font-medium text-sm border border-white/5">
                        {match.status === 'full_time' ? 'Full Time' : match.status === 'half_time' ? 'Half Time' : match.status === 'cancelled' ? 'Cancelled' : new Date(match.match_date).toLocaleString([], {weekday:'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
                    </span>
                )}
            </div>

            {/* Scoreboard */}
            <div className="flex items-center justify-between md:justify-center md:gap-24 max-w-4xl mx-auto">
                <Link href={`/team/${match.home_team.id}`} className="flex flex-col items-center gap-4 flex-1 group">
                    <div className={`w-20 h-20 sm:w-32 sm:h-32 rounded-full flex items-center justify-center font-black text-2xl sm:text-5xl text-white/50 border border-white/10 group-hover:scale-105 transition-transform shadow-xl`} style={{ backgroundColor: match.home_team.attire_color === 'Yet to be decided' ? '#334155' : match.home_team.attire_color }}>
                        {match.home_team.short_name}
                    </div>
                    <span className="font-bold text-lg sm:text-2xl text-center group-hover:text-indigo-300 transition-colors">{match.home_team.name}</span>
                </Link>

                <div className="flex flex-col items-center shrink-0">
                    <div className="text-4xl sm:text-7xl font-black tabular-nums tracking-tighter bg-gradient-to-b from-white to-gray-400 text-transparent bg-clip-text drop-shadow-lg">
                        {match.home_score} - {match.away_score}
                    </div>
                </div>

                <Link href={`/team/${match.away_team.id}`} className="flex flex-col items-center gap-4 flex-1 group">
                    <div className={`w-20 h-20 sm:w-32 sm:h-32 rounded-full flex items-center justify-center font-black text-2xl sm:text-5xl text-white/50 border border-white/10 group-hover:scale-105 transition-transform shadow-xl`} style={{ backgroundColor: match.away_team.attire_color === 'Yet to be decided' ? '#334155' : match.away_team.attire_color }}>
                        {match.away_team.short_name}
                    </div>
                    <span className="font-bold text-lg sm:text-2xl text-center group-hover:text-indigo-300 transition-colors">{match.away_team.name}</span>
                </Link>
            </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 mt-8 flex overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {['Overview', 'Stats', 'Timeline', 'Line-up', 'Table'].map(tab => (
                <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-6 py-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${activeTab === tab ? 'border-indigo-500 text-white bg-white/5' : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'}`}
                >
                    {tab}
                </button>
            ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* OVERVIEW TAB */}
        {activeTab === 'Overview' && (
            <div className="space-y-6">
                <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5 text-center text-gray-400">
                    <p>Venue: <span className="text-white font-medium">{match.venue || 'TBD'}</span></p>
                    <p className="mt-2">Competition: <span className="text-white font-medium">Obsidian Elite {match.home_team.category} {match.home_team.team_type}</span></p>
                </div>

                {/* Mini Timeline Snapshot */}
                <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5">
                    <h3 className="font-bold text-lg mb-4 text-center">Match Events</h3>
                    {events.length === 0 ? (
                        <p className="text-gray-500 text-center text-sm">No events logged yet.</p>
                    ) : (
                        <div className="space-y-3 max-h-60 overflow-y-auto">
                            {events.slice(0, 5).map(e => (
                                <div key={e.id} className="flex items-center justify-between text-sm py-2 border-b border-white/5 last:border-0">
                                    <span className="text-gray-400 w-12">{e.minute}'</span>
                                    <span className="flex-1 font-medium text-center text-white">{e.event_type.replace('_', ' ')}</span>
                                    <span className="text-gray-400 flex-1 text-right truncate">{e.player_name || 'N/A'}</span>
                                </div>
                            ))}
                            {events.length > 5 && <button onClick={()=>setActiveTab('Timeline')} className="w-full text-indigo-400 text-sm mt-2 hover:text-indigo-300">View All Events →</button>}
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* STATS TAB */}
        {activeTab === 'Stats' && (
            <div className="bg-[#1e293b] rounded-xl p-6 sm:p-10 border border-white/5">
                <h3 className="font-bold text-xl mb-8 text-center">Match Statistics</h3>
                {!match.stats ? (
                    <p className="text-gray-500 text-center">No data available yet.</p>
                ) : (
                    <div className="space-y-8">
                        {['passes', 'shots', 'fouls', 'corners'].map(stat => {
                            const hVal = match.stats.home?.[stat] || 0;
                            const aVal = match.stats.away?.[stat] || 0;
                            const total = hVal + aVal || 1; // prevent div by zero
                            const hPct = (hVal / total) * 100;
                            const aPct = (aVal / total) * 100;

                            return (
                                <div key={stat}>
                                    <div className="flex justify-between text-sm font-bold mb-2">
                                        <span className={hVal > aVal ? 'text-white' : 'text-gray-500'}>{hVal}</span>
                                        <span className="uppercase tracking-wider text-gray-400">{stat}</span>
                                        <span className={aVal > hVal ? 'text-white' : 'text-gray-500'}>{aVal}</span>
                                    </div>
                                    <div className="flex h-2 bg-gray-800 rounded-full overflow-hidden">
                                        <div style={{ width: `${hPct}%` }} className={`transition-all duration-500 ${hVal > aVal ? 'bg-indigo-500' : 'bg-gray-600'}`}></div>
                                        <div style={{ width: `${aPct}%` }} className={`transition-all duration-500 ${aVal >= hVal ? 'bg-blue-500' : 'bg-gray-600'}`}></div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )}

        {/* TIMELINE TAB */}
        {activeTab === 'Timeline' && (
            <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5">
                <h3 className="font-bold text-xl mb-8 text-center">Match Timeline</h3>
                {events.length === 0 ? (
                    <p className="text-gray-500 text-center">No data available yet.</p>
                ) : (
                    <div className="relative border-l border-white/10 ml-6 space-y-6">
                        {events.map(e => {
                            const isHome = e.team_id === match.home_team.id
                            return (
                                <div key={e.id} className="relative pl-6">
                                    <div className="absolute w-3 h-3 bg-indigo-500 rounded-full -left-[6.5px] top-1.5 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
                                    <div className="flex items-start gap-4">
                                        <span className="font-bold text-indigo-400 text-lg w-10 shrink-0">{e.minute}'</span>
                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3 flex-1">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="font-bold capitalize">{e.event_type.replace('_', ' ')}</span>
                                                {e.team_id && <span className="text-xs font-semibold px-2 py-1 bg-black/30 rounded text-gray-300">{isHome ? match.home_team.short_name : match.away_team.short_name}</span>}
                                            </div>
                                            {e.player_name && <p className="text-sm font-medium text-white/90">{e.player_name}</p>}
                                            {e.details && <p className="text-xs text-gray-400 mt-1">{e.details}</p>}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )}

        {/* LINE-UP TAB */}
        {activeTab === 'Line-up' && (
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5 text-center">
                    <h3 className="font-bold text-lg mb-6 border-b border-white/10 pb-2">{match.home_team.short_name} Lineup</h3>
                    {match.home_team.roster ? (
                        <ul className="space-y-3">
                            {match.home_team.roster.split(',').map((p:string,i:number) => <li key={i} className="text-sm bg-white/5 py-2 rounded">{p.trim()}</li>)}
                        </ul>
                    ) : <p className="text-gray-500 text-sm">No data available yet.</p>}
                </div>
                <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5 text-center">
                    <h3 className="font-bold text-lg mb-6 border-b border-white/10 pb-2">{match.away_team.short_name} Lineup</h3>
                    {match.away_team.roster ? (
                        <ul className="space-y-3">
                            {match.away_team.roster.split(',').map((p:string,i:number) => <li key={i} className="text-sm bg-white/5 py-2 rounded">{p.trim()}</li>)}
                        </ul>
                    ) : <p className="text-gray-500 text-sm">No data available yet.</p>}
                </div>
            </div>
        )}

        {/* TABLE TAB */}
        {activeTab === 'Table' && (
            <div className="bg-[#1e293b] rounded-xl p-6 border border-white/5 text-center flex flex-col items-center justify-center py-20">
                <svg className="w-16 h-16 text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                <h3 className="font-bold text-xl mb-2 text-gray-300">Competition Standings</h3>
                <p className="text-gray-500">Live table data is not available for this competition yet.</p>
                <Link href="/competitions" className="mt-6 text-indigo-400 hover:text-indigo-300 font-medium">View Group Stage Settings →</Link>
            </div>
        )}

      </div>
    </div>
  )
}
