'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

/** Public team card shape (subset of `teams` used by the explorer). */
export interface TeamRow {
  id: string
  name: string
  short_name: string | null
  attire_color: string | null
  category: string | null
  team_type: string | null
  group_name: string | null
}

const FIELD_CLASSES =
  'bg-[#1e293b] border border-white/10 rounded-lg py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors'

const sortValues = (values: string[]) => values.sort((a, b) => a.localeCompare(b))

const collectValues = (teams: TeamRow[], pick: (team: TeamRow) => string | null) =>
  sortValues(
    Array.from(
      new Set(
        teams
          .map(pick)
          .filter((value): value is string => Boolean(value && value.trim().length > 0))
      )
    )
  )

export function TeamsExplorer({ teams }: { teams: TeamRow[] }) {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')

  const categoryOptions = useMemo(() => collectValues(teams, (team) => team.category), [teams])
  const typeOptions = useMemo(() => collectValues(teams, (team) => team.team_type), [teams])
  const groupOptions = useMemo(() => collectValues(teams, (team) => team.group_name), [teams])

  const filteredTeams = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return teams.filter((team) => {
      if (categoryFilter !== 'all' && (team.category ?? '') !== categoryFilter) return false
      if (typeFilter !== 'all' && (team.team_type ?? '') !== typeFilter) return false
      if (groupFilter !== 'all' && (team.group_name ?? '') !== groupFilter) return false
      if (!needle) return true
      return team.name.toLowerCase().includes(needle) || (team.short_name ?? '').toLowerCase().includes(needle)
    })
  }, [categoryFilter, groupFilter, query, teams, typeFilter])

  const filtersActive = query.trim().length > 0 || categoryFilter !== 'all' || typeFilter !== 'all' || groupFilter !== 'all'

  const clearFilters = () => {
    setQuery('')
    setCategoryFilter('all')
    setTypeFilter('all')
    setGroupFilter('all')
  }

  return (
    <div className="space-y-8">
      <div className="bg-[#1e293b] rounded-xl border border-white/5 p-4 sm:p-6 flex flex-col xl:flex-row xl:items-center gap-4">
        <div className="relative flex-1">
          <svg
            className="w-4 h-4 text-gray-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search teams by name or short name..."
            aria-label="Search teams by name or short name"
            className={`${FIELD_CLASSES} w-full pl-10 pr-4`}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filter teams by category"
            className={`${FIELD_CLASSES} px-4`}
          >
            <option value="all">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Filter teams by type"
            className={`${FIELD_CLASSES} px-4`}
          >
            <option value="all">All types</option>
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          {groupOptions.length > 0 ? (
            <select
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
              aria-label="Filter teams by group"
              className={`${FIELD_CLASSES} px-4`}
            >
              <option value="all">All groups</option>
              {groupOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-gray-400">
          Showing <span className="text-white font-semibold">{filteredTeams.length}</span> of {teams.length}{' '}
          {teams.length === 1 ? 'team' : 'teams'}
        </p>
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {filteredTeams.length === 0 ? (
        <div className="bg-[#1e293b] rounded-xl p-12 text-center border border-white/5">
          <div className="text-gray-400 text-lg mb-2">
            {teams.length === 0 ? 'No teams found.' : 'No teams match your filters.'}
          </div>
          <p className="text-gray-500 text-sm">
            {teams.length === 0
              ? 'Admins must register teams in the dashboard first.'
              : 'Try a different search term or clear the filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredTeams.map((team) => (
            <Link href={`/team/${team.id}`} key={team.id} className="block h-full">
              <div className="bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 shadow-xl hover:border-indigo-500/50 hover:shadow-indigo-900/20 transition-all group h-full flex flex-col">
                <div
                  className="h-24 w-full flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity"
                  style={{
                    backgroundColor:
                      !team.attire_color || team.attire_color === 'Yet to be decided' ? '#334155' : team.attire_color,
                  }}
                >
                  <span className="text-3xl font-black text-white/50 group-hover:text-white/80">{team.short_name}</span>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <h2 className="font-bold text-xl mb-1 group-hover:text-indigo-300 transition-colors">{team.name}</h2>
                  <div className="flex flex-wrap items-center gap-2 mt-auto pt-4">
                    <span className="text-xs font-medium bg-gray-800 text-gray-300 px-2 py-1 rounded border border-gray-700">
                      {team.category || 'Male'}
                    </span>
                    <span className="text-xs font-medium bg-gray-800 text-gray-300 px-2 py-1 rounded border border-gray-700">
                      {team.team_type || 'Football'}
                    </span>
                    {team.group_name ? (
                      <span className="text-xs font-medium bg-indigo-500/15 text-indigo-300 px-2 py-1 rounded border border-indigo-500/30">
                        {team.group_name}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}