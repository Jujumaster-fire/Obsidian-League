import { describe, expect, it } from 'vitest'
import {
  canEditRules,
  canLogEventTypes,
  canRecordStatKeys,
  canWriteClock,
  canWriteEntries,
  canWriteLineup,
  canWriteScore,
  dutyLabel,
  hasScopeAccess,
  parseInviteDuties,
  parseDutyToken,
  type DutyContext,
} from './duties'

const FIXTURE = '11111111-1111-1111-1111-111111111111'
const OTHER_FIXTURE = '22222222-2222-2222-2222-222222222222'

const context = (
  duties: string[],
  isAppAdmin = false,
  fixtureId: string | null = FIXTURE,
): DutyContext => ({
  isAppAdmin,
  duties,
  fixtureId,
})

describe('parseDutyToken', () => {
  it('recognises the wildcard and reserved scopes', () => {
    expect(parseDutyToken('*').kind).toBe('wildcard')
    expect(parseDutyToken('score').kind).toBe('scope')
    expect(parseDutyToken('clock').kind).toBe('scope')
    expect(parseDutyToken('roster').kind).toBe('scope')
    expect(parseDutyToken('entry').kind).toBe('scope')
    expect(parseDutyToken('lineup').kind).toBe('scope')
    expect(parseDutyToken('posts').kind).toBe('scope')
  })

  it('parses stat and event tokens with their key', () => {
    expect(parseDutyToken('stat:shots')).toMatchObject({
      kind: 'stat',
      key: 'shots',
      fixtureId: null,
    })
    expect(parseDutyToken('event:free_kick')).toMatchObject({
      kind: 'event',
      key: 'free_kick',
      fixtureId: null,
    })
  })

  it('parses fixture-pinned tokens', () => {
    expect(parseDutyToken(`fixture:${FIXTURE}`)).toMatchObject({
      kind: 'fixture',
      fixtureId: FIXTURE,
    })
    expect(parseDutyToken(`stat:shots@${FIXTURE}`)).toMatchObject({
      kind: 'scoped-stat',
      key: 'shots',
      fixtureId: FIXTURE,
    })
    expect(parseDutyToken(`event:goal@${FIXTURE}`)).toMatchObject({
      kind: 'scoped-event',
      key: 'goal',
      fixtureId: FIXTURE,
    })
  })

  it('treats an unknown token as a bare legacy key', () => {
    expect(parseDutyToken('shots')).toMatchObject({ kind: 'bare', key: 'shots' })
  })

  it('never throws on empty or null-ish input', () => {
    expect(parseDutyToken('').kind).toBe('bare')
    expect(parseDutyToken(undefined as unknown as string).kind).toBe('bare')
  })
})

describe('broad scope access (mirrors can_write_fixture)', () => {
  it('grants an app admin everything', () => {
    expect(hasScopeAccess(context([], true), ['score'])).toBe(true)
    expect(canWriteScore(context([], true))).toBe(true)
    expect(canWriteEntries(context([], true))).toBe(true)
  })

  it('grants a wildcard member everything in that tournament', () => {
    expect(canWriteScore(context(['*']))).toBe(true)
    expect(canWriteClock(context(['*']))).toBe(true)
    expect(canEditRules(context(['*']))).toBe(true)
    expect(canWriteEntries(context(['*']))).toBe(true)
  })

  it('keeps the historical meaning of the score duty', () => {
    expect(canWriteScore(context(['score']))).toBe(true)
    expect(canWriteClock(context(['score']))).toBe(true)
    expect(canWriteEntries(context(['score']))).toBe(true)
  })

  it('scopes the clock and entry duties to their own action', () => {
    expect(canWriteClock(context(['clock']))).toBe(true)
    expect(canWriteScore(context(['clock']))).toBe(false)
    expect(canEditRules(context(['clock']))).toBe(false)

    expect(canWriteEntries(context(['entry']))).toBe(true)
    expect(canWriteScore(context(['entry']))).toBe(false)
  })

  it('gives a posts-only member no match powers at all', () => {
    const posts = context(['posts'])
    expect(canWriteScore(posts)).toBe(false)
    expect(canWriteClock(posts)).toBe(false)
    expect(canEditRules(posts)).toBe(false)
    expect(canWriteEntries(posts)).toBe(false)
  })

  it('honours a fixture-pinned duty only for that fixture', () => {
    const pinned = context([`fixture:${FIXTURE}`])
    expect(canWriteScore(pinned)).toBe(true)
    expect(canWriteScore({ ...pinned, fixtureId: OTHER_FIXTURE })).toBe(false)
    expect(canWriteScore({ ...pinned, fixtureId: null })).toBe(false)
  })

  it('denies a member with no duties', () => {
    expect(hasScopeAccess(context([]), ['score'])).toBe(false)
  })
})

