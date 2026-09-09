'use client'

import { createClient } from '@/utils/supabase/client'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LiveMatchManager({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [fixture, setFixture] = useState<any>(null)

  // Local state for edits
  const [minute, setMinute] = useState<number>(0)
  const [status, setStatus] = useState<string>('scheduled')
  const [homeScore, setHomeScore] = useState<number>(0)
  const [awayScore, setAwayScore] = useState<number>(0)
  const [stats, setStats] = useState<any>({
    home: { passes: 0, shots: 0, fouls: 0, corners: 0 },
    away: { passes: 0, shots: 0, fouls: 0, corners: 0 }
  })

  const [newEvent, setNewEvent] = useState({ event_type: 'goal', team_id: '', player_name: '', minute: '', details: '' })

  const fetchFixtureData = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fixtures')
      .select(`
        *,
        home_team:home_team_id (id, name, short_name, attire_color),
        away_team:away_team_id (id, name, short_name, attire_color)
      `)
      .eq('id', resolvedParams.id)
      .single()

    if (error) {
      console.error(error)
      alert("Error loading fixture")
    } else if (data) {
      setFixture(data)
      setMinute(data.current_minute || 0)
      setStatus(data.status || 'scheduled')
      setHomeScore(data.home_score || 0)
      setAwayScore(data.away_score || 0)

      const defaultStats = {
        home: { passes: 0, shots: 0, fouls: 0, corners: 0 },
        away: { passes: 0, shots: 0, fouls: 0, corners: 0 }
      }
      setStats(data.stats ? { ...defaultStats, ...data.stats } : defaultStats)
    }
    setLoading(false)
  }

  const checkAuthAndFetchData = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      router.push('/login')
      return
    }

    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).single()
    if (roleData?.role !== 'admin') {
      router.push('/')
      return
    }

    setIsAdmin(true)
    fetchFixtureData()
  }

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (status === 'in_progress') {
      interval = setInterval(() => {
        setMinute(m => m + 1)
      }, 60000) // 1 minute in real time
    }
    return () => clearInterval(interval)
  }, [status])

  useEffect(() => {
    const updateBackendMinute = async () => {
      if (!resolvedParams.id || !isAdmin) return
      const { error } = await supabase
        .from('fixtures')
        .update({ current_minute: minute })
        .eq('id', resolvedParams.id)
      if (error) console.error("Error auto-saving minute:", error)
    }

    if (status === 'in_progress') {
      updateBackendMinute()
    }
  }, [minute, status, resolvedParams.id, isAdmin, supabase])

  useEffect(() => {
    checkAuthAndFetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleUpdateMatchState = async () => {
    const { error } = await supabase
      .from('fixtures')
      .update({
        status,
        current_minute: minute,
        home_score: homeScore,
        away_score: awayScore,
        stats,
        updated_at: new Date().toISOString()
      })
      .eq('id', resolvedParams.id)

    if (error) {
      alert(error.message)
    } else {
      alert("Match updated successfully!")
      fetchFixtureData()
    }
  }

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('match_events').insert([{
      ...newEvent,
      fixture_id: resolvedParams.id,
      minute: parseInt(newEvent.minute)
    }])
    if (error) alert('Error creating event: ' + error.message)
    else {
      alert('Event logged!')
      setNewEvent({ ...newEvent, player_name: '', minute: minute.toString(), details: '' })
    }
  }

  useEffect(() => {
    if (!newEvent.minute && status === 'in_progress') {
        setNewEvent(prev => ({ ...prev, minute: minute.toString() }))
    }
  }, [minute, status, newEvent.minute])


  const incrementStat = (team: 'home' | 'away', stat: string) => {
    setStats((prev: Record<string, Record<string, number>>) => ({
      ...prev,
      [team]: {
        ...prev[team],
        [stat]: (prev[team][stat] || 0) + 1
      }
    }))
  }

  if (loading) return <div className="p-10 text-center">Loading Live Match Manager...</div>
  if (!isAdmin) return null
  if (!fixture) return <div className="p-10 text-center">Match not found.</div>

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 pb-20">
      <div className="bg-white shadow-sm border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-500 hover:text-indigo-600 transition-colors">
                ← Back to Dashboard
            </Link>
            <h1 className="text-xl font-bold">Live Match Manager</h1>
        </div>
        <button
          onClick={handleUpdateMatchState}
          className="bg-green-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-green-700 shadow-md transform hover:scale-105 transition-all"
        >
          Save All Changes
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* Match Header & Score */}
        <div className="bg-white rounded-xl shadow p-6 border border-gray-200">
            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex-1 text-center md:text-right">
                    <h2 className="text-2xl font-bold">{fixture.home_team.name}</h2>
                    <p className="text-gray-500">Home</p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                    <input type="number" className="w-16 h-16 text-center text-3xl font-black bg-gray-100 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-0" value={homeScore} onChange={e => setHomeScore(parseInt(e.target.value) || 0)} />
                    <span className="text-2xl text-gray-400 font-bold">-</span>
                    <input type="number" className="w-16 h-16 text-center text-3xl font-black bg-gray-100 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-0" value={awayScore} onChange={e => setAwayScore(parseInt(e.target.value) || 0)} />
                </div>

                <div className="flex-1 text-center md:text-left">
                    <h2 className="text-2xl font-bold">{fixture.away_team.name}</h2>
                    <p className="text-gray-500">Away</p>
                </div>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Match Controls */}
            <div className="bg-white rounded-xl shadow p-6 border border-gray-200 space-y-6">
                <h3 className="text-lg font-bold border-b pb-2">Match Controls</h3>

                <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Match Status</label>
                    <div className="flex flex-wrap gap-2">
                        {['scheduled', 'in_progress', 'half_time', 'full_time', 'cancelled'].map(s => (
                            <button
                                key={s}
                                onClick={() => setStatus(s)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium border capitalize ${status === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                            >
                                {s.replace('_', ' ')}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700 flex justify-between">
                        <span>Current Minute</span>
                        <span className="text-gray-500 font-normal">Use arrows to fine-tune</span>
                    </label>
                    <div className="flex items-center gap-4">
                        <input type="range" min="0" max="120" value={minute} onChange={e => setMinute(parseInt(e.target.value))} className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                        <input type="number" value={minute} onChange={e => setMinute(parseInt(e.target.value))} className="w-20 border rounded p-2 text-center font-bold text-lg" />
                    </div>
                </div>
            </div>

            {/* Scout Tracker */}
            <div className="bg-white rounded-xl shadow p-6 border border-gray-200 space-y-6">
                <h3 className="text-lg font-bold border-b pb-2 flex items-center justify-between">
                    <span>Live Scout Tracker</span>
                    <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">Auto-saves to local state. Click Save All above.</span>
                </h3>

                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    {/* Home Scout Buttons */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-center text-indigo-600">{fixture.home_team.short_name} Stats</h4>
                        {['passes', 'shots', 'fouls', 'corners'].map(stat => (
                            <button
                                key={`home-${stat}`}
                                onClick={() => incrementStat('home', stat)}
                                className="w-full flex items-center justify-between bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 rounded p-3 transition-colors group"
                            >
                                <span className="capitalize font-medium text-gray-700 group-hover:text-indigo-700">+1 {stat}</span>
                                <span className="bg-white border rounded px-2 py-1 text-sm font-bold shadow-sm">{stats.home[stat]}</span>
                            </button>
                        ))}
                    </div>

                    {/* Away Scout Buttons */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-center text-blue-600">{fixture.away_team.short_name} Stats</h4>
                        {['passes', 'shots', 'fouls', 'corners'].map(stat => (
                            <button
                                key={`away-${stat}`}
                                onClick={() => incrementStat('away', stat)}
                                className="w-full flex items-center justify-between bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded p-3 transition-colors group"
                            >
                                <span className="bg-white border rounded px-2 py-1 text-sm font-bold shadow-sm">{stats.away[stat]}</span>
                                <span className="capitalize font-medium text-gray-700 group-hover:text-blue-700">+1 {stat}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>

        {/* Log Match Event Form */}
        <div className="bg-white rounded-xl shadow p-6 border border-gray-200 md:col-span-2 mt-8">
            <h3 className="text-lg font-bold border-b pb-2 mb-4">Log Match Event</h3>
            <form onSubmit={handleCreateEvent} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Event Type</label>
                        <select required className="w-full border rounded p-2" value={newEvent.event_type} onChange={e => setNewEvent({...newEvent, event_type: e.target.value})}>
                            <option value="goal">Goal</option>
                            <option value="red_card">Red Card</option>
                            <option value="yellow_card">Yellow Card</option>
                            <option value="corner">Corner</option>
                            <option value="free_kick">Free Kick</option>
                            <option value="substitution">Substitution</option>
                            <option value="half_time_whistle">Half Time</option>
                            <option value="full_time_whistle">Full Time</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Minute</label>
                        <input type="number" required min="1" max="120" className="w-full border rounded p-2" value={newEvent.minute} onChange={e => setNewEvent({...newEvent, minute: e.target.value})} />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Team (if applicable)</label>
                        <select className="w-full border rounded p-2" value={newEvent.team_id} onChange={e => setNewEvent({...newEvent, team_id: e.target.value})}>
                            <option value="">None / Neutral</option>
                            <option value={fixture.home_team.id}>{fixture.home_team.name} (Home)</option>
                            <option value={fixture.away_team.id}>{fixture.away_team.name} (Away)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Player Name</label>
                        <input type="text" className="w-full border rounded p-2" value={newEvent.player_name} onChange={e => setNewEvent({...newEvent, player_name: e.target.value})} />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Details / Notes</label>
                    <input type="text" placeholder="e.g. Player A in, Player B out" className="w-full border rounded p-2" value={newEvent.details} onChange={e => setNewEvent({...newEvent, details: e.target.value})} />
                </div>
                <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 w-full md:w-auto">Log Event</button>
            </form>
        </div>

      </div>
    </div>
  )
}
