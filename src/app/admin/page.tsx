'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Custom Searchable Dropdown Component
function SearchableSelect({ options, value, onChange, placeholder }: { options: any[], value: string, onChange: (val: string) => void, placeholder: string }) {
    const [isOpen, setIsOpen] = useState(false)
    const [search, setSearch] = useState('')
    const wrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [wrapperRef])

    const filteredOptions = options.filter(opt => opt.name.toLowerCase().includes(search.toLowerCase()))
    const selectedOption = options.find(opt => opt.id === value)

    return (
        <div ref={wrapperRef} className="relative w-full">
            <div
                className="w-full border rounded p-2 bg-white cursor-pointer flex justify-between items-center"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={selectedOption ? "text-gray-900" : "text-gray-500"}>
                    {selectedOption ? selectedOption.name : placeholder}
                </span>
                <span className="text-gray-400 text-xs">▼</span>
            </div>

            {isOpen && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow-lg max-h-60 overflow-auto">
                    <div className="sticky top-0 bg-white p-2 border-b">
                        <input
                            type="text"
                            className="w-full border rounded p-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="Type to search..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                    {filteredOptions.length > 0 ? (
                        filteredOptions.map((opt) => (
                            <div
                                key={opt.id}
                                className="p-2 hover:bg-indigo-50 cursor-pointer text-sm"
                                onClick={() => {
                                    onChange(opt.id)
                                    setIsOpen(false)
                                    setSearch('')
                                }}
                            >
                                {opt.name}
                            </div>
                        ))
                    ) : (
                        <div className="p-2 text-gray-500 text-sm">No teams found</div>
                    )}
                </div>
            )}
        </div>
    )
}

