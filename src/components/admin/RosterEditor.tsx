'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  adminInputClass,
  adminPrimaryButton,
  adminSubtleButton,
} from '@/components/admin/AdminWidgets'

/**
 * Roster editors.
 *
 * Two pieces:
 *   * `RosterEditor` — a pure checklist UI: one row per athlete with a name box,
 *     a shirt-number box, a remove button and an "add" button at the bottom.
 *     Used inside the "register a team" form before the team exists.
 *   * `TeamRosterManager` — the same UI wired to the `players` table so every
 *     line can be created, renamed, renumbered or deleted after the fact. It
 *     also keeps `teams.roster` (the CSV the public line-up tab reads) in sync.
 */

export interface RosterDraftRow {
  /** Stable React key (persisted rows reuse the player id). */
  key: string
  /** `players.id` once the row exists in the database. */
  id?: string
  name: string
  jersey_number: string
}

export function makeRosterRow(row: Partial<RosterDraftRow> = {}): RosterDraftRow {
  return {
    key: row.key ?? row.id ?? `new-${Math.random().toString(36).slice(2)}`,
    id: row.id,
    name: row.name ?? '',
    jersey_number: row.jersey_number ?? '',
  }
}

/** `''` → `null` so the DB stores no awkward placeholder numbers. */
const toJerseyNumber = (value: string): number | null => {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

interface RosterEditorProps {
  rows: RosterDraftRow[]
  onChange: (rows: RosterDraftRow[]) => void
  disabled?: boolean
  emptyLabel?: string
  addLabel?: string
}

/**
 * Pure checklist editor (no persistence): name box + number box per line, an
 * add button and a remove button. Rows can be reordered so the order matches
 * the coach's sheet.
 */
export function RosterEditor({
  rows,
  onChange,
  disabled = false,
  emptyLabel = 'No players yet — add the first one below.',
  addLabel = 'Add player',
}: RosterEditorProps) {
  const replace = (key: string, patch: Partial<RosterDraftRow>) =>
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
          {rows.length} {rows.length === 1 ? 'player' : 'players'} on the sheet
        </span>
        <span>Name &amp; shirt number</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-gray-500">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.key} className="flex flex-wrap items-center gap-2">
              <span className="w-6 shrink-0 text-center text-xs font-semibold text-gray-500">
                {index + 1}
              </span>
              <input
                type="text"
                aria-label={`Player ${index + 1} name`}
                placeholder="Player name"
                className={adminInputClass + ' min-w-[10rem] flex-1'}
                value={row.name}
                disabled={disabled}
                onChange={(event) => replace(row.key, { name: event.target.value })}
              />
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                aria-label={`Player ${index + 1} shirt number`}
                placeholder="#"
                className={adminInputClass + ' w-20 text-center'}
                value={row.jersey_number}
                disabled={disabled}
                onChange={(event) => replace(row.key, { jersey_number: event.target.value })}
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${row.name || 'player'} up`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  className={adminSubtleButton + ' px-2'}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.name || 'player'} down`}
                  disabled={disabled || index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  className={adminSubtleButton + ' px-2'}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${row.name || 'player'}`}
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
        onClick={() => onChange([...rows, makeRosterRow()])}
        className={adminSubtleButton}
      >
        + {addLabel}
      </button>
    </div>
  )
}

export interface PlayerRow {
  id: string
  team_id: string
  name: string
  jersey_number: number | null
}

interface TeamRosterManagerProps {
  teamId: string
  tournamentId: string
  players: PlayerRow[]
  /** Called after a successful write so the parent can refresh its lists. */
  onChanged: () => Promise<void> | void
}

/**
 * Persisted roster checklist for one team.
 *
 * Every line is fully CRUDable against `players`:
 *   * **Create** — fill the name + shirt number and press *Add player*.
 *   * **Read** — the current squad is listed with its numbers.
 *   * **Update** — edit a name/number and press *Save* on that row.
 *   * **Delete** — press *Remove*, then confirm.
 *
 * After each write `teams.roster` (the comma-separated mirror the public
 * line-up tab reads) is regenerated, so both views stay consistent.
 */
export function TeamRosterManager({
  teamId,
  tournamentId,
  players,
  onChanged,
}: TeamRosterManagerProps) {
  const supabase = useMemo(() => createClient(), [])
  const [drafts, setDrafts] = useState<Record<string, { name: string; jersey_number: string }>>({})
  const [newRow, setNewRow] = useState({ name: '', jersey_number: '' })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const sorted = [...players].sort((a, b) => {
    const left = a.jersey_number ?? Number.MAX_SAFE_INTEGER
    const right = b.jersey_number ?? Number.MAX_SAFE_INTEGER
    return left - right || a.name.localeCompare(b.name)
  })

  const draftFor = (player: PlayerRow) =>
    drafts[player.id] ?? {
      name: player.name,
      jersey_number: player.jersey_number ? String(player.jersey_number) : '',
    }

  const isDirty = (player: PlayerRow) => {
    const draft = drafts[player.id]
    if (!draft) return false
    return (
      draft.name !== player.name ||
      draft.jersey_number !== (player.jersey_number ? String(player.jersey_number) : '')
    )
  }

  const updateDraft = (player: PlayerRow, patch: Partial<{ name: string; jersey_number: string }>) =>
    setDrafts((current) => ({ ...current, [player.id]: { ...draftFor(player), ...patch } }))

  /** Regenerate the CSV mirror on `teams.roster` (used by the public line-up tab). */
  const syncRosterCsv = async () => {
    const { data } = await supabase
      .from('players')
      .select('id, name, jersey_number')
      .eq('team_id', teamId)

    const names = ((Array.isArray(data) ? data : []) as PlayerRow[])
      .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999))
      .map((player) => player.name.trim())
      .filter(Boolean)

    await supabase.from('teams').update({ roster: names.join(', ') }).eq('id', teamId)
  }

  const addPlayer = async () => {
    const name = newRow.name.trim()
    if (!name) {
      setMessage({ kind: 'error', message: 'Enter the player name before adding.' })
      return
    }

    setBusy(true)
    const { error } = await supabase.from('players').insert({
      team_id: teamId,
      tournament_id: tournamentId,
      name,
      jersey_number: toJerseyNumber(newRow.jersey_number),
    })

    if (!error) {
      setNewRow({ name: '', jersey_number: '' })
      await syncRosterCsv()
      await onChanged()
    }
    setBusy(false)

    setMessage(
      error
        ? { kind: 'error', message: `Could not add the player: ${error.message}` }
        : { kind: 'success', message: `${name} added to the squad.` }
    )
  }

  const savePlayer = async (player: PlayerRow) => {
    const draft = draftFor(player)
    const name = draft.name.trim()
    if (!name) {
      setMessage({ kind: 'error', message: 'A player needs a name.' })
      return
    }

    setBusy(true)
    const { error } = await supabase
      .from('players')
      .update({ name, jersey_number: toJerseyNumber(draft.jersey_number) })
      .eq('id', player.id)

    if (!error) {
      setDrafts((current) => {
        const next = { ...current }
        delete next[player.id]
        return next
      })
      await syncRosterCsv()
      await onChanged()
    }
    setBusy(false)

    setMessage(
      error
        ? { kind: 'error', message: `Could not save the player: ${error.message}` }
        : { kind: 'success', message: 'Player updated.' }
    )
  }

  const removePlayer = async (player: PlayerRow) => {
    if (confirmId !== player.id) {
      setConfirmId(player.id)
      return
    }

    setBusy(true)
    const { error } = await supabase.from('players').delete().eq('id', player.id)
    setConfirmId(null)

    if (!error) {
      await syncRosterCsv()
      await onChanged()
    }
    setBusy(false)

    setMessage(
      error
        ? { kind: 'error', message: `Could not remove the player: ${error.message}` }
        : { kind: 'success', message: 'Player removed.' }
    )
  }

return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-[#0f172a] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
          Squad checklist ({players.length})
        </h4>
        {message && (
          <p
            role="status"
            className={
              'text-xs ' + (message.kind === 'success' ? 'text-emerald-300' : 'text-red-300')
            }
          >
            {message.message}
          </p>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-gray-500">
          No players registered yet — add the first one below.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((player) => {
            const draft = draftFor(player)
            const dirty = isDirty(player)
            return (
              <li key={player.id} className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={999}
                  aria-label={`Shirt number for ${player.name}`}
                  placeholder="#"
                  className={adminInputClass + ' w-20 text-center'}
                  value={draft.jersey_number}
                  disabled={busy}
                  onChange={(event) => updateDraft(player, { jersey_number: event.target.value })}
                />
                <input
                  type="text"
                  aria-label={`Name for shirt ${draft.jersey_number || 'unassigned'}`}
                  placeholder="Player name"
                  className={adminInputClass + ' min-w-[10rem] flex-1'}
                  value={draft.name}
                  disabled={busy}
                  onChange={(event) => updateDraft(player, { name: event.target.value })}
                />
                <div className="flex items-center gap-1">
                  {dirty && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void savePlayer(player)}
                      className={adminPrimaryButton + ' px-3 py-1.5 text-xs'}
                    >
                      Save
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removePlayer(player)}
                    className={
                      confirmId === player.id
                        ? 'rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white'
                        : adminSubtleButton + ' text-red-300'
                    }
                  >
                    {confirmId === player.id ? 'Confirm' : 'Remove'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          aria-label="New player shirt number"
          placeholder="#"
          className={adminInputClass + ' w-20 text-center'}
          value={newRow.jersey_number}
          disabled={busy}
          onChange={(event) => setNewRow({ ...newRow, jersey_number: event.target.value })}
        />
        <input
          type="text"
          aria-label="New player name"
          placeholder="New player name"
          className={adminInputClass + ' min-w-[10rem] flex-1'}
          value={newRow.name}
          disabled={busy}
          onChange={(event) => setNewRow({ ...newRow, name: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void addPlayer()
            }
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void addPlayer()}
          className={adminSubtleButton}
        >
          + Add player
        </button>
      </div>
    </div>
  )
}