/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Custom Searchable Dropdown Component
function SearchableSelect({ options, value, onChange, placeholder, isFreeText = false }: { options: any[], value: string, onChange: (val: string) => void, placeholder: string, isFreeText?: boolean }) {
    const [isOpen, setIsOpen] = useState(false)
    const [search, setSearch] = useState('')
    const wrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false)
                if (isFreeText && search && !options.find(o => o.id === search)) {
                    onChange(search) // Free text mode allows custom values
                }
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [wrapperRef, isFreeText, search, options, onChange])

    const filteredOptions = options.filter(opt => opt.name.toLowerCase().includes(search.toLowerCase()))
    const selectedOption = options.find(opt => opt.id === value) || (isFreeText && value ? {id: value, name: value} : null)

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
                    <ul className="py-1">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt) => (
                                <li
                                    key={opt.id}
                                    className={`px-3 py-2 cursor-pointer hover:bg-indigo-50 text-sm ${value === opt.id ? 'bg-indigo-100 font-medium' : ''}`}
                                    onClick={() => {
                                        onChange(opt.id);
                                        setIsOpen(false);
                                        setSearch('');
                                    }}
                                >
                                    {opt.name}
                                </li>
                            ))
                        ) : (
                            <li
                                className={`px-3 py-2 text-sm text-center ${isFreeText && search ? 'cursor-pointer hover:bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-500'}`}
                                onClick={() => {
                                    if(isFreeText && search) {
                                        onChange(search);
                                        setIsOpen(false);
                                    }
                                }}
                            >
                                {isFreeText && search ? `Use "${search}"` : 'No results found'}
                            </li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    )
}

export default function AdminDashboard() {
  const [fixtures, setFixtures] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [players, setPlayers] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'teams' | 'players' | 'fixtures' | 'playoffs' | 'settings'>('teams')

  const [newTeam, setNewTeam] = useState({ name: '', short_name: '', coach: '', attire_color: 'Yet to be decided', group_name: '' })
  const [editingTeam, setEditingTeam] = useState<any>(null)

  const [newPlayer, setNewPlayer] = useState({ name: '', team_id: '', position: '', shirt_number: '' })
  const [editingPlayer, setEditingPlayer] = useState<any>(null)

  const [newFixture, setNewFixture] = useState({ home_team_id: '', away_team_id: '', match_date: '', venue: '', stage: 'group_stage' })
  const [editingFixture, setEditingFixture] = useState<any>(null)

  const [tournamentSettings, setTournamentSettings] = useState({ id: '', rules_text: '', rules_pdf_url: '' })

  const supabase = createClient()
  const router = useRouter()

  const fetchData = async () => {
    setLoading(true)
    const [teamsRes, fixturesRes, playersRes, settingsRes] = await Promise.all([
      supabase.from('teams').select('*').order('name'),
      supabase.from('fixtures').select('*, home_team:teams!home_team_id(name), away_team:teams!away_team_id(name)').order('match_date', { ascending: false }),
      supabase.from('players').select('*, team:teams!team_id(name)').order('name'),
      supabase.from('tournament_settings').select('*').limit(1).single()
    ])

    if (teamsRes.data) setTeams(teamsRes.data)
    if (fixturesRes.data) setFixtures(fixturesRes.data)
    if (playersRes.data) setPlayers(playersRes.data)
    if (settingsRes.data) setTournamentSettings(settingsRes.data)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Unique groups extraction
  const uniqueGroups = Array.from(new Set(teams.filter(t => t.group_name).map(t => t.group_name)))
  const groupOptions = uniqueGroups.map(g => ({ id: g, name: g }))

  // Unique stages extraction
  const predefinedStages = ['group_stage', 'round_of_16', 'quarter_final', 'semi_final', 'final']
  const dbStages = Array.from(new Set(fixtures.map(f => f.stage).filter(s => s)))
  const allStages = Array.from(new Set([...predefinedStages, ...dbStages]))
  const stageOptions = allStages.map(s => ({ id: s as string, name: (s as string).replace(/_/g, ' ').toUpperCase() }))

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editingTeam) {
        const { error } = await supabase.from('teams').update({
            name: editingTeam.name,
            short_name: editingTeam.short_name,
            coach: editingTeam.coach,
            attire_color: editingTeam.attire_color,
            group_name: editingTeam.group_name
        }).eq('id', editingTeam.id)
        if (error) alert('Error updating team: ' + error.message)
        else {
            alert('Team updated successfully!')
            setEditingTeam(null)
            fetchData()
        }
    } else {
        const { error } = await supabase.from('teams').insert([newTeam])
        if (error) alert('Error registering team: ' + error.message)
        else {
            alert('Team registered successfully!')
            setNewTeam({ name: '', short_name: '', coach: '', attire_color: 'Yet to be decided', group_name: '' })
            fetchData()
        }
    }
  }

  const handleDeleteTeam = async (id: string) => {
      if(confirm('Are you sure you want to delete this team? This will delete all players and fixtures related.')) {
          const { error } = await supabase.from('teams').delete().eq('id', id)
          if(error) alert('Error deleting team: ' + error.message)
          else fetchData()
      }
  }

  const handleCreatePlayer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editingPlayer) {
        const { error } = await supabase.from('players').update({
            name: editingPlayer.name,
            team_id: editingPlayer.team_id,
            position: editingPlayer.position,
            shirt_number: editingPlayer.shirt_number ? parseInt(editingPlayer.shirt_number) : null
        }).eq('id', editingPlayer.id)
        if (error) alert('Error updating player: ' + error.message)
        else {
            alert('Player updated successfully!')
            setEditingPlayer(null)
            fetchData()
        }
    } else {
        const { error } = await supabase.from('players').insert([{
            ...newPlayer,
            shirt_number: newPlayer.shirt_number ? parseInt(newPlayer.shirt_number) : null
        }])
        if (error) alert('Error adding player: ' + error.message)
        else {
            alert('Player added successfully!')
            setNewPlayer({ name: '', team_id: '', position: '', shirt_number: '' })
            fetchData()
        }
    }
  }

  const handleDeletePlayer = async (id: string) => {
      if(confirm('Are you sure you want to delete this player?')) {
          const { error } = await supabase.from('players').delete().eq('id', id)
          if(error) alert('Error deleting player: ' + error.message)
          else fetchData()
      }
  }

  const handleCreateFixture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editingFixture) {
        const { error } = await supabase.from('fixtures').update({
            home_team_id: editingFixture.home_team_id,
            away_team_id: editingFixture.away_team_id,
            match_date: editingFixture.match_date,
            venue: editingFixture.venue,
            stage: editingFixture.stage
        }).eq('id', editingFixture.id)
        if (error) alert('Error updating fixture: ' + error.message)
        else {
            alert('Fixture updated successfully!')
            setEditingFixture(null)
            fetchData()
        }
    } else {
        const { error } = await supabase.from('fixtures').insert([newFixture])
        if (error) alert('Error scheduling fixture: ' + error.message)
        else {
            alert('Fixture scheduled successfully!')
            setNewFixture({ home_team_id: '', away_team_id: '', match_date: '', venue: '', stage: 'group_stage' })
            fetchData()
        }
    }
  }

  const handleDeleteFixture = async (id: string) => {
      if(confirm('Are you sure you want to delete this fixture?')) {
          const { error } = await supabase.from('fixtures').delete().eq('id', id)
          if(error) alert('Error deleting fixture: ' + error.message)
          else fetchData()
      }
  }

  const handleUpdateTournamentSettings = async (e: React.FormEvent) => {
      e.preventDefault()

      let res;
      if (tournamentSettings.id) {
          res = await supabase.from('tournament_settings').update({
              rules_text: tournamentSettings.rules_text,
              rules_pdf_url: tournamentSettings.rules_pdf_url
          }).eq('id', tournamentSettings.id)
      } else {
          res = await supabase.from('tournament_settings').insert([{
              rules_text: tournamentSettings.rules_text,
              rules_pdf_url: tournamentSettings.rules_pdf_url
          }])
      }

      if (res.error) alert('Error updating settings: ' + res.error.message)
      else {
          alert('Tournament settings updated!')
          fetchData()
      }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="p-8">Loading admin data...</div>

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-12">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center mb-8 overflow-x-auto">
        <div className="flex items-center gap-4 shrink-0">
            <h1 className="text-xl font-bold">Obsidian Elite Admin</h1>
            <Link href="/" className="text-sm text-indigo-600 hover:underline border-l pl-4 border-gray-300">&larr; Back to Public Site</Link>
        </div>
        <div className="flex gap-4 px-4 min-w-max">
            <button onClick={() => setActiveTab('teams')} className={`text-sm ${activeTab === 'teams' ? 'font-bold underline text-indigo-600' : 'text-gray-600'}`}>Teams</button>
            <button onClick={() => setActiveTab('players')} className={`text-sm ${activeTab === 'players' ? 'font-bold underline text-indigo-600' : 'text-gray-600'}`}>Players</button>
            <button onClick={() => setActiveTab('fixtures')} className={`text-sm ${activeTab === 'fixtures' ? 'font-bold underline text-indigo-600' : 'text-gray-600'}`}>Group Matches</button>
            <button onClick={() => setActiveTab('playoffs')} className={`text-sm ${activeTab === 'playoffs' ? 'font-bold underline text-indigo-600' : 'text-gray-600'}`}>Play-offs</button>
            <button onClick={() => setActiveTab('settings')} className={`text-sm ${activeTab === 'settings' ? 'font-bold underline text-indigo-600' : 'text-gray-600'}`}>Settings / Rules</button>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-600 hover:text-gray-900 shrink-0">Sign Out</button>
      </nav>

      <div className="max-w-7xl mx-auto px-6">

        {activeTab === 'teams' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h2 className="text-lg font-semibold mb-4">{editingTeam ? 'Edit Team' : 'Register New Team'}</h2>
                    <form onSubmit={handleCreateTeam} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Team Name</label>
                            <input type="text" required className="w-full border rounded p-2" value={editingTeam ? editingTeam.name : newTeam.name} onChange={e => editingTeam ? setEditingTeam({...editingTeam, name: e.target.value}) : setNewTeam({...newTeam, name: e.target.value})} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Short Name</label>
                                <input type="text" required className="w-full border rounded p-2" maxLength={4} value={editingTeam ? editingTeam.short_name : newTeam.short_name} onChange={e => editingTeam ? setEditingTeam({...editingTeam, short_name: e.target.value}) : setNewTeam({...newTeam, short_name: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 flex justify-between">
                                    <span>Group Name</span>
                                    <span className="text-xs text-gray-500 font-normal">Type or select</span>
                                </label>
                                <SearchableSelect
                                    options={groupOptions}
                                    value={editingTeam ? (editingTeam.group_name || '') : newTeam.group_name}
                                    onChange={(val) => editingTeam ? setEditingTeam({...editingTeam, group_name: val}) : setNewTeam({...newTeam, group_name: val})}
                                    placeholder="e.g. Group A"
                                    isFreeText={true}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Coach</label>
                                <input type="text" className="w-full border rounded p-2" value={editingTeam ? editingTeam.coach : newTeam.coach} onChange={e => editingTeam ? setEditingTeam({...editingTeam, coach: e.target.value}) : setNewTeam({...newTeam, coach: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Attire Color</label>
                                <input type="text" className="w-full border rounded p-2" value={editingTeam ? editingTeam.attire_color : newTeam.attire_color} onChange={e => editingTeam ? setEditingTeam({...editingTeam, attire_color: e.target.value}) : setNewTeam({...newTeam, attire_color: e.target.value})} />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">{editingTeam ? 'Update Team' : 'Register Team'}</button>
                            {editingTeam && <button type="button" onClick={() => setEditingTeam(null)} className="bg-gray-300 text-gray-800 px-4 py-2 rounded">Cancel</button>}
                        </div>
                    </form>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h2 className="text-lg font-semibold mb-4">Registered Teams ({teams.length})</h2>
                    <ul className="divide-y divide-gray-100 max-h-[500px] overflow-auto">
                        {teams.map(t => (
                            <li key={t.id} className="py-3 flex justify-between items-center">
                                <div>
                                    <div className="font-medium">{t.name} <span className="text-gray-400 text-sm">({t.short_name})</span></div>
                                    <div className="text-xs text-gray-500">Group: {t.group_name || 'None'}</div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setEditingTeam(t)} className="text-sm text-blue-600 hover:underline">Edit</button>
                                    <button onClick={() => handleDeleteTeam(t.id)} className="text-sm text-red-600 hover:underline">Delete</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        )}

        {activeTab === 'players' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h2 className="text-lg font-semibold mb-4">{editingPlayer ? 'Edit Player' : 'Add New Player'}</h2>
                    <form onSubmit={handleCreatePlayer} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Player Name</label>
                            <input type="text" required className="w-full border rounded p-2" value={editingPlayer ? editingPlayer.name : newPlayer.name} onChange={e => editingPlayer ? setEditingPlayer({...editingPlayer, name: e.target.value}) : setNewPlayer({...newPlayer, name: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Team</label>
                            <select required className="w-full border rounded p-2" value={editingPlayer ? editingPlayer.team_id : newPlayer.team_id} onChange={e => editingPlayer ? setEditingPlayer({...editingPlayer, team_id: e.target.value}) : setNewPlayer({...newPlayer, team_id: e.target.value})}>
                                <option value="">Select a team...</option>
                                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Position</label>
                                <select className="w-full border rounded p-2" value={editingPlayer ? (editingPlayer.position || '') : newPlayer.position} onChange={e => editingPlayer ? setEditingPlayer({...editingPlayer, position: e.target.value}) : setNewPlayer({...newPlayer, position: e.target.value})}>
                                    <option value="">Select...</option>
                                    <option value="Goalkeeper">Goalkeeper</option>
                                    <option value="Defender">Defender</option>
                                    <option value="Midfielder">Midfielder</option>
                                    <option value="Forward">Forward</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Shirt Number</label>
                                <input type="number" className="w-full border rounded p-2" value={editingPlayer ? (editingPlayer.shirt_number || '') : newPlayer.shirt_number} onChange={e => editingPlayer ? setEditingPlayer({...editingPlayer, shirt_number: e.target.value}) : setNewPlayer({...newPlayer, shirt_number: e.target.value})} />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">{editingPlayer ? 'Update Player' : 'Add Player'}</button>
                            {editingPlayer && <button type="button" onClick={() => setEditingPlayer(null)} className="bg-gray-300 text-gray-800 px-4 py-2 rounded">Cancel</button>}
                        </div>
                    </form>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h2 className="text-lg font-semibold mb-4">Registered Players ({players.length})</h2>
                    <ul className="divide-y divide-gray-100 max-h-[500px] overflow-auto">
                        {players.map(p => (
                            <li key={p.id} className="py-3 flex justify-between items-center">
                                <div>
                                    <div className="font-medium">{p.name} {p.shirt_number && <span className="text-gray-400">#{p.shirt_number}</span>}</div>
                                    <div className="text-xs text-gray-500">{p.team?.name} &bull; {p.position || 'No Pos'}</div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setEditingPlayer(p)} className="text-sm text-blue-600 hover:underline">Edit</button>
                                    <button onClick={() => handleDeletePlayer(p.id)} className="text-sm text-red-600 hover:underline">Delete</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        )}

        {/* GROUP FIXTURES TAB */}
        {activeTab === 'fixtures' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h2 className="text-lg font-semibold mb-4">{editingFixture ? 'Edit Group Match' : 'Schedule Group Match'}</h2>
                    <form onSubmit={handleCreateFixture} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                            <label className="block text-sm font-medium mb-1">Home Team</label>
                            <SearchableSelect
                                options={teams}
                                value={editingFixture ? editingFixture.home_team_id : newFixture.home_team_id}
                                onChange={(val) => editingFixture ? setEditingFixture({...editingFixture, home_team_id: val}) : setNewFixture({...newFixture, home_team_id: val})}
                                placeholder="Search teams..."
                            />
                            </div>
                            <div>
                            <label className="block text-sm font-medium mb-1">Away Team</label>
                            <SearchableSelect
                                options={teams}
                                value={editingFixture ? editingFixture.away_team_id : newFixture.away_team_id}
                                onChange={(val) => editingFixture ? setEditingFixture({...editingFixture, away_team_id: val}) : setNewFixture({...newFixture, away_team_id: val})}
                                placeholder="Search teams..."
                            />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Date & Time</label>
                                <input type="datetime-local" required className="w-full border rounded p-2" value={editingFixture ? (editingFixture.match_date ? new Date(editingFixture.match_date).toISOString().slice(0,16) : '') : newFixture.match_date} onChange={e => editingFixture ? setEditingFixture({...editingFixture, match_date: e.target.value}) : setNewFixture({...newFixture, match_date: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Venue</label>
                                <input type="text" className="w-full border rounded p-2" value={editingFixture ? editingFixture.venue : newFixture.venue} onChange={e => editingFixture ? setEditingFixture({...editingFixture, venue: e.target.value}) : setNewFixture({...newFixture, venue: e.target.value})} />
                            </div>
                        </div>
                        <div className="hidden">
                            {/* Hidden stage field to enforce group matches */}
                            <input type="hidden" value={editingFixture ? editingFixture.stage : 'group_stage'} />
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">{editingFixture ? 'Update Fixture' : 'Schedule Fixture'}</button>
                            {editingFixture && <button type="button" onClick={() => setEditingFixture(null)} className="bg-gray-300 text-gray-800 px-4 py-2 rounded">Cancel</button>}
                        </div>
                    </form>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-indigo-200 bg-indigo-50/30">
                    <h2 className="text-lg font-semibold mb-4 text-indigo-900">Manage Group Matches</h2>
                    <ul className="divide-y divide-gray-200 max-h-[600px] overflow-auto">
                        {fixtures.filter(f => f.stage === 'group_stage').map(f => (
                            <li key={f.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                    <div className="font-medium">{f.home_team?.name} vs {f.away_team?.name}</div>
                                    <div className="text-xs text-gray-500 mt-1">Status: {f.status} &bull; Score: {f.home_score}-{f.away_score}</div>
                                </div>
                                <div className="flex gap-2 items-center shrink-0">
                                    <button onClick={() => setEditingFixture(f)} className="text-xs text-blue-600 hover:underline">Edit</button>
                                    <button onClick={() => handleDeleteFixture(f.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                                    <Link href={`/admin/match/${f.id}`} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5 rounded shadow-sm transition-colors">
                                        Manage
                                    </Link>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        )}

        {/* PLAYOFFS TAB (Dynamic Creation) */}
        {activeTab === 'playoffs' && (
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <div className="bg-white p-6 rounded-lg shadow-sm border border-amber-200 bg-amber-50/50">
                    <h2 className="text-lg font-semibold mb-2 text-amber-900">Create Play-off Match</h2>
                    <p className="text-sm text-gray-600 mb-4">Because the number of groups is dynamic, you can manually create play-off fixtures here by typing any stage name.</p>

                    <form onSubmit={handleCreateFixture} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Home Team</label>
                                <SearchableSelect
                                    options={teams}
                                    value={editingFixture ? editingFixture.home_team_id : newFixture.home_team_id}
                                    onChange={(val) => editingFixture ? setEditingFixture({...editingFixture, home_team_id: val}) : setNewFixture({...newFixture, home_team_id: val})}
                                    placeholder="Search teams..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Away Team</label>
                                <SearchableSelect
                                    options={teams}
                                    value={editingFixture ? editingFixture.away_team_id : newFixture.away_team_id}
                                    onChange={(val) => editingFixture ? setEditingFixture({...editingFixture, away_team_id: val}) : setNewFixture({...newFixture, away_team_id: val})}
                                    placeholder="Search teams..."
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Date & Time</label>
                                <input type="datetime-local" required className="w-full border rounded p-2 bg-white" value={editingFixture ? (editingFixture.match_date ? new Date(editingFixture.match_date).toISOString().slice(0,16) : '') : newFixture.match_date} onChange={e => editingFixture ? setEditingFixture({...editingFixture, match_date: e.target.value}) : setNewFixture({...newFixture, match_date: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 flex justify-between">
                                    <span>Play-off Stage</span>
                                    <span className="text-xs text-gray-500 font-normal">Type or select</span>
                                </label>
                                <SearchableSelect
                                    options={stageOptions.filter(s => s.id !== 'group_stage')}
                                    value={editingFixture ? editingFixture.stage : (newFixture.stage === 'group_stage' ? '' : newFixture.stage)}
                                    onChange={(val) => editingFixture ? setEditingFixture({...editingFixture, stage: val}) : setNewFixture({...newFixture, stage: val})}
                                    placeholder="e.g. Round of 16"
                                    isFreeText={true}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" className="bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700">{editingFixture ? 'Update Play-off Match' : 'Create Play-off Match'}</button>
                            {editingFixture && <button type="button" onClick={() => setEditingFixture(null)} className="bg-gray-300 text-gray-800 px-4 py-2 rounded">Cancel</button>}
                        </div>
                    </form>
                 </div>

                 <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h2 className="text-lg font-semibold mb-4">Manage Play-off Matches</h2>
                    <ul className="divide-y divide-gray-200 max-h-[600px] overflow-auto">
                        {fixtures.filter(f => f.stage !== 'group_stage').map(f => (
                            <li key={f.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                    <div className="font-medium">{f.home_team?.name} vs {f.away_team?.name}</div>
                                    <div className="text-xs text-gray-500 mt-1">Stage: <span className="uppercase text-amber-600 font-bold">{f.stage?.replace(/_/g, ' ')}</span> &bull; Status: {f.status} &bull; Score: {f.home_score}-{f.away_score}</div>
                                </div>
                                <div className="flex gap-2 items-center shrink-0">
                                    <button onClick={() => setEditingFixture(f)} className="text-xs text-blue-600 hover:underline">Edit</button>
                                    <button onClick={() => handleDeleteFixture(f.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                                    <Link href={`/admin/match/${f.id}`} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5 rounded shadow-sm transition-colors">
                                        Manage
                                    </Link>
                                </div>
                            </li>
                        ))}
                    </ul>
                 </div>
             </div>
        )}

        {/* SETTINGS / RULES TAB */}
        {activeTab === 'settings' && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 max-w-3xl">
                <h2 className="text-lg font-semibold mb-4">Tournament Rules & Codes</h2>
                <form onSubmit={handleUpdateTournamentSettings} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium mb-1">Rules PDF Link (URL)</label>
                        <p className="text-xs text-gray-500 mb-2">Paste a link to a Google Drive, Dropbox, or hosted PDF file for the rules.</p>
                        <input type="url" placeholder="https://..." className="w-full border rounded p-2" value={tournamentSettings.rules_pdf_url || ''} onChange={e => setTournamentSettings({...tournamentSettings, rules_pdf_url: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">General Rules Text</label>
                        <p className="text-xs text-gray-500 mb-2">Enter the official tournament rules and code of conduct. This is displayed directly on the public page.</p>
                        <textarea className="w-full border rounded p-2 h-64 font-mono text-sm" placeholder="1. Match duration is 90 mins..." value={tournamentSettings.rules_text || ''} onChange={e => setTournamentSettings({...tournamentSettings, rules_text: e.target.value})} />
                    </div>
                    <button type="submit" className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-indigo-700 w-full md:w-auto">Save Settings & Rules</button>
                </form>
            </div>
        )}
      </div>
    </div>
  )
}
