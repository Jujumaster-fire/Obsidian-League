'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * FormationCanvas — renders ONE team's lineup on its sport's court and lets a
 * duty holder drag the tokens to new positions (PART 15 `fixture_lineups`).
 *
 * Coordinates are stored in a 0..1 unit square (`x` / `y` on
 * `fixture_lineups`), so the same rows render at any pixel size and the drag
 * handler only ever emits unit-space values.
 *
 * The court shape/orientation comes from the sport's `scoring_config.court`
 * (seeded in PART 12, overridable per fixture through `set_fixture_rules`).
 *
 * With no `onMove` prop the canvas is read-only — that is exactly how the
 * public match page renders it.
 */

export interface FormationSlot {
  id?: string
  slot: number
  player_id: string | null
  athlete_id: string | null
  role: string | null
  x: number
  y: number
  is_captain: boolean
}

export interface FormationPlayer {
  id: string
  name: string
}

export interface CourtConfig {
  shape: 'pitch' | 'court' | 'pool' | 'track' | 'none'
  orientation: 'horizontal' | 'vertical'
}

interface FormationCanvasProps {
  court: CourtConfig
  slots: FormationSlot[]
  /** Team name, used for labels and ARIA. */
  teamName: string
  /** Palette accent for this team's tokens. */
  accent: 'home' | 'away'
  players?: FormationPlayer[]
  /** When provided the canvas is editable and drops call back in unit space. */
  onMove?: (slot: FormationSlot, x: number, y: number) => void
  /** When provided, an "Add player" select lets the operator place a token. */
  onAdd?: (playerId: string, x: number, y: number) => void
  onRemove?: (slot: FormationSlot) => void
  onToggleCaptain?: (slot: FormationSlot) => void
  onRoleChange?: (slot: FormationSlot, role: string) => void
  saving?: boolean
}

const nameOf = (slot: FormationSlot, players: FormationPlayer[]): string =>
  slot.player_id
    ? players.find((player) => player.id === slot.player_id)?.name ?? `Player #${slot.slot}`
    : `Athlete #${slot.slot}`

export function FormationCanvas({
  court,
  slots,
  teamName,
  accent,
  players = [],
  onMove,
  onAdd,
  onRemove,
  onToggleCaptain,
  onRoleChange,
  saving = false,
}: FormationCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  /** Slot currently being dragged (pointer events, so touch works too). */
  const [dragging, setDragging] = useState<number | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)

  const vertical = court.orientation === 'vertical'

  const toUnit = useCallback((clientX: number, clientY: number) => {
    const surface = surfaceRef.current
    if (!surface) return null
    const rect = surface.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    return { x, y }
  }, [])

  // While a token is dragged the preview follows the pointer live; the single
  // authoritative write happens on pointer-up.
  useEffect(() => {
    if (dragging === null) return
    const handleMove = (event: PointerEvent) => {
      const next = toUnit(event.clientX, event.clientY)
      if (next) setGhost(next)
    }
    const handleUp = (event: PointerEvent) => {
      const slot = slots.find((entry) => entry.slot === dragging)
      const next = toUnit(event.clientX, event.clientY)
      setDragging(null)
      setGhost(null)
      if (slot && next && onMove) onMove(slot, next.x, next.y)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [dragging, slots, toUnit, onMove])

  const accentClass =
    accent === 'home' ? 'bg-indigo-600 border-indigo-300' : 'bg-sky-600 border-sky-300'
  const editable = Boolean(onMove)
  const surfaceStyle: React.CSSProperties = vertical
    ? { aspectRatio: '68 / 105' }
    : { aspectRatio: '105 / 68' }

  return (
    <div className="space-y-3">
      <div
        ref={surfaceRef}
        role={editable ? 'application' : undefined}
        aria-label={`${teamName} formation on the ${court.shape}`}
        className="relative w-full select-none overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-emerald-900/80 to-emerald-950/80"
        style={surfaceStyle}
      >
        {/* Court markings: halfway line + centre circle, for both orientations. */}
        <div
          className="absolute border border-white/20"
          style={
            vertical
              ? { left: '8%', right: '8%', top: '49%', height: '2%' }
              : { top: '8%', bottom: '8%', left: '49%', width: '2%' }
          }
        />
        <div
          className="absolute rounded-full border border-white/20"
          style={
            vertical
              ? { left: '30%', width: '40%', top: '44%', height: '12%' }
              : { top: '30%', height: '40%', left: '44%', width: '12%' }
          }
        />

        {slots.map((slot) => {
          const isDragging = dragging === slot.slot
          const pos = isDragging && ghost ? ghost : { x: slot.x, y: slot.y }
          const label = nameOf(slot, players)
          return (
            <div
              key={slot.slot}
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold shadow-lg ${accentClass} ${
                editable ? 'cursor-grab touch-none active:cursor-grabbing' : ''
              } ${isDragging ? 'z-10 scale-110' : ''}`}
              title={`${label}${slot.role ? ` · ${slot.role}` : ''}${slot.is_captain ? ' (C)' : ''}`}
              onPointerDown={
                editable
                  ? (event) => {
                      event.preventDefault()
                      setDragging(slot.slot)
                      setGhost({ x: slot.x, y: slot.y })
                    }
                  : undefined
              }
            >
              {slot.is_captain ? 'C' : slot.slot}
            </div>
          )
        })}

        {/* Dashed hint while a token is being dragged. */}
        {editable && dragging !== null && ghost && (
          <div
            style={{
              left: `${ghost.x * 100}%`,
              top: `${ghost.y * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
            className="pointer-events-none absolute h-9 w-9 rounded-full border-2 border-dashed border-white/60"
          />
        )}
      </div>
      {/* Roster editor — only mounted for duty holders on the admin console. */}
      {editable && (
        <div className="space-y-2 text-sm">
          {onAdd && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Add a player to the ${teamName} lineup`}
                className="rounded-lg border border-white/10 bg-[#0f172a] px-3 py-1.5 text-sm"
                defaultValue=""
                onChange={(event) => {
                  const playerId = event.target.value
                  if (!playerId || !onAdd) return
                  // New tokens start at the team's own end of the surface.
                  onAdd(playerId, accent === 'home' ? 0.12 : 0.88, 0.5)
                  event.currentTarget.value = ''
                }}
              >
                <option value="">Add player…</option>
                {players
                  .filter((player) => !slots.some((slot) => slot.player_id === player.id))
                  .map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
              </select>
              {saving && <span className="text-xs text-gray-400">Saving…</span>}
            </div>
          )}

          <ul className="space-y-1">
            {[...slots]
              .sort((a, b) => a.slot - b.slot)
              .map((slot) => {
                const label = nameOf(slot, players)
                return (
                  <li
                    key={slot.slot}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5"
                  >
                    <span className="w-6 text-center text-xs font-bold text-gray-300">
                      {slot.slot}
                    </span>
                    <span className="flex-1 truncate">{label}</span>
                    {onRoleChange && (
                      <input
                        aria-label={`Role for ${label}`}
                        defaultValue={slot.role ?? ''}
                        placeholder="Role"
                        maxLength={80}
                        onBlur={(event) => {
                          if (event.target.value !== (slot.role ?? '')) {
                            onRoleChange(slot, event.target.value)
                          }
                        }}
                        className="w-24 rounded border border-white/10 bg-[#0f172a] px-2 py-0.5 text-xs"
                      />
                    )}
                    {onToggleCaptain && (
                      <button
                        type="button"
                        aria-label={`Toggle captain for ${label}`}
                        onClick={() => onToggleCaptain(slot)}
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          slot.is_captain
                            ? 'bg-amber-400 text-black'
                            : 'bg-white/10 text-gray-300 hover:bg-white/20'
                        }`}
                      >
                        C
                      </button>
                    )}
                    {onRemove && (
                      <button
                        type="button"
                        aria-label={`Remove ${label} from the lineup`}
                        onClick={() => onRemove(slot)}
                        className="rounded px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/20"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                )
              })}
            {slots.length === 0 && (
              <li className="rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-400">
                No lineup yet — add players above, then drag them into position.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}