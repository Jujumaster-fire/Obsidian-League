'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

export default function AdminDashboard() {
  const [fixtures, setFixtures] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Form States
  const [newFixture, setNewFixture] = useState({ home_team_id: '', away_team_id: '', match_date: '', venue: '' })
  const [newEvent, setNewEvent] = useState({ fixture_id: '', event_type: 'goal', team_id: '', player_name: '', minute: '', details: '' })

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    const [teamsRes, fixturesRes] = await Promise.all([
      supabase.from('teams').select('*'),
      supabase.from('fixtures').select('*, home_team:teams!home_team_id(name), away_team:teams!away_team_id(name)')
    ])

    if (teamsRes.data) setTeams(teamsRes.data)
    if (fixturesRes.data) setFixtures(fixturesRes.data)
    setLoading(false)
  }

  const handleCreateFixture = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('fixtures').insert([newFixture])
    if (error) alert('Error creating fixture: ' + error.message)
    else {
      alert('Fixture created!')
      setNewFixture({ home_team_id: '', away_team_id: '', match_date: '', venue: '' })
      fetchData()
    }
  }

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('match_events').insert([{
      ...newEvent,
      minute: parseInt(newEvent.minute)
    }])
    if (error) alert('Error creating event: ' + error.message)
    else {
      alert('Event logged!')
      setNewEvent({ ...newEvent, player_name: '', minute: '', details: '' }) // keep fixture/team selected
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="p-8">Loading admin data...</div>

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Obsidian Elite Admin</h1>
        <button onClick={handleLogout} className="text-sm text-gray-600 hover:text-gray-900">Sign Out</button>
      </nav>

      <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-8">

        {/* Create Fixture Form */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold mb-4">Create New Fixture</h2>
          <form onSubmit={handleCreateFixture} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Home Team</label>
              <select required className="w-full border rounded p-2" value={newFixture.home_team_id} onChange={e => setNewFixture({...newFixture, home_team_id: e.target.value})}>
                <option value="">Select Team</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Away Team</label>
              <select required className="w-full border rounded p-2" value={newFixture.away_team_id} onChange={e => setNewFixture({...newFixture, away_team_id: e.target.value})}>
                <option value="">Select Team</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date & Time</label>
              <input type="datetime-local" required className="w-full border rounded p-2" value={newFixture.match_date} onChange={e => setNewFixture({...newFixture, match_date: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Venue</label>
              <input type="text" className="w-full border rounded p-2" value={newFixture.venue} onChange={e => setNewFixture({...newFixture, venue: e.target.value})} />
            </div>
            <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 w-full">Create Fixture</button>
          </form>
        </div>

        {/* Log Match Event Form */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold mb-4">Log Match Event</h2>
          <form onSubmit={handleCreateEvent} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Fixture</label>
              <select required className="w-full border rounded p-2" value={newEvent.fixture_id} onChange={e => setNewEvent({...newEvent, fixture_id: e.target.value})}>
                <option value="">Select Fixture</option>
                {fixtures.map(f => <option key={f.id} value={f.id}>{f.home_team.name} vs {f.away_team.name}</option>)}
              </select>
            </div>
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
            <div>
              <label className="block text-sm font-medium mb-1">Team (if applicable)</label>
              <select className="w-full border rounded p-2" value={newEvent.team_id} onChange={e => setNewEvent({...newEvent, team_id: e.target.value})}>
                <option value="">None / Neutral</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Player Name</label>
              <input type="text" className="w-full border rounded p-2" value={newEvent.player_name} onChange={e => setNewEvent({...newEvent, player_name: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Details / Notes</label>
              <input type="text" placeholder="e.g. Player A in, Player B out" className="w-full border rounded p-2" value={newEvent.details} onChange={e => setNewEvent({...newEvent, details: e.target.value})} />
            </div>
            <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 w-full">Log Event</button>
          </form>
        </div>

      </div>
    </div>
  )
}
