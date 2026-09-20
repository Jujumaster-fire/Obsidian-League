/**
 * Duty tokens — the client mirror of PART 13 (`scope authority`) in
 * `supabase/db-setup.sql`.
 *
 * A tournament member's power is the union of their global role
 * (`app_admin`) and their per-tournament `duties` list. The database is the
 * final authority (every recorder RPC re-checks `can_write_fixture()` in
 * Postgres); this module only decides what the console renders and enables,
 * so nobody sees buttons that would fail — but a tap that does reach the
 * server is still gated there.
 *
 * Token grammar (must stay identical to the SQL):
 *   '*'                      full manager of the tournament
 *   'score'                  scoreboard + clock + own stats and events
 *   'clock'                  clock/period control only
 *   'posts'                  news & articles
 *   'roster'                 teams / players / athletes
 *   'entry'                  fixture entries / results / medals
 *   'lineup'                 formations / starting XI (fixture_lineups)
 *   'stat:<key>'             one counter, every fixture of the tournament
 *   'event:<type>'           one timeline event type, every fixture
 *   'fixture:<uuid>'         everything, but only on that one fixture
 *   'stat:<key>@<fixture>'   one counter on one fixture
 *   'event:<type>@<fixture>' one event type on one fixture
 */

export const WILDCARD_DUTY = '*'
export const SCORE_DUTY = 'score'
export const CLOCK_DUTY = 'clock'
export const POSTS_DUTY = 'posts'
export const ROSTER_DUTY = 'roster'
export const ENTRY_DUTY = 'entry'
export const LINEUP_DUTY = 'lineup'

/** Scope words that are reserved and never treated as stat/event keys. */
export const RESERVED_DUTIES = new Set([
  WILDCARD_DUTY,
  SCORE_DUTY,
  CLOCK_DUTY,
  POSTS_DUTY,
  ROSTER_DUTY,
  ENTRY_DUTY,
  LINEUP_DUTY,
])

export type DutyDomain = 'stat' | 'event'

export interface ParsedDuty {
  kind: 'wildcard' | 'scope' | 'stat' | 'event' | 'fixture' | 'scoped-stat' | 'scoped-event' | 'bare'
  /** For scope kinds and bare keys: the raw token. */
  token: string
  /** The stat key or event type (stat/event/scoped forms). */
  key: string | null
  /** The fixture id (fixture/scoped forms). */
  fixtureId: string | null
}

/** Split one duty token into a structural form (never throws). */
export function parseDutyToken(token: string): ParsedDuty {
  const trimmed = (token ?? '').trim()

  if (trimmed === WILDCARD_DUTY) {
    return { kind: 'wildcard', token: trimmed, key: null, fixtureId: null }
  }

  if (RESERVED_DUTIES.has(trimmed)) {
    return { kind: 'scope', token: trimmed, key: null, fixtureId: null }
  }

  if (trimmed.startsWith('fixture:') && trimmed.length > 'fixture:'.length) {
    return {
      kind: 'fixture',
      token: trimmed,
      key: null,
      fixtureId: trimmed.slice('fixture:'.length),
    }
  }

  const scopedMatch = /^(stat|event):(.+)@([^@:]+)$/.exec(trimmed)
  if (scopedMatch) {
    const [, domain, key, fixtureId] = scopedMatch
    if (key && fixtureId) {
      return {
        kind: domain === 'stat' ? 'scoped-stat' : 'scoped-event',
        token: trimmed,
        key,
        fixtureId,
      }
    }
  }

  const domainMatch = /^(stat|event):(.+)$/.exec(trimmed)
  if (domainMatch) {
    const [, domain, key] = domainMatch
    if (key) {
      return {
        kind: domain === 'stat' ? 'stat' : 'event',
        token: trimmed,
        key,
        fixtureId: null,
      }
    }
  }

  return { kind: 'bare', token: trimmed, key: trimmed || null, fixtureId: null }
}

export interface DutyContext {
  isAppAdmin: boolean
  /** Raw duty tokens of the membership for the fixture's tournament. */
  duties: string[]
  /** The fixture being logged (required for `fixture:` / `@fixture` tokens). */
  fixtureId: string | null
}

/**
 * Mirror of `public.can_write_fixture()` — broad-scope check only.
 * Narrow stat/event keys are checked by `canRecordStatKeys()` /
 * `canLogEventTypes()` so the console can enable individual rows.
 */
export function hasScopeAccess(context: DutyContext, scopes: string[]): boolean {
  if (context.isAppAdmin) return true
  const { duties } = context
  if (duties.includes(WILDCARD_DUTY)) return true
  if (scopes.some((scope) => duties.includes(scope))) return true
  if (context.fixtureId && duties.includes(`fixture:${context.fixtureId}`)) return true
  return false
}

/** Which of `keys` the operator may record (mirrors the `stat` branch of `can_write_fixture()`). */
export function canRecordStatKeys(context: DutyContext, keys: string[]): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  if (context.isAppAdmin) {
    for (const key of keys) result[key] = true
    return result
  }
  const { duties, fixtureId } = context
  const blanket = duties.includes(WILDCARD_DUTY) || duties.includes(SCORE_DUTY)
  const fixturePinned = fixtureId ? duties.includes(`fixture:${fixtureId}`) : false

  for (const key of keys) {
    result[key] =
      blanket ||
      fixturePinned ||
      duties.includes(`stat:${key}`) ||
      (fixtureId ? duties.includes(`stat:${key}@${fixtureId}`) : false) ||
      // Legacy bare-key duties from migration 06 (`duties = '{shots}'`),
      // excluding the reserved scope words.
      (!RESERVED_DUTIES.has(key) && duties.includes(key))
  }
  return result
}

/** Which of `types` the operator may log (mirrors the `event` branch of `can_write_fixture()`). */
export function canLogEventTypes(context: DutyContext, types: string[]): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  if (context.isAppAdmin) {
    for (const type of types) result[type] = true
    return result
  }
  const { duties, fixtureId } = context
  const blanket = duties.includes(WILDCARD_DUTY) || duties.includes(SCORE_DUTY)
  const fixturePinned = fixtureId ? duties.includes(`fixture:${fixtureId}`) : false

  for (const type of types) {
    result[type] =
      blanket ||
      fixturePinned ||
      duties.includes(`event:${type}`) ||
      (fixtureId ? duties.includes(`event:${type}@${fixtureId}`) : false) ||
      (!RESERVED_DUTIES.has(type) && duties.includes(type))
  }
  return result
}

/**
 * Split a comma / space-separated duty string into tokens, normalising to
 * lowercase so the invite form cannot create a case-mismatched duty that the
 * database would reject. Each token is structurally validated against the
 * grammar above. Returns null on the first invalid token.
 */
export function parseInviteDuties(value: string): string[] | null {
  const tokens = (value ?? '')
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null
  const out: string[] = []
  for (const token of tokens) {
    const normalised = token.toLowerCase()
    const parsed = parseDutyToken(normalised)
    // Reject anything we cannot place structurally (bare key is allowed as a
    // legacy scout duty, but '*' / reserved scopes / stat|event / fixture /
    // scoped forms are all valid).
    if (parsed.kind === 'bare' && RESERVED_DUTIES.has(normalised)) return null
    out.push(parsed.token)
  }
  return out
}

/** Convenience checks used directly by console panels. */
export function canWriteScore(context: DutyContext): boolean {
  return hasScopeAccess(context, [SCORE_DUTY])
}

export function canWriteClock(context: DutyContext): boolean {
  return hasScopeAccess(context, [SCORE_DUTY, CLOCK_DUTY])
}

export function canEditRules(context: DutyContext): boolean {
  return hasScopeAccess(context, [SCORE_DUTY])
}

export function canWriteEntries(context: DutyContext): boolean {
  return hasScopeAccess(context, [ENTRY_DUTY, SCORE_DUTY])
}

/** Mirrors `can_write_fixture_lineup()` — the `lineup` duty (PART 15). */
export function canWriteLineup(context: DutyContext): boolean {
  return hasScopeAccess(context, [LINEUP_DUTY])
}

/** Human label for any duty token (drives the invite page and claim chips). */
export function dutyLabel(token: string): string {
  const parsed = parseDutyToken(token)
  const pretty = (value: string | null) =>
    (value ?? '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

  switch (parsed.kind) {
    case 'wildcard':
      return 'Full tournament manager'
    case 'scope':
      return (
        {
          [SCORE_DUTY]: 'Scores, clock & all events',
          [CLOCK_DUTY]: 'Clock control only',
          [POSTS_DUTY]: 'News & posts',
          [ROSTER_DUTY]: 'Squads & athletes',
          [ENTRY_DUTY]: 'Results & medals',
          [LINEUP_DUTY]: 'Lineups & formations',
        }[parsed.token] ?? pretty(parsed.token)
      )
    case 'fixture':
      return 'Match scout (one match)'
    case 'stat':
      return `Stat logger · ${pretty(parsed.key)}`
    case 'event':
      return `Event logger · ${pretty(parsed.key)}`
    case 'scoped-stat':
      return `Stat logger · ${pretty(parsed.key)} (one match)`
    case 'scoped-event':
      return `Event logger · ${pretty(parsed.key)} (one match)`
    default:
      return RESERVED_DUTIES.has(parsed.token) ? pretty(parsed.token) : `Scout · ${pretty(parsed.token)}`
  }
}