describe('per-stat access (the multi-logger guarantee)', () => {
  const keys = ['shots', 'passes', 'freekicks', 'throws']

  it('lets a shots logger record shots and NOTHING else', () => {
    const access = canRecordStatKeys(context(['stat:shots']), keys)
    expect(access.shots).toBe(true)
    expect(access.passes).toBe(false)
    expect(access.freekicks).toBe(false)
    expect(access.throws).toBe(false)
  })

  it('supports several streams for one operator', () => {
    const access = canRecordStatKeys(context(['stat:shots', 'stat:passes']), keys)
    expect(access.shots).toBe(true)
    expect(access.passes).toBe(true)
    expect(access.freekicks).toBe(false)
  })

  it('pins a stat to a single fixture with the @fixture form', () => {
    expect(canRecordStatKeys(context([`stat:shots@${FIXTURE}`]), keys).shots).toBe(true)
    expect(canRecordStatKeys(context([`stat:shots@${OTHER_FIXTURE}`]), keys).shots).toBe(false)
  })

  it('keeps legacy bare-key duties working (migration 06 parity)', () => {
    const access = canRecordStatKeys(context(['shots']), keys)
    expect(access.shots).toBe(true)
    expect(access.passes).toBe(false)
  })

  it('never treats a reserved scope word as a bare stat key', () => {
    // A member whose only duty is 'posts' must not gain a stat called 'posts'.
    expect(canRecordStatKeys(context(['posts']), ['posts']).posts).toBe(false)
    expect(canRecordStatKeys(context(['roster']), ['roster']).roster).toBe(false)
    // Same for the lineup duty: it is a scope, not a stat key.
    expect(canRecordStatKeys(context(['lineup']), ['lineup']).lineup).toBe(false)
  })

  it('grants every stat to a blanket duty', () => {
    for (const duty of [['*'], ['score'], [`fixture:${FIXTURE}`]]) {
      const access = canRecordStatKeys(context(duty), keys)
      expect(Object.values(access).every(Boolean)).toBe(true)
    }
  })
})

describe('per-event access', () => {
  const types = ['goal', 'free_kick', 'substitution']

  it('lets a goal logger log goals only', () => {
    const access = canLogEventTypes(context(['event:goal']), types)
    expect(access.goal).toBe(true)
    expect(access.free_kick).toBe(false)
    expect(access.substitution).toBe(false)
  })

  it('grants every event type to a blanket duty', () => {
    expect(Object.values(canLogEventTypes(context(['score']), types)).every(Boolean)).toBe(true)
  })

  it('pins an event type to a single fixture', () => {
    expect(canLogEventTypes(context([`event:goal@${FIXTURE}`]), types).goal).toBe(true)
    expect(canLogEventTypes(context([`event:goal@${OTHER_FIXTURE}`]), types).goal).toBe(false)
  })
})

describe('lineup access (mirrors can_write_fixture_lineup)', () => {
  it('grants the wildcard, an app admin and a fixture pin', () => {
    expect(canWriteLineup(context([], true))).toBe(true)
    expect(canWriteLineup(context(['*']))).toBe(true)
    expect(canWriteLineup(context([`fixture:${FIXTURE}`]))).toBe(true)
  })

  it('requires the lineup duty itself — score is not a coach duty', () => {
    expect(canWriteLineup(context(['lineup']))).toBe(true)
    expect(canWriteLineup(context(['score']))).toBe(false)
    expect(canWriteLineup(context(['clock']))).toBe(false)
    expect(canWriteLineup(context(['entry']))).toBe(false)
    expect(canWriteLineup(context(['roster']))).toBe(false)
  })

  it('denies a member with no duties', () => {
    expect(canWriteLineup(context([]))).toBe(false)
  })

  it('honours a fixture-pinned lineup duty only on that fixture', () => {
    const pinned = context([`fixture:${FIXTURE}`])
    expect(canWriteLineup(pinned)).toBe(true)
    expect(canWriteLineup({ ...pinned, fixtureId: OTHER_FIXTURE })).toBe(false)
  })
})

describe('dutyLabel', () => {
  it('describes each token family readably', () => {
    expect(dutyLabel('*')).toBe('Full tournament manager')
    expect(dutyLabel('score')).toContain('Scores')
    expect(dutyLabel('stat:shots')).toBe('Stat logger · Shots')
    expect(dutyLabel('event:free_kick')).toBe('Event logger · Free Kick')
    expect(dutyLabel('lineup')).toBe('Lineups & formations')
    expect(dutyLabel(`fixture:${FIXTURE}`)).toContain('one match')
  })
})

describe('parseInviteDuties', () => {
  it('normalises a single wildcard and reserved duty', () => {
    expect(parseInviteDuties('*')).toEqual(['*'])
    expect(parseInviteDuties('SCORE')).toEqual(['score'])
    expect(parseInviteDuties('Posts')).toEqual(['posts'])
  })

  it('splits comma / space-separated token lists and lowercases them', () => {
    expect(parseInviteDuties('score,stat:shots,event:goal')).toEqual([
      'score',
      'stat:shots',
      'event:goal',
    ])
    expect(parseInviteDuties('Stat:Passes  event:assist')).toEqual([
      'stat:passes',
      'event:assist',
    ])
  })

  it('accepts fixture-scoped duties', () => {
    expect(parseInviteDuties(`stat:shots@${FIXTURE}`)).toEqual([
      `stat:shots@${FIXTURE}`,
    ])
    expect(parseInviteDuties(`fixture:${FIXTURE}`)).toEqual([`fixture:${FIXTURE}`])
  })

  it('accepts bare legacy scout keys', () => {
    expect(parseInviteDuties('shots')).toEqual(['shots'])
  })

  it('returns null on empty input', () => {
    expect(parseInviteDuties('')).toBeNull()
    expect(parseInviteDuties('   ')).toBeNull()
  })
})