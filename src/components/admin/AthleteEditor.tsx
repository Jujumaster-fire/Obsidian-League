'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  adminInputClass,
  adminPrimaryButton,
  adminSubtleButton,
} from '@/components/admin/AdminWidgets'

/**
 * Athlete editors.
 *
 * Two pieces mirroring RosterEditor's pattern:
 *   * `AthleteEditor` — pure checklist UI for the "register athletes" flow
 *     before an athlete row exists in the database.
 *   * `TournamentAthletesManager` — same checklist wired to the `athletes`
 *     table so every line is fully CRUDable (add, edit, remove).
 */

export interface AthleteDraftRow {
  key: string
  id?: string
  name: string
  gender: 'male' | 'female' | 'mixed'
  classification: string
  team_id: string
  sport_id: string
}

export function makeAthleteRow(row: Partial<AthleteDraftRow> = {}): AthleteDraftRow {
  return {
    key: row.key ?? row.id ?? `new-${Math.random().toString(36).slice(2)}`,
    id: row.id,
    name: row.name ?? '',
    gender: (row.gender as AthleteDraftRow['gender']) ?? 'mixed',
    classification: row.classification ?? '',
    team_id: row.team_id ?? '',
    sport_id: row.sport_id ?? '',
  }
}

interface AthleteEditorProps {
  rows: AthleteDraftRow[]
  onChange: (rows: AthleteDraftRow[]) => void
  disabled?: boolean
  teamOptions?: { id: string; name: string }[]
  sportOptions?: { id: string; name: string }[]
  emptyLabel?: string
  addLabel?: string
}

/** Pure checklist editor: name, gender, classification, team, sport per row. */
export function AthleteEditor({
  rows,
  onChange,
  disabled = false,
  teamOptions = [],
  sportOptions = [],
  emptyLabel = 'No athletes yet — add the first one below.',
  addLabel = 'Add athlete',
}: AthleteEditorProps) {
  const replace = (key: string, patch: Partial<AthleteDraftRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key))

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {rows.length} {rows.length === 1 ? 'athlete' : 'athletes'} on the sheet
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-gray-500">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.key} className="flex flex-wrap items-start gap-2">
              <span className="w-6 shrink-0 pt-6 text-center text-xs font-semibold text-gray-500">
                {index + 1}
              </span>

              <input
                type="text"
                aria-label={`Athlete ${index + 1} name`}
                placeholder="Name"
                className={adminInputClass + ' min-w-[8rem] flex-1'}
                value={row.name}
                disabled={disabled}
                onChange={(e) => replace(row.key, { name: e.target.value })}
              />

              <select
                aria-label={`Gender for athlete ${index + 1}`}
                className={adminInputClass + ' w-28'}
                value={row.gender}
                disabled={disabled}
                onChange={(e) => replace(row.key, { gender: e.target.value as AthleteDraftRow['gender'] })}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="mixed">Mixed</option>
              </select>

              <input
                type="text"
                aria-label={`Classification (e.g. T13, PTWC) for athlete ${index + 1}`}
                placeholder="Classification"
                className={adminInputClass + ' w-28'}
                value={row.classification}
                disabled={disabled}
                onChange={(e) => replace(row.key, { classification: e.target.value })}
              />

              <select
                aria-label={`Team for athlete ${index + 1}`}
                className={adminInputClass + ' w-36'}
                value={row.team_id}
                disabled={disabled}
                onChange={(e) => replace(row.key, { team_id: e.target.value })}
              >
                <option value="">No team</option>
                {teamOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <select
                aria-label={`Sport for athlete ${index + 1}`}
                className={adminInputClass + ' w-36'}
                value={row.sport_id}
                disabled={disabled}
                onChange={(e) => replace(row.key, { sport_id: e.target.value })}
              >
                <option value="">Select sport</option>
                {sportOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${row.name || 'athlete'} up`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  className={adminSubtleButton + ' px-2'}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.name || 'athlete'} down`}
                  disabled={disabled || index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  className={adminSubtleButton + ' px-2'}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${row.name || 'athlete'}`}
                  disabled={disabled}
                  onClick={() => remove(row.key)}
                  className={adminSubtleButton + ' px-2 text-red-300'}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, makeAthleteRow()])}
        className={adminSubtleButton}
      >
        + {addLabel}
      </button>
    </div>
  )
}

export interface AthleteRow {
  id: string
  tournament_id: string
  name: string
  gender: string
  classification: string | null
  team_id: string | null
  sport_id: string | null
}

interface TournamentAthletesManagerProps {
  tournamentId: string
  athletes: AthleteRow[]
  /** Called after a successful write so the parent can refresh its lists. */
  onChanged: () => Promise<void> | void
}

/**
 * Persisted athlete checklist for one tournament.
 *
 * Mirrors the `RosterEditor` / `TeamRosterManager` pattern: add, rename, reclassify
 * or delete each line, with the UI updating the database directly.
 */
export function TournamentAthletesManager({
  tournamentId,
  athletes,
  onChanged,
}: TournamentAthletesManagerProps) {
  const supabase = useMemo(() => createClient(), [])
  const [drafts, setDrafts] = useState<Record<string, { name: string; gender: string; classification: string }>>({})
  const [newRow, setNewRow] = useState({ name: '', gender: 'mixed' as 'male' | 'female' | 'mixed', classification: '' })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const draftFor = (athlete: AthleteRow) =>
    drafts[athlete.id] ?? {
      name: athlete.name,
      gender: athlete.gender ?? 'mixed',
      classification: athlete.classification ?? '',
    }

  const isDirty = (athlete: AthleteRow) => {
    const d = drafts[athlete.id]
    if (!d) return false
    return d.name !== athlete.name || d.gender !== (athlete.gender ?? 'mixed') || d.classification !== (athlete.classification ?? '')
  }

  const updateDraft = (athlete: AthleteRow, patch: Partial<{ name: string; gender: string; classification: string }>) =>
    setDrafts((current) => ({ ...current, [athlete.id]: { ...draftFor(athlete), ...patch } }))

  const addAthlete = async () => {
    const name = newRow.name.trim()
    if (!name) {
      setMessage({ kind: 'error', message: 'Enter the athlete name before adding.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('create_athlete', {
      p_tournament_id: tournamentId,
      p_name: name,
      p_gender: newRow.gender,
      p_classification: newRow.classification.trim() || null,
    })
    setBusy(false)
    if (!error) {
      setNewRow({ name: '', gender: 'mixed', classification: '' })
      await onChanged()
    }
    setMessage(
      error
        ? { kind: 'error', message: `Could not add athlete: ${error.message}` }
        : { kind: 'success', message: `${name} added.` }
    )
  }

  const saveAthlete = async (athlete: AthleteRow) => {
    const draft = draftFor(athlete)
    if (!draft.name.trim()) {
      setMessage({ kind: 'error', message: 'An athlete needs a name.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('update_athlete', {
      p_athlete_id: athlete.id,
      p_name: draft.name.trim(),
      p_gender: draft.gender,
      p_classification: draft.classification.trim() || null,
    })
    setBusy(false)
    if (!error) {
      setDrafts((current) => { const n = { ...current }; delete n[athlete.id]; return n })
      await onChanged()
    }
    setMessage(
      error
        ? { kind: 'error', message: `Could not save: ${error.message}` }
        : { kind: 'success', message: 'Athlete updated.' }
    )
  }

  const removeAthlete = async (athlete: AthleteRow) => {
    if (confirmId !== athlete.id) { setConfirmId(athlete.id); return }
    setBusy(true)
    const { error } = await supabase.rpc('delete_athlete', { p_athlete_id: athlete.id })
    setConfirmId(null)
    setBusy(false)
    if (!error) await onChanged()
    setMessage(
      error
        ? { kind: 'error', message: `Could not remove: ${error.message}` }
        : { kind: 'success', message: 'Athlete removed.' }
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-[#0f172a] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
          Athletes ({athletes.length})
        </h4>
        {message && (
          <p role="status" className={'text-xs ' + (message.kind === 'success' ? 'text-emerald-300' : 'text-red-300')}>
            {message.message}
          </p>
        )}
      </div>

      {athletes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-gray-500">
          No athletes registered yet — add the first one below.
        </p>
      ) : (
        <ul className="space-y-2">
          {athletes.map((athlete) => {
            const draft = draftFor(athlete)
            const dirty = isDirty(athlete)
            return (
              <li key={athlete.id} className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label={`Name for ${athlete.name}`}
                  placeholder="Name"
                  className={adminInputClass + ' min-w-[8rem] flex-1'}
                  value={draft.name}
                  disabled={busy}
                  onChange={(e) => updateDraft(athlete, { name: e.target.value })}
                />
                <select
                  aria-label={`Gender for ${athlete.name}`}
                  className={adminInputClass + ' w-24'}
                  value={draft.gender}
                  disabled={busy}
                  onChange={(e) => updateDraft(athlete, { gender: e.target.value })}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="mixed">Mixed</option>
                </select>
                <input
                  type="text"
                  aria-label={`Classification for ${athlete.name}`}
                  placeholder="Classification"
                  className={adminInputClass + ' w-28'}
                  value={draft.classification}
                  disabled={busy}
                  onChange={(e) => updateDraft(athlete, { classification: e.target.value })}
                />
                <div className="flex items-center gap-1">
                  {dirty && (
                    <button type="button" disabled={busy} onClick={() => void saveAthlete(athlete)} className={adminPrimaryButton + ' px-3 py-1.5 text-xs'}>
                      Save
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => void removeAthlete(athlete)} className={confirmId === athlete.id ? 'rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white' : adminSubtleButton + ' text-red-300'}>
                    {confirmId === athlete.id ? 'Confirm' : 'Remove'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <input
          type="text"
          aria-label="New athlete name"
          placeholder="Athlete name"
          className={adminInputClass + ' min-w-[8rem] flex-1'}
          value={newRow.name}
          disabled={busy}
          onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addAthlete() } }}
        />
        <select
          aria-label="Gender"
          className={adminInputClass + ' w-24'}
          value={newRow.gender}
          disabled={busy}
          onChange={(e) => setNewRow({ ...newRow, gender: e.target.value as 'male' | 'female' | 'mixed' })}
        >
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="mixed">Mixed</option>
        </select>
        <input
          type="text"
          aria-label="Classification"
          placeholder="Classification"
          className={adminInputClass + ' w-28'}
          value={newRow.classification}
          disabled={busy}
          onChange={(e) => setNewRow({ ...newRow, classification: e.target.value })}
        />
        <button type="button" disabled={busy} onClick={() => void addAthlete()} className={adminSubtleButton}>
          + Add athlete
        </button>
      </div>
    </div>
  )
}
