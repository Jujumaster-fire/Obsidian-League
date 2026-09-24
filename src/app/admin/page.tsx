'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { AdminSkeleton } from '@/components/Skeleton'
import {
  ATTIRE_OPTIONS,
  AccessPanel,
  CATEGORY_OPTIONS,
  Field,
  Fixture,
  STAGE_OPTIONS,
  SearchableSelect,
  SelectInput,
  StatusBanner,
  Team,
  TextInput,
  Tournament,
  adminInputClass,
  adminPrimaryButton,
  adminSubtleButton,
  useSportOptions,
} from '@/components/admin/AdminWidgets'
import {
  RosterEditor,
  TeamRosterManager,
  type PlayerRow,
  type RosterDraftRow,
} from '@/components/admin/RosterEditor'
import { RoleTourLauncher } from '@/components/onboarding/RoleTourLauncher'

const EMPTY_TEAM_FORM = {
  name: '',
  short_name: '',
  coach: '',
  attire_color: 'Yet to be decided',
  roster: '',
  medical_staff: '',
  tactical_coach: '',
  assistant_coach: '',
  kit_personnel: '',
  category: 'Male',
  team_type: 'Football',
  group_name: '',
}

const EMPTY_FIXTURE_FORM = {
  home_team_id: '',
  away_team_id: '',
  match_date: '',
  venue: '',
  stage: 'group_stage',
}

/**
 * Admin dashboard.
 *
 * Role detection is centralised in `useAdminAuth()` (which proxies the
 * server-resolved `/api/admin-auth-info`), so this page never infers
 * privileges itself. Every write is scoped to a chosen tournament: rows with
 * `tournament_id = NULL` are app-admin-only under RLS, so scoping is what
 * lets tournament staff work at all.
 */
export default function AdminDashboard() {
  const supabase = useMemo(() => createClient(), [])
  const { loading: authLoading, authenticated, canAccessAdmin, isAppAdmin, memberships } =
    useAdminAuth()

  const [loading, setLoading] = useState(true)
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({})
  /** Full squad rows (id + shirt number) for the roster checklist editor. */
  const [players, setPlayers] = useState<PlayerRow[]>([])
  /** Draft roster for the "register a team" form (name + shirt number rows). */
  const [rosterRows, setRosterRows] = useState<RosterDraftRow[]>([])
  /** Discipline options, loaded live from the sports catalogue (never hardcoded). */
  const [catalogueSports, setCatalogueSports] = useState<{ code: string; name: string }[] | null>(null)
  const sportOptions = useSportOptions(catalogueSports ?? undefined)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [teamForm, setTeamForm] = useState({ ...EMPTY_TEAM_FORM })
  const [fixtureForm, setFixtureForm] = useState({ ...EMPTY_FIXTURE_FORM })
  const [settingsForm, setSettingsForm] = useState({
    format: 'league',
    table_arrangement: '',
    rules: '',
  })
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [teamDraft, setTeamDraft] = useState({ ...EMPTY_TEAM_FORM })
  const [editingFixtureId, setEditingFixtureId] = useState<string | null>(null)
  const [fixtureDraft, setFixtureDraft] = useState({
    match_date: '',
    venue: '',
    stage: 'group_stage',
  })
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const selectedTournament = tournaments.find((row) => row.id === selectedTournamentId) ?? null
  const notify = (kind: 'success' | 'error', message: string) => setStatus({ kind, message })

  /** Bust the cached public reads so admin writes appear immediately. */
  const bustPublicCache = async () => {
    try {
      await fetch('/api/revalidate', { method: 'POST' })
    } catch {
      // Best effort — the 30-60s ISR window still converges.
    }
  }

  const loadTournaments = useCallback(async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('id, name, slug, edition, status, is_active')
      .order('is_active', { ascending: false })
      .order('start_date', { ascending: false })

    const rows = (Array.isArray(data) ? data : []) as Tournament[]
    setTournaments(rows)
    setSelectedTournamentId((current) => {
      if (current && rows.some((row) => row.id === current)) return current
      return rows.find((row) => row.is_active)?.id ?? rows[0]?.id ?? ''
    })

    // The discipline dropdown always mirrors the live sports catalogue
    // (RLS exposes it publicly), so the team form never offers a stale list.
    try {
      const { data: sportsRows } = await supabase
        .from('sports')
        .select('code, name')
        .order('name')
      if (Array.isArray(sportsRows)) {
        setCatalogueSports(sportsRows as { code: string; name: string }[])
      }
    } catch {
      // best effort — the fallback option list stays in place
    }
  }, [supabase])

const loadTournamentData = useCallback(
    async (tournamentId: string) => {
      if (!tournamentId) {
        setTeams([])
        setFixtures([])
        setPlayerCounts({})
        setLoading(false)
        return
      }

      setLoading(true)
      const [teamsRes, fixturesRes, settingsRes, playersRes] = await Promise.all([
        supabase
          .from('teams')
          .select('*')
          .or(`tournament_id.eq.${tournamentId},tournament_id.is.null`)
          .order('name'),
        supabase
          .from('fixtures')
          .select(
            'id, match_date, venue, status, home_score, away_score, current_minute, stage, tournament_id, home_team:home_team_id(name), away_team:away_team_id(name)'
          )
          .eq('tournament_id', tournamentId)
          .order('match_date', { ascending: false }),
        supabase
          .from('tournament_settings')
          .select('format, table_arrangement, rules')
          .eq('tournament_id', tournamentId)
          .maybeSingle(),
        supabase
          .from('players')
          .select('id, team_id, name, jersey_number')
          .eq('tournament_id', tournamentId),
      ])

      setTeams((Array.isArray(teamsRes.data) ? teamsRes.data : []) as Team[])
      setFixtures(
        (Array.isArray(fixturesRes.data) ? fixturesRes.data : []) as unknown as Fixture[]
      )

      if (settingsRes.data) {
        setSettingsForm({
          format: settingsRes.data.format ?? 'league',
          table_arrangement: settingsRes.data.table_arrangement ?? '',
          rules: settingsRes.data.rules ?? '',
        })
      } else {
        setSettingsForm({ format: 'league', table_arrangement: '', rules: '' })
      }

      const counts: Record<string, number> = {}
      const playerRows = (Array.isArray(playersRes.data) ? playersRes.data : []) as PlayerRow[]
      for (const row of playerRows) {
        counts[row.team_id] = (counts[row.team_id] ?? 0) + 1
      }
      setPlayerCounts(counts)
      setPlayers(playerRows)
      setLoading(false)
    },
    [supabase]
  )

  useEffect(() => {
    if (authLoading || !canAccessAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void loadTournaments()
  }, [authLoading, canAccessAdmin, loadTournaments])

  useEffect(() => {
    if (authLoading || !canAccessAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void loadTournamentData(selectedTournamentId)
  }, [authLoading, canAccessAdmin, selectedTournamentId, loadTournamentData])

  const refreshTournament = async () => {
    await loadTournamentData(selectedTournamentId)
    await bustPublicCache()
  }

  const handleCreateTeam = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!teamForm.name.trim()) {
      notify('error', 'Team name is required.')
      return
    }
    if (!selectedTournamentId) {
      notify('error', 'Select a tournament first — records must be scoped to a tournament.')
      return
    }

    setBusy(true)
    const { data: insertedTeam, error } = await supabase
      .from('teams')
      .insert([
        {
          ...teamForm,
          name: teamForm.name.trim(),
          short_name: teamForm.short_name.trim() || null,
          group_name: teamForm.group_name.trim() || null,
          tournament_id: selectedTournamentId,
        },
      ])
      .select('id')
      .single()

    if (!error) {
      // Seed the squad table from the checklist rows (name + shirt number).
      // The insert above returns the new row id, so no name-based lookup (and
      // no race) is needed.
      const filledRows = rosterRows
        .map((row) => ({ name: row.name.trim(), jersey_number: row.jersey_number.trim() }))
        .filter((row) => row.name.length > 0)

      const teamId = (insertedTeam as { id?: string } | null)?.id
      if (teamId && filledRows.length > 0) {
        const { error: squadError } = await supabase.from('players').insert(
          filledRows.map((row) => ({
            name: row.name,
            jersey_number: Number.parseInt(row.jersey_number, 10) || null,
            team_id: teamId,
            tournament_id: selectedTournamentId,
          }))
        )
        if (squadError) {
          notify('error', `Team saved, but the squad could not be seeded: ${squadError.message}`)
        }

        // Keep the CSV mirror on `teams.roster` in step with the squad table
        // (the public line-up tab reads it).
        await supabase
          .from('teams')
          .update({ roster: filledRows.map((row) => row.name).join(', ') })
          .eq('id', teamId)
      }
    }
    setBusy(false)

    if (error) {
      notify('error', `Could not register team: ${error.message}`)
      return
    }

    setTeamForm({ ...EMPTY_TEAM_FORM })
    setRosterRows([])
    notify('success', 'Team registered.')
    await refreshTournament()
  }

  const beginTeamEdit = (team: Team) => {
    setConfirmId(null)
    setEditingTeamId(team.id)
    setTeamDraft({
      name: team.name ?? '',
      short_name: team.short_name ?? '',
      coach: team.coach ?? '',
      attire_color: team.attire_color ?? 'Yet to be decided',
      roster: team.roster ?? '',
      medical_staff: team.medical_staff ?? '',
      tactical_coach: team.tactical_coach ?? '',
      assistant_coach: team.assistant_coach ?? '',
      kit_personnel: team.kit_personnel ?? '',
      category: team.category ?? 'Male',
      team_type: team.team_type ?? 'Football',
      group_name: team.group_name ?? '',
    })
  }

  const handleSaveTeamEdit = async (teamId: string) => {
    setBusy(true)
    // `roster` is intentionally excluded: the squad CSV is owned by
    // TeamRosterManager so a stale textarea value cannot overwrite it.
    const { error } = await supabase
      .from('teams')
      .update({
        name: teamDraft.name.trim(),
        short_name: teamDraft.short_name.trim() || null,
        group_name: teamDraft.group_name.trim() || null,
        coach: teamDraft.coach,
        attire_color: teamDraft.attire_color,
        category: teamDraft.category,
        team_type: teamDraft.team_type,
        medical_staff: teamDraft.medical_staff,
        tactical_coach: teamDraft.tactical_coach,
        assistant_coach: teamDraft.assistant_coach,
        kit_personnel: teamDraft.kit_personnel,
      })
      .eq('id', teamId)
    setBusy(false)

    if (error) {
      notify('error', `Could not update team: ${error.message}`)
      return
    }

    setEditingTeamId(null)
    notify('success', 'Team updated.')
    await refreshTournament()
  }

  const handleDeleteTeam = async (team: Team) => {
    if (confirmId !== team.id) {
      setConfirmId(team.id)
      return
    }

    setBusy(true)
    const { error } = await supabase.from('teams').delete().eq('id', team.id)
    setBusy(false)
    setConfirmId(null)

    if (error) {
      notify('error', `Could not delete team: ${error.message}`)
      return
    }
    notify('success', 'Team deleted.')
    await refreshTournament()
  }

const handleCreateFixture = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!fixtureForm.home_team_id || !fixtureForm.away_team_id) {
      notify('error', 'Select both a home and an away team.')
      return
    }
    if (fixtureForm.home_team_id === fixtureForm.away_team_id) {
      notify('error', 'Home and away teams cannot be the same.')
      return
    }
    if (!fixtureForm.match_date) {
      notify('error', 'Pick a kick-off date and time.')
      return
    }
    if (!selectedTournamentId) {
      notify('error', 'Select a tournament first — fixtures must be scoped to a tournament.')
      return
    }

    setBusy(true)
    const { error } = await supabase.from('fixtures').insert([
      {
        home_team_id: fixtureForm.home_team_id,
        away_team_id: fixtureForm.away_team_id,
        match_date: new Date(fixtureForm.match_date).toISOString(),
        venue: fixtureForm.venue.trim() || null,
        stage: fixtureForm.stage,
        status: 'scheduled',
        tournament_id: selectedTournamentId,
      },
    ])
    setBusy(false)

    if (error) {
      notify('error', `Could not schedule fixture: ${error.message}`)
      return
    }

    setFixtureForm({ ...EMPTY_FIXTURE_FORM })
    notify('success', 'Fixture scheduled.')
    await refreshTournament()
  }

  const beginFixtureEdit = (fixture: Fixture) => {
    setConfirmId(null)
    setEditingFixtureId(fixture.id)
    setFixtureDraft({
      match_date: fixture.match_date
        ? new Date(fixture.match_date).toISOString().slice(0, 16)
        : '',
      venue: fixture.venue ?? '',
      stage: fixture.stage ?? 'group_stage',
    })
  }

  const handleSaveFixtureEdit = async (fixtureId: string) => {
    setBusy(true)
    const { error } = await supabase
      .from('fixtures')
      .update({
        match_date: fixtureDraft.match_date
          ? new Date(fixtureDraft.match_date).toISOString()
          : undefined,
        venue: fixtureDraft.venue.trim() || null,
        stage: fixtureDraft.stage,
      })
      .eq('id', fixtureId)
    setBusy(false)

    if (error) {
      notify('error', `Could not update fixture: ${error.message}`)
      return
    }

    setEditingFixtureId(null)
    notify('success', 'Fixture updated.')
    await refreshTournament()
  }

  const handleDeleteFixture = async (fixture: Fixture) => {
    if (confirmId !== fixture.id) {
      setConfirmId(fixture.id)
      return
    }

    setBusy(true)
    const { error } = await supabase.from('fixtures').delete().eq('id', fixture.id)
    setBusy(false)
    setConfirmId(null)

    if (error) {
      notify('error', `Could not delete fixture: ${error.message}`)
      return
    }
    notify('success', 'Fixture deleted.')
    await refreshTournament()
  }

  const handleSaveSettings = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedTournamentId) {
      notify('error', 'Select a tournament first.')
      return
    }

    setBusy(true)
    const { error } = await supabase
      .from('tournament_settings')
      .upsert(
        { ...settingsForm, tournament_id: selectedTournamentId },
        { onConflict: 'tournament_id' }
      )
    setBusy(false)

    if (error) {
      notify('error', `Could not save settings: ${error.message}`)
      return
    }
    notify('success', 'Tournament settings saved.')
    await bustPublicCache()
  }

  if (authLoading) return <AdminSkeleton />

  if (!authenticated) {
    return (
      <AccessPanel
        title="Sign in required"
        body="The admin dashboard is only available to signed-in tournament staff."
        href="/login?next=%2Fadmin"
        linkLabel="Sign in"
      />
    )
  }

  if (!canAccessAdmin) {
    return (
      <AccessPanel
        title="No admin access"
        body="Your account is not an app admin and is not a member of any tournament. Ask a director for an invite link."
        href="/"
        linkLabel="Back to the site"
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#0f172a] pb-24 text-white">
      {/* First visit at this level: introduce the staff member to their own controls. */}
      <RoleTourLauncher minRole="scout" />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <h1 className="text-xl font-bold">Obsidian Elite Admin</h1>
            <p className="text-xs text-gray-400">
              {selectedTournament ? selectedTournament.name : 'No tournament selected'}
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <Link href="/admin/tournaments" className="text-indigo-400 hover:text-indigo-300">
              Tournaments
            </Link>
            <Link href="/admin/posts" className="text-indigo-400 hover:text-indigo-300">
              Posts
            </Link>
            {isAppAdmin && (
              <Link href="/admin/users" className="text-indigo-400 hover:text-indigo-300">
                Users
              </Link>
            )}
            <Link href="/" className="text-gray-300 hover:text-white">
              View public site
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-4 pt-8 sm:px-6 lg:px-8">
        <StatusBanner status={status} />

        {tournaments.length === 0 ? (
          <section className="rounded-xl border border-white/5 bg-[#1e293b] p-8 text-center">
            <h2 className="text-lg font-semibold">No tournaments yet</h2>
            <p className="mt-2 text-sm text-gray-400">
              Create the first tournament edition to start registering teams and scheduling
              fixtures.
            </p>
            <Link
              href="/admin/tournaments"
              className="mt-5 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Manage tournaments
            </Link>
          </section>
        ) : (
          <>
            <section data-tour="admin-tournament-picker" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="w-full md:max-w-md">
                  <label
                    htmlFor="tournament-selector"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400"
                  >
                    Working tournament
                  </label>
                  <select
                    id="tournament-selector"
                    value={selectedTournamentId}
                    onChange={(event) => setSelectedTournamentId(event.target.value)}
                    className={adminInputClass}
                  >
                    {tournaments.map((tournament) => (
                      <option key={tournament.id} value={tournament.id}>
                        {tournament.name}
                        {tournament.edition ? ` — ${tournament.edition}` : ''}
                        {tournament.is_active ? ' (active)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-gray-400">
                  {memberships.length > 0
                    ? `Your scope: ${memberships
                        .map(
                          (membership) => membership.tournament_name || membership.tournament_slug
                        )
                        .join(', ')}`
                    : 'App admin — full access to every tournament.'}
                </p>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <section data-tour="admin-team-form" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
                <h2 className="mb-4 text-lg font-semibold">Register a team</h2>
                <form onSubmit={handleCreateTeam} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Team name">
                      <TextInput
                        required
                        placeholder="e.g. Crimson Kings"
                        value={teamForm.name}
                        onValueChange={(value) => setTeamForm({ ...teamForm, name: value })}
                      />
                    </Field>
                    <Field label="Short name">
                      <TextInput
                        maxLength={5}
                        placeholder="e.g. CK"
                        value={teamForm.short_name}
                        onValueChange={(value) => setTeamForm({ ...teamForm, short_name: value })}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Field label="Category">
                      <SelectInput
                        value={teamForm.category}
                        options={CATEGORY_OPTIONS}
                        onValueChange={(value) => setTeamForm({ ...teamForm, category: value })}
                      />
                    </Field>
                    <Field label="Sport">
                      <SelectInput
                        value={teamForm.team_type}
                        options={sportOptions}
                        onValueChange={(value) => setTeamForm({ ...teamForm, team_type: value })}
                      />
                    </Field>
                    <Field label="Group">
                      <TextInput
                        placeholder="e.g. Group A"
                        value={teamForm.group_name}
                        onValueChange={(value) => setTeamForm({ ...teamForm, group_name: value })}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Head coach">
                      <TextInput
                        value={teamForm.coach}
                        onValueChange={(value) => setTeamForm({ ...teamForm, coach: value })}
                      />
                    </Field>
                    <Field label="Attire colour">
                      <SelectInput
                        value={teamForm.attire_color}
                        options={ATTIRE_OPTIONS}
                        onValueChange={(value) => setTeamForm({ ...teamForm, attire_color: value })}
                      />
                    </Field>
                    <Field label="Assistant coach">
                      <TextInput
                        value={teamForm.assistant_coach}
                        onValueChange={(value) =>
                          setTeamForm({ ...teamForm, assistant_coach: value })
                        }
                      />
                    </Field>
                    <Field label="Tactical coach">
                      <TextInput
                        value={teamForm.tactical_coach}
                        onValueChange={(value) =>
                          setTeamForm({ ...teamForm, tactical_coach: value })
                        }
                      />
                    </Field>
                    <Field label="Medical staff">
                      <TextInput
                        value={teamForm.medical_staff}
                        onValueChange={(value) => setTeamForm({ ...teamForm, medical_staff: value })}
                      />
                    </Field>
                    <Field label="Kit &amp; water personnel">
                      <TextInput
                        value={teamForm.kit_personnel}
                        onValueChange={(value) => setTeamForm({ ...teamForm, kit_personnel: value })}
                      />
                    </Field>
                  </div>

                  <div>
                    <p className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Squad checklist
                    </p>
                    <RosterEditor
                      rows={rosterRows}
                      onChange={setRosterRows}
                      disabled={busy}
                      addLabel="Add player"
                      emptyLabel="No players yet — add each player name with their shirt number."
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Each line is a player: type the name, the shirt number, then press
                      &ldquo;Add player&rdquo;. The list can be edited and reordered after the team
                      is saved.
                    </p>
                  </div>

                  <button type="submit" disabled={busy} className={adminPrimaryButton}>
                    {busy ? 'Saving…' : 'Register team'}
                  </button>
                </form>
              </section>

              <section data-tour="admin-fixture-form" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
                <h2 className="mb-4 text-lg font-semibold">Schedule a fixture</h2>
                <form onSubmit={handleCreateFixture} className="space-y-4">
                  <Field label="Home team">
                    <SearchableSelect
                      options={teams.map((team) => ({ id: team.id, name: team.name }))}
                      value={fixtureForm.home_team_id}
                      onChange={(value) => setFixtureForm({ ...fixtureForm, home_team_id: value })}
                      placeholder="Select home team"
                    />
                  </Field>
                  <Field label="Away team">
                    <SearchableSelect
                      options={teams.map((team) => ({ id: team.id, name: team.name }))}
                      value={fixtureForm.away_team_id}
                      onChange={(value) => setFixtureForm({ ...fixtureForm, away_team_id: value })}
                      placeholder="Select away team"
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Kick-off">
                      <input
                        type="datetime-local"
                        required
                        className={adminInputClass}
                        value={fixtureForm.match_date}
                        onChange={(event) =>
                          setFixtureForm({ ...fixtureForm, match_date: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Stage">
                      <SelectInput
                        value={fixtureForm.stage}
                        options={STAGE_OPTIONS}
                        onValueChange={(value) => setFixtureForm({ ...fixtureForm, stage: value })}
                      />
                    </Field>
                  </div>
                  <Field label="Venue">
                    <TextInput
                      placeholder="e.g. Nnamdi Azikiwe Stadium"
                      value={fixtureForm.venue}
                      onValueChange={(value) => setFixtureForm({ ...fixtureForm, venue: value })}
                    />
                  </Field>
                  <button type="submit" disabled={busy} className={adminPrimaryButton}>
                    {busy ? 'Saving…' : 'Schedule fixture'}
                  </button>
                </form>
              </section>
            </div>

<section data-tour="admin-fixture-list" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Fixtures ({fixtures.length})</h2>
                <span className="text-xs text-gray-400">
                  {loading ? 'Refreshing…' : 'Up to date'}
                </span>
              </div>
              {fixtures.length === 0 ? (
                <p className="text-sm text-gray-500">No fixtures scheduled for this tournament.</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {fixtures.map((fixture) => (
                    <li key={fixture.id} className="py-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-medium">
                            {fixture.home_team?.name ?? 'TBD'} vs {fixture.away_team?.name ?? 'TBD'}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            {new Date(fixture.match_date).toLocaleString()} &bull; {fixture.status}
                            {fixture.stage ? ` • ${fixture.stage.replace(/_/g, ' ')}` : ''} &bull;{' '}
                            {fixture.home_score ?? 0}-{fixture.away_score ?? 0}
                            {fixture.venue ? ` • ${fixture.venue}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/match/${fixture.id}`}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                          >
                            Manage match
                          </Link>
                          <button
                            type="button"
                            onClick={() => beginFixtureEdit(fixture)}
                            className={adminSubtleButton}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteFixture(fixture)}
                            disabled={busy}
                            className={
                              confirmId === fixture.id
                                ? 'rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white'
                                : adminSubtleButton
                            }
                          >
                            {confirmId === fixture.id ? 'Confirm delete' : 'Delete'}
                          </button>
                        </div>
                      </div>

                      {editingFixtureId === fixture.id && (
                        <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-[#0f172a] p-4 md:grid-cols-3">
                          <Field label="Kick-off">
                            <input
                              type="datetime-local"
                              className={adminInputClass}
                              value={fixtureDraft.match_date}
                              onChange={(event) =>
                                setFixtureDraft({
                                  ...fixtureDraft,
                                  match_date: event.target.value,
                                })
                              }
                            />
                          </Field>
                          <Field label="Venue">
                            <TextInput
                              value={fixtureDraft.venue}
                              onValueChange={(value) =>
                                setFixtureDraft({ ...fixtureDraft, venue: value })
                              }
                            />
                          </Field>
                          <Field label="Stage">
                            <SelectInput
                              value={fixtureDraft.stage}
                              options={STAGE_OPTIONS}
                              onValueChange={(value) =>
                                setFixtureDraft({ ...fixtureDraft, stage: value })
                              }
                            />
                          </Field>
                          <div className="flex gap-2 md:col-span-3">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleSaveFixtureEdit(fixture.id)}
                              className={adminPrimaryButton}
                            >
                              Save changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingFixtureId(null)}
                              className={adminSubtleButton}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

<section data-tour="admin-team-list" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Teams ({teams.length})</h2>
                <span className="text-xs text-gray-400">
                  Squad sizes are counted from the players table.
                </span>
              </div>
              {teams.length === 0 ? (
                <p className="text-sm text-gray-500">No teams registered for this tournament yet.</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {teams.map((team) => (
                    <li key={team.id} className="py-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-medium">
                            {team.name}{' '}
                            <span className="text-gray-500">({team.short_name ?? '—'})</span>
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            {team.category ?? 'Male'} &bull; {team.team_type ?? 'Football'}
                            {team.group_name ? ` • ${team.group_name}` : ''} &bull; Coach:{' '}
                            {team.coach || '—'} &bull; Squad: {playerCounts[team.id] ?? 0}
                            {team.tournament_id ? '' : ' • legacy (unscoped)'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => beginTeamEdit(team)}
                            className={adminSubtleButton}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTeam(team)}
                            disabled={busy}
                            className={
                              confirmId === team.id
                                ? 'rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white'
                                : adminSubtleButton
                            }
                          >
                            {confirmId === team.id ? 'Confirm delete' : 'Delete'}
                          </button>
                        </div>
                      </div>

                      {editingTeamId === team.id && (
                        <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-[#0f172a] p-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <Field label="Team name">
                              <TextInput
                                value={teamDraft.name}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, name: value })
                                }
                              />
                            </Field>
                            <Field label="Short name">
                              <TextInput
                                maxLength={5}
                                value={teamDraft.short_name}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, short_name: value })
                                }
                              />
                            </Field>
                            <Field label="Group">
                              <TextInput
                                value={teamDraft.group_name}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, group_name: value })
                                }
                              />
                            </Field>
                            <Field label="Category">
                              <SelectInput
                                value={teamDraft.category}
                                options={CATEGORY_OPTIONS}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, category: value })
                                }
                              />
                            </Field>
                            <Field label="Sport">
                              <SelectInput
                                value={teamDraft.team_type}
                                options={sportOptions}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, team_type: value })
                                }
                              />
                            </Field>
                            <Field label="Attire colour">
                              <SelectInput
                                value={teamDraft.attire_color}
                                options={ATTIRE_OPTIONS}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, attire_color: value })
                                }
                              />
                            </Field>
                          </div>

<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <Field label="Head coach">
                              <TextInput
                                value={teamDraft.coach}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, coach: value })
                                }
                              />
                            </Field>
                            <Field label="Assistant coach">
                              <TextInput
                                value={teamDraft.assistant_coach}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, assistant_coach: value })
                                }
                              />
                            </Field>
                            <Field label="Tactical coach">
                              <TextInput
                                value={teamDraft.tactical_coach}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, tactical_coach: value })
                                }
                              />
                            </Field>
                            <Field label="Medical staff">
                              <TextInput
                                value={teamDraft.medical_staff}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, medical_staff: value })
                                }
                              />
                            </Field>
                            <Field label="Kit &amp; water personnel">
                              <TextInput
                                value={teamDraft.kit_personnel}
                                onValueChange={(value) =>
                                  setTeamDraft({ ...teamDraft, kit_personnel: value })
                                }
                              />
                            </Field>
                          </div>

                          <p className="text-xs text-gray-400">
                            Squad members are managed line by line below — the team sheet
                            (<code>teams.roster</code>) is regenerated automatically from the
                            checklist.
                          </p>

                          <TeamRosterManager
                            teamId={team.id}
                            tournamentId={selectedTournamentId}
                            players={players.filter((player) => player.team_id === team.id)}
                            onChanged={refreshTournament}
                          />

                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleSaveTeamEdit(team.id)}
                              className={adminPrimaryButton}
                            >
                              Save team
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingTeamId(null)}
                              className={adminSubtleButton}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

<section data-tour="admin-settings" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
              <h2 className="mb-4 text-lg font-semibold">Tournament settings</h2>
              <form onSubmit={handleSaveSettings} className="space-y-4">
                <Field label="Format">
                  <SelectInput
                    value={settingsForm.format}
                    onValueChange={(value) => setSettingsForm({ ...settingsForm, format: value })}
                    options={[
                      { value: 'league', label: 'League' },
                      { value: 'knockouts', label: 'Knockouts' },
                      { value: 'group_to_knockout', label: 'Group stage to knockout' },
                    ]}
                  />
                </Field>
                <Field label="Table arrangement">
                  <textarea
                    rows={3}
                    className={adminInputClass}
                    placeholder="e.g. Group A: Team 1, Team 2… Group B…"
                    value={settingsForm.table_arrangement}
                    onChange={(event) =>
                      setSettingsForm({ ...settingsForm, table_arrangement: event.target.value })
                    }
                  />
                </Field>
                <Field label="Rules and code of conduct">
                  <textarea
                    rows={5}
                    className={adminInputClass}
                    placeholder="Official tournament rules…"
                    value={settingsForm.rules}
                    onChange={(event) =>
                      setSettingsForm({ ...settingsForm, rules: event.target.value })
                    }
                  />
                </Field>
                <button type="submit" disabled={busy} className={adminPrimaryButton}>
                  {busy ? 'Saving…' : 'Save settings'}
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  )
}