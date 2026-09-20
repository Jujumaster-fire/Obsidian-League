/**
 * Sport arrangement helpers.
 *
 * Every sport in `public.sports` carries a `scoring_type`
 * (`duel` | `sets` | `bouts` | `race` | `attempts`) plus a `scoring_config`
 * JSONB that PART 10/12 of `supabase/db-setup.sql` normalises to always
 * include a `clock` block and a `medals` block. These helpers turn that JSON
 * into the small typed shapes the live match console and fixture forms
 * render, so period buttons, event types, editable period allocations and
 * medal arrangements are driven by the catalogue instead of hardcoded
 * football rules.
 *
 * A fixture may additionally carry `rules_override` (edited through
 * `set_fixture_rules()` by a score-duty holder) — see
 * `resolveFixtureRules()` below, which is the client mirror of the
 * `fixture_effective_rules()` RPC.
 */

export type ScoringType = 'duel' | 'sets' | 'bouts' | 'race' | 'attempts'

/** How one stat key is entered. `counter` = +1 taps, `value` = a keyed-in number. */
export type StatInput = 'counter' | 'value'

export interface StatOption {
  key: string
  label: string
  /** Optional grouping for the console's rotation rail (e.g. "Shooting"). */
  group?: string
  input?: StatInput
}

/** An event-vocabulary token may carry its own label / group / input. */
export interface EventOption {
  type: string
  label: string
  group?: string
}

/**
 * The 12 legacy football keys, used when a fixture links to no sport (or to a
 * sport whose `stat_vocab` is empty). Mirrors the `c_legacy` fallback inside
 * `fixture_effective_rules()` / `record_stat()`.
 */
export const LEGACY_STAT_VOCAB: StatOption[] = [
  { key: 'passes', label: 'Passes' },
  { key: 'shots', label: 'Shots' },
  { key: 'shots_on_target', label: 'Shots on target' },
  { key: 'shots_off_target', label: 'Shots off target' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'corners', label: 'Corners' },
  { key: 'freekicks', label: 'Free kicks' },
  { key: 'offsides', label: 'Offsides' },
  { key: 'yellow_cards', label: 'Yellow cards' },
  { key: 'red_cards', label: 'Red cards' },
  { key: 'gk_saves', label: 'GK saves' },
  { key: 'interceptions', label: 'Interceptions' },
]

export type ClockType =
  | 'halves'
  | 'quarters'
  | 'rounds'
  | 'sets'
  | 'innings'
  | 'none'

export interface SportClock {
  type: ClockType
  periods: number
  period_minutes: number
  break_minutes?: number
  extra?: { periods: number; period_minutes: number }
}

export interface SportMedals {
  awarded: boolean
  team: boolean
}

/** The playing surface the lineup canvas (PART 15) renders formations on. */
export interface SportCourt {
  shape: 'pitch' | 'court' | 'pool' | 'track' | 'none'
  orientation: 'horizontal' | 'vertical'
}

export interface SportScoringConfig {
  clock?: Partial<SportClock>
  medals?: Partial<SportMedals>
  [key: string]: unknown
}

export interface SportArrangement {
  id: string
  code: string
  name: string
  scoringType: ScoringType
  statVocab: { key: string; label: string }[]
  eventVocab: string[]
  clock: SportClock
  medals: SportMedals
  court: SportCourt
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const toInt = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Parse `scoring_config` into safe, defaulted shapes (never throws). */
export function parseSportArrangement(row: {
  id: string
  code: string
  name: string
  scoring_type?: string | null
  stat_vocab?: unknown
  event_vocab?: unknown
  scoring_config?: unknown
}): SportArrangement {
  const config = asRecord(row.scoring_config)
  const clockRaw = asRecord(config.clock)
  const medalsRaw = asRecord(config.medals)
  const courtRaw = asRecord(config.court)

  const clockType = (
    ['halves', 'quarters', 'rounds', 'sets', 'innings', 'none'].includes(String(clockRaw.type))
      ? String(clockRaw.type)
      : 'none'
  ) as ClockType

  const statVocab = Array.isArray(row.stat_vocab)
    ? row.stat_vocab
        .map((entry) => {
          if (typeof entry === 'string')
            return {
              key: entry,
              label: entry.replace(/_/g, ' '),
              input: 'counter',
            } as StatOption
          const record = asRecord(entry)
          const key = String(record.key ?? record.stat ?? record.name ?? '').trim()
          if (!key) return null
          const label = String(record.label ?? record.title ?? '').trim()
          const group = String(record.group ?? '').trim() || undefined
          const input: StatInput = String(record.input ?? record.value_type ?? '').trim() === 'value'
            ? 'value'
            : 'counter'
          const option: StatOption = { key, label: label || key.replace(/_/g, ' '), input }
          if (group) option.group = group
          return option
        })
        .filter((entry): entry is StatOption => entry !== null)
    : []

  const eventVocabRaw = Array.isArray(row.event_vocab) ? row.event_vocab : []
  const eventVocab = eventVocabRaw.map((entry) => String(entry)).filter(Boolean)

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    scoringType: (['duel', 'sets', 'bouts', 'race', 'attempts'].includes(String(row.scoring_type))
      ? String(row.scoring_type)
      : 'duel') as ScoringType,
    statVocab,
    eventVocab,
    clock: {
      type: clockType,
      periods: toInt(clockRaw.periods, clockType === 'none' ? 0 : 2),
      period_minutes: toInt(clockRaw.period_minutes, 45),
      break_minutes: clockRaw.break_minutes ? toInt(clockRaw.break_minutes, 0) : undefined,
      extra: clockRaw.extra
        ? {
            periods: toInt(asRecord(clockRaw.extra).periods, 2),
            period_minutes: toInt(asRecord(clockRaw.extra).period_minutes, 15),
          }
        : undefined,
    },
    medals: {
      awarded: medalsRaw.awarded !== false,
      team: medalsRaw.team === true,
    },
    court: {
      shape: (
        ['pitch', 'court', 'pool', 'track', 'none'].includes(String(courtRaw.shape))
          ? String(courtRaw.shape)
          : 'pitch'
      ) as SportCourt['shape'],
      orientation: String(courtRaw.orientation) === 'vertical' ? 'vertical' : 'horizontal',
    },
  }
}

export interface ResolvedFixtureRules {
  arrangement: SportArrangement
  /** Effective stat vocab: override entries first, then the sport catalogue. */
  statOptions: StatOption[]
  /** Effective event vocab with labels. */
  eventOptions: EventOption[]
  /** `true` when the fixture carries a `rules_override` object. */
  isOverride: boolean
  allowNegativeScore: boolean
}

const RULE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,48}$/

const parseOverrideStats = (value: unknown): StatOption[] | null => {
  if (!Array.isArray(value)) return null
  // An explicitly empty array is a real instruction ("this match records no
  // stats") — it must survive to the resolver instead of reading as absent.
  if (value.length === 0) return []
  const parsed = value
    .map((entry) => {
      const record = asRecord(entry)
      const key =
        typeof entry === 'string'
          ? entry.trim()
          : String(record.key ?? record.stat ?? record.name ?? '').trim()
      if (!RULE_KEY_PATTERN.test(key)) return null
      const label =
        typeof entry === 'string'
          ? key.replace(/_/g, ' ')
          : String(record.label ?? record.title ?? '').trim() || key.replace(/_/g, ' ')
      const group = String(record.group ?? '').trim() || undefined
      const input: StatInput =
        String(record.input ?? record.value_type ?? '').trim() === 'value' ? 'value' : 'counter'
      const option: StatOption = { key, label, input }
      if (group) option.group = group
      return option
    })
    .filter((entry): entry is StatOption => entry !== null)
  return parsed
}

const parseOverrideEvents = (value: unknown): EventOption[] | null => {
  if (!Array.isArray(value)) return null
  const parsed = value
    .map((entry) => {
      const record = asRecord(entry)
      const type =
        typeof entry === 'string' ? entry.trim() : String(record.key ?? record.type ?? '').trim()
      if (!RULE_KEY_PATTERN.test(type)) return null
      const label =
        typeof entry === 'string'
          ? type.replace(/_/g, ' ')
          : String(record.label ?? '').trim() || type.replace(/_/g, ' ')
      const group = String(record.group ?? '').trim() || undefined
      const option: EventOption = { type, label }
      if (group) option.group = group
      return option
    })
    .filter((entry): entry is EventOption => entry !== null)
  return parsed
}
/**
 * Client mirror of `fixture_effective_rules()`. Never throws and never
 * trusts the shape: vocab entries are key-validated and clocks are
 * range-checked, so a malformed override degrades to the catalogue instead
 * of breaking the console.
 */
export function resolveFixtureRules(input: {
  sport: SportArrangement | null
  scoringType?: string | null
  rulesOverride?: unknown
  fallbackName?: string
}): ResolvedFixtureRules {
  const override = asRecord(input.rulesOverride)
  const hasOverride = Object.keys(override).length > 0

  const overrideStats = parseOverrideStats(override.stat_vocab)
  const overrideEvents = parseOverrideEvents(override.event_vocab)
  const overrideClock = asRecord(override.clock)
  const overrideMedals = asRecord(override.medals)

  const baseStats = overrideStats ?? input.sport?.statVocab ?? []
  const seen = new Set<string>()
  const statOptions = baseStats.filter((entry) => {
    if (seen.has(entry.key)) return false
    seen.add(entry.key)
    return true
  })
  // Ultimate fallback: no override vocab and no sport vocab means the legacy
  // football keys, exactly as `fixture_effective_rules()` resolves it. An
  // explicit `[]` override is preserved (it is not "missing").
  if (overrideStats === null && statOptions.length === 0) {
    statOptions.push(...LEGACY_STAT_VOCAB.map((entry) => ({ ...entry })))
  }

  const sportEvents = (input.sport?.eventVocab ?? []).map((type) => ({
    type,
    label: type.replace(/_/g, ' '),
  }))
  const eventOptions = overrideEvents ?? sportEvents

  const base = input.sport
  const sportClock = base?.clock

  const clockType = (
    ['halves', 'quarters', 'rounds', 'sets', 'innings', 'none'].includes(String(overrideClock.type ?? ''))
      ? String(overrideClock.type)
      : (sportClock?.type ?? 'none')
  ) as ClockType

  const extraRaw = asRecord(overrideClock.extra)
  const boolOf = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback

  const clock: SportClock = {
    type: clockType,
    periods: toInt(overrideClock.periods, sportClock?.periods ?? (clockType === 'none' ? 0 : 2)),
    period_minutes: toInt(overrideClock.period_minutes, sportClock?.period_minutes ?? 45),
    break_minutes:
      overrideClock.break_minutes !== undefined
        ? toInt(overrideClock.break_minutes, 0)
        : sportClock?.break_minutes,
    extra:
      extraRaw.periods || extraRaw.period_minutes
        ? {
            periods: toInt(extraRaw.periods, sportClock?.extra?.periods ?? 2),
            period_minutes: toInt(extraRaw.period_minutes, sportClock?.extra?.period_minutes ?? 15),
          }
        : sportClock?.extra,
  }

  const arrangement: SportArrangement = base
    ? {
        ...base,
        statVocab: statOptions,
        eventVocab: eventOptions.map((entry) => entry.type),
        clock,
        medals: {
          awarded: boolOf(overrideMedals.awarded, base.medals.awarded),
          team: boolOf(overrideMedals.team, base.medals.team),
        },
      }
    : {
        id: '',
        code: 'fallback',
        name: input.fallbackName ?? 'Match',
        scoringType: (['duel', 'sets', 'bouts', 'race', 'attempts'].includes(
          String(input.scoringType ?? ''),
        )
          ? String(input.scoringType)
          : 'duel') as ScoringType,
        statVocab: statOptions,
        eventVocab: eventOptions.map((entry) => entry.type),
        clock,
        court: { shape: 'pitch', orientation: 'horizontal' },
        medals: {
          awarded: boolOf(overrideMedals.awarded, true),
          team: boolOf(overrideMedals.team, false),
        },
      }

  return {
    arrangement,
    statOptions,
    eventOptions,
    isOverride: hasOverride,
    allowNegativeScore: boolOf(override.allow_negative_score, false),
  }
}

/** Group stat options for the rotation rail while preserving vocab order. */
export function groupStatOptions(options: StatOption[]): {
  group: string | null
  options: StatOption[]
}[] {
  const groups: { group: string | null; options: StatOption[] }[] = []
  const index = new Map<string | null, number>()
  for (const option of options) {
    const group = option.group ?? null
    const existing = index.get(group)
    if (existing === undefined) {
      index.set(group, groups.length)
      groups.push({ group, options: [option] })
    } else {
      groups[existing].options.push(option)
    }
  }
  return groups
}


export function clockSegmentLabels(clock: SportClock): string[] {
  switch (clock.type) {
    case 'halves':
      return ['1st Half', '2nd Half']
    case 'quarters':
      return Array.from({ length: clock.periods }, (_, index) => `Quarter ${index + 1}`)
    case 'rounds':
      return Array.from({ length: clock.periods }, (_, index) => `Round ${index + 1}`)
    default:
      return []
  }
}

/** Score heading per scoring type (what home/away numbers mean). */
export function scoreLabel(scoringType: ScoringType): string {
  switch (scoringType) {
    case 'sets':
      return 'Sets won'
    case 'bouts':
      return 'Rounds / points'
    case 'race':
      return 'Finish position'
    case 'attempts':
      return 'Best result'
    default:
      return 'Score'
  }
}