export default function AdminDashboard() {
  const [fixtures, setFixtures] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Form States
  const [newFixture, setNewFixture] = useState({ home_team_id: '', away_team_id: '', match_date: '', venue: '' })
  const [newEvent, setNewEvent] = useState({ fixture_id: '', event_type: 'goal', team_id: '', player_name: '', minute: '', details: '' })
    const [tournamentSettings, setTournamentSettings] = useState({ format: 'league', table_arrangement: '', rules: '' })

  const handleUpdateTournamentSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    // Ideally this would save to the tournament_settings table
    const { error } = await supabase.from('tournament_settings').insert([tournamentSettings])
    if (error) alert(error.message)
    else {
      alert('Tournament settings updated!')
    }
  }
  const [newTeam, setNewTeam] = useState({ name: '', short_name: '', coach: '', attire_color: 'Yet to be decided', roster: '', medical_staff: '', tactical_coach: '', assistant_coach: '', kit_personnel: '', category: 'Male', team_type: 'Football' })

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    const [teamsRes, fixturesRes] = await Promise.all([
      supabase.from('teams').select('*').order('name'),
      supabase.from('fixtures').select('*, home_team:teams!home_team_id(name), away_team:teams!away_team_id(name)')
    ])

    if (teamsRes.data) setTeams(teamsRes.data)
    if (fixturesRes.data) setFixtures(fixturesRes.data)
    setLoading(false)
  }

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('teams').insert([newTeam])
    if (error) alert('Error registering team: ' + error.message)
    else {
      alert('Team registered successfully!')
      setNewTeam({ name: '', short_name: '', coach: '', attire_color: 'Yet to be decided', roster: '', medical_staff: '', tactical_coach: '', assistant_coach: '', kit_personnel: '', category: 'Male', team_type: 'Football' })
      fetchData() // Refresh lists
    }
  }

  const handleCreateFixture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFixture.home_team_id || !newFixture.away_team_id) {
        return alert('Please select both a Home and Away team.')
    }
    if (newFixture.home_team_id === newFixture.away_team_id) {
        return alert('Home and Away teams cannot be the same.')
    }
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
      setNewEvent({ ...newEvent, player_name: '', minute: '', details: '' })
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="p-8">Loading admin data...</div>

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-12">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">Obsidian Elite Admin</h1>
            <a href="/" className="text-sm text-indigo-600 hover:underline border-l pl-4 border-gray-300">&larr; Back to Public Site</a>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-600 hover:text-gray-900">Sign Out</button>
      </nav>

      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left Column: Team Management */}
        <div className="lg:col-span-1 space-y-8">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-semibold mb-4">Register New Team</h2>
                <form onSubmit={handleCreateTeam} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Team Name</label>
                        <input type="text" required className="w-full border rounded p-2" placeholder="e.g. Crimson Kings" value={newTeam.name} onChange={e => setNewTeam({...newTeam, name: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Short Name / Abbreviation</label>
                        <input type="text" required className="w-full border rounded p-2" placeholder="e.g. CK" maxLength={4} value={newTeam.short_name} onChange={e => setNewTeam({...newTeam, short_name: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Head Coach</label>
                        <input type="text" className="w-full border rounded p-2" placeholder="e.g. Marcus Vance" value={newTeam.coach} onChange={e => setNewTeam({...newTeam, coach: e.target.value})} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Category</label>
                            <select className="w-full border rounded p-2" value={newTeam.category} onChange={e => setNewTeam({...newTeam, category: e.target.value})}>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Type</label>
                            <select className="w-full border rounded p-2" value={newTeam.team_type} onChange={e => setNewTeam({...newTeam, team_type: e.target.value})}>
                                <option value="Football">Football</option>
                                <option value="Futsal">Futsal</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Attire Color</label>
                        <select className="w-full border rounded p-2" value={newTeam.attire_color} onChange={e => setNewTeam({...newTeam, attire_color: e.target.value})}>
                            <option value="Yet to be decided">Yet to be decided</option>
                            <option value="Red">Red</option>
                            <option value="Blue">Blue</option>
                            <option value="White">White</option>
                            <option value="Black">Black</option>
                            <option value="Green">Green</option>
                            <option value="Yellow">Yellow</option>
                            <option value="Custom">Custom / Other</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Assistant Coach</label>
                            <input type="text" className="w-full border rounded p-2" placeholder="e.g. Sarah Jenkins" value={newTeam.assistant_coach} onChange={e => setNewTeam({...newTeam, assistant_coach: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Tactical Coach</label>
                            <input type="text" className="w-full border rounded p-2" placeholder="e.g. David Lin" value={newTeam.tactical_coach} onChange={e => setNewTeam({...newTeam, tactical_coach: e.target.value})} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Medical Staff / Personnel</label>
                            <input type="text" className="w-full border rounded p-2" placeholder="e.g. Dr. Emily Chen" value={newTeam.medical_staff} onChange={e => setNewTeam({...newTeam, medical_staff: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Kit and Water Personnel</label>
                            <input type="text" className="w-full border rounded p-2" placeholder="e.g. Tom Baker" value={newTeam.kit_personnel} onChange={e => setNewTeam({...newTeam, kit_personnel: e.target.value})} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Players (Roster)</label>
                        <textarea className="w-full border rounded p-2 h-24" placeholder="Enter player names separated by commas..." value={newTeam.roster} onChange={e => setNewTeam({...newTeam, roster: e.target.value})} />
                        <p className="text-xs text-gray-500 mt-1">Example: John Doe, James Smith, Mike Johnson</p>
                    </div>
                    <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 w-full">Register Team</button>
                </form>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-semibold mb-4">Registered Teams ({teams.length})</h2>
                {teams.length === 0 ? (
                    <p className="text-gray-500 text-sm">No teams registered yet.</p>
                ) : (
                    <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                        {teams.map(t => (
                            <li key={t.id} className="py-3">
                                <div className="font-medium text-sm">{t.name} <span className="text-gray-400 font-normal">({t.short_name})</span></div>
                                <div className="text-xs text-gray-500 mt-1">Coach: {t.coach || 'N/A'} &bull; Color: {t.attire_color}</div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>

        {/* Right Column: Fixtures & Events */}
        <div className="lg:col-span-2 space-y-8">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-semibold mb-4">Create New Fixture</h2>
                <form onSubmit={handleCreateFixture} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                        <label className="block text-sm font-medium mb-1">Home Team</label>
                        <SearchableSelect
                            options={teams}
                            value={newFixture.home_team_id}
                            onChange={(val) => setNewFixture({...newFixture, home_team_id: val})}
                            placeholder="Search registered teams..."
                        />
                        </div>
                        <div>
                        <label className="block text-sm font-medium mb-1">Away Team</label>
                        <SearchableSelect
                            options={teams}
                            value={newFixture.away_team_id}
                            onChange={(val) => setNewFixture({...newFixture, away_team_id: val})}
                            placeholder="Search registered teams..."
                        />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Date & Time</label>
                            <input type="datetime-local" required className="w-full border rounded p-2" value={newFixture.match_date} onChange={e => setNewFixture({...newFixture, match_date: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Venue</label>
                            <input type="text" className="w-full border rounded p-2" value={newFixture.venue} onChange={e => setNewFixture({...newFixture, venue: e.target.value})} />
                        </div>
                    </div>
                    <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 w-full md:w-auto">Schedule Fixture</button>
                </form>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-semibold mb-4">Log Match Event</h2>
                <form onSubmit={handleCreateEvent} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Fixture</label>
                        <select required className="w-full border rounded p-2" value={newEvent.fixture_id} onChange={e => setNewEvent({...newEvent, fixture_id: e.target.value})}>
                            <option value="">Select Scheduled Fixture</option>
                            {fixtures.map(f => <option key={f.id} value={f.id}>{f.home_team?.name} vs {f.away_team?.name}</option>)}
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Details / Notes</label>
                        <input type="text" placeholder="e.g. Player A in, Player B out" className="w-full border rounded p-2" value={newEvent.details} onChange={e => setNewEvent({...newEvent, details: e.target.value})} />
                    </div>
                    <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 w-full md:w-auto">Log Event</button>
                </form>
            </div>



            <div className="bg-white p-6 rounded-lg shadow-sm border border-indigo-200 bg-indigo-50/30">
                <h2 className="text-lg font-semibold mb-4 text-indigo-900">Manage Live Matches & Scouting</h2>
                {fixtures.length === 0 ? (
                    <p className="text-gray-500 text-sm">No scheduled fixtures available.</p>
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {fixtures.map(f => (
                            <li key={f.id} className="py-3 flex items-center justify-between">
                                <div>
                                    <div className="font-medium">{f.home_team?.name} vs {f.away_team?.name}</div>
                                    <div className="text-xs text-gray-500 mt-1">Status: {f.status} &bull; Score: {f.home_score}-{f.away_score} &bull; Date: {new Date(f.match_date).toLocaleDateString()}</div>
                                </div>
                                <Link href={`/admin/match/${f.id}`} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded shadow-sm transition-colors">
                                    Manage Match
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-semibold mb-4">Tournament Settings</h2>
                <form onSubmit={handleUpdateTournamentSettings} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Tournament Format</label>
                        <select className="w-full border rounded p-2" value={tournamentSettings.format} onChange={e => setTournamentSettings({...tournamentSettings, format: e.target.value})}>
                            <option value="league">League Format</option>
                            <option value="knockouts">Knockouts</option>
                            <option value="group_to_knockout">Group Stage to Knockout</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Arrangement of Teams on Table</label>
                        <textarea className="w-full border rounded p-2 h-20" placeholder="e.g. Group A: Team 1, Team 2... Group B..." value={tournamentSettings.table_arrangement} onChange={e => setTournamentSettings({...tournamentSettings, table_arrangement: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Rules and Codes</label>
                        <textarea className="w-full border rounded p-2 h-32" placeholder="Enter the official tournament rules and code of conduct..." value={tournamentSettings.rules} onChange={e => setTournamentSettings({...tournamentSettings, rules: e.target.value})} />
                    </div>
                    <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 w-full md:w-auto">Update Settings</button>
                </form>
            </div>
        </div>
      </div>
    </div>
  )
}
