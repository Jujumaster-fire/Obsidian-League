import { describe, expect, it } from 'vitest'
import {
  clockSegmentLabels,
  groupStatOptions,
  LEGACY_STAT_VOCAB,
  parseSportArrangement,
  resolveFixtureRules,
  scoreLabel,
} from './sports'

const footballRow = {
  id: 'sport-1',
  code: 'football',
  name: 'Football',
  scoring_type: 'duel',
  stat_vocab: [{ key: 'shots', label: 'Shots' }, 'passes'],
  event_vocab: ['goal', 'free_kick'],
  scoring_config: {
    clock: { type: 'halves', periods: 2, period_minutes: 45, break_minutes: 15 },
    court: { shape: 'pitch', orientation: 'horizontal' },
    medals: { awarded: true, team: true },
  },
}

describe('parseSportArrangement', () => {
  it('reads a well-formed catalogue row', () => {
    const sport = parseSportArrangement(footballRow)
    expect(sport.scoringType).toBe('duel')
    expect(sport.statVocab).toEqual([
      { key: 'shots', label: 'Shots', input: 'counter' },
      { key: 'passes', label: 'passes', input: 'counter' },
    ])
    expect(sport.eventVocab).toEqual(['goal', 'free_kick'])
    expect(sport.clock).toMatchObject({ type: 'halves', periods: 2, period_minutes: 45 })
    expect(sport.medals).toEqual({ awarded: true, team: true })
    expect(sport.court).toEqual({ shape: 'pitch', orientation: 'horizontal' })
  })

  it('falls back to safe defaults for a malformed row', () => {
    const sport = parseSportArrangement({
      id: 'x',
      code: 'unknown',
      name: 'Unknown',
      scoring_type: 'nonsense',
      stat_vocab: null,
      event_vocab: 'not-an-array',
      scoring_config: 'not-an-object',
    })
    expect(sport.scoringType).toBe('duel')
    expect(sport.statVocab).toEqual([])
    expect(sport.eventVocab).toEqual([])
    expect(sport.clock.type).toBe('none')
    expect(sport.medals).toEqual({ awarded: true, team: false })
    // Pre-PART-12 databases carry no `court`: the canvas still needs a shape.
    expect(sport.court).toEqual({ shape: 'pitch', orientation: 'horizontal' })
  })

  it('reads an unusual court and rejects a nonsense one', () => {
    expect(
      parseSportArrangement({
        ...footballRow,
        code: 'swimming',
        scoring_config: { court: { shape: 'pool', orientation: 'vertical' } },
      }).court,
    ).toEqual({ shape: 'pool', orientation: 'vertical' })

    expect(
      parseSportArrangement({
        ...footballRow,
        scoring_config: { court: { shape: 'lava', orientation: 'sideways' } },
      }).court,
    ).toEqual({ shape: 'pitch', orientation: 'horizontal' })
  })

  it('keeps group and value-input metadata', () => {
    const sport = parseSportArrangement({
      id: 'g',
      code: 'gymnastics',
      name: 'Gymnastics',
      scoring_type: 'attempts',
      stat_vocab: [
        { key: 'attempts', label: 'Attempts', group: 'Routine' },
        { key: 'execution_score', label: 'Execution', group: 'Routine', input: 'value' },
      ],
    })
    expect(sport.statVocab[0]).toMatchObject({ key: 'attempts', group: 'Routine', input: 'counter' })
    expect(sport.statVocab[1]).toMatchObject({ key: 'execution_score', input: 'value' })
  })
})

describe('resolveFixtureRules', () => {
  const sport = parseSportArrangement(footballRow)

  it('uses the sport catalogue when there is no override', () => {
    const resolved = resolveFixtureRules({ sport, rulesOverride: {} })
    expect(resolved.isOverride).toBe(false)
    expect(resolved.statOptions.map((entry) => entry.key)).toEqual(['shots', 'passes'])
    expect(resolved.arrangement.clock.period_minutes).toBe(45)
    expect(resolved.allowNegativeScore).toBe(false)
  })

  it('lets a per-match override change the allocated time', () => {
    // "Today we play 2x15 because the venue is shared."
    const resolved = resolveFixtureRules({
      sport,
      rulesOverride: { clock: { periods: 2, period_minutes: 15 } },
    })
    expect(resolved.isOverride).toBe(true)
    expect(resolved.arrangement.clock.period_minutes).toBe(15)
    expect(resolved.arrangement.clock.periods).toBe(2)
    // Untouched fields still come from the sport.
    expect(resolved.arrangement.clock.break_minutes).toBe(15)
  })

  it('lets an override replace the vocabulary', () => {
    const resolved = resolveFixtureRules({
      sport,
      rulesOverride: { stat_vocab: [{ key: 'tackles', label: 'Tackles' }] },
    })
    expect(resolved.statOptions.map((entry) => entry.key)).toEqual(['tackles'])
  })

  it('honours allow_negative_score for shootouts', () => {
    const resolved = resolveFixtureRules({ sport, rulesOverride: { allow_negative_score: true } })
    expect(resolved.allowNegativeScore).toBe(true)
  })

  it('drops malformed override entries instead of throwing', () => {
    const resolved = resolveFixtureRules({
      sport,
      rulesOverride: {
        stat_vocab: [{ key: 'Bad Key!' }, { key: 'ok_key' }, 42, { nope: true }],
        clock: { period_minutes: 'not-a-number' },
      },
    })
    expect(resolved.statOptions.map((entry) => entry.key)).toEqual(['ok_key'])
    // 'not-a-number' fails the positive-int check, so the sport default wins.
    expect(resolved.arrangement.clock.period_minutes).toBe(45)
  })

  it('falls back to the legacy football keys with no sport at all', () => {
    const resolved = resolveFixtureRules({ sport: null })
    expect(resolved.statOptions.map((entry) => entry.key)).toEqual(
      LEGACY_STAT_VOCAB.map((entry) => entry.key),
    )
    expect(resolved.arrangement.eventVocab).toEqual([])
  })

  it('keeps an explicitly empty override vocabulary empty', () => {
    // A scorekeeper may deliberately trim a sport down to nothing.
    const resolved = resolveFixtureRules({ sport, rulesOverride: { stat_vocab: [] } })
    expect(resolved.statOptions).toEqual([])
  })

  it('never mutates the sport it was given', () => {
    const before = JSON.stringify(sport)
    resolveFixtureRules({ sport, rulesOverride: { clock: { period_minutes: 10 } } })
    expect(JSON.stringify(sport)).toBe(before)
  })
})

describe('groupStatOptions', () => {
  it('preserves vocabulary order while grouping', () => {
    const groups = groupStatOptions([
      { key: 'a', label: 'A', group: 'One' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C', group: 'One' },
      { key: 'd', label: 'D', group: 'Two' },
    ])
    expect(groups.map((group) => group.group)).toEqual(['One', null, 'Two'])
    expect(groups[0].options.map((option) => option.key)).toEqual(['a', 'c'])
  })
})

describe('clockSegmentLabels / scoreLabel', () => {
  it('labels halves, quarters and rounds', () => {
    expect(clockSegmentLabels({ type: 'halves', periods: 2, period_minutes: 45 })).toEqual([
      '1st Half',
      '2nd Half',
    ])
    expect(clockSegmentLabels({ type: 'quarters', periods: 4, period_minutes: 15 })).toEqual([
      'Quarter 1',
      'Quarter 2',
      'Quarter 3',
      'Quarter 4',
    ])
    expect(clockSegmentLabels({ type: 'rounds', periods: 3, period_minutes: 3 })).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
    ])
    expect(clockSegmentLabels({ type: 'none', periods: 0, period_minutes: 0 })).toEqual([])
  })

  it('describes the scoreboard per scoring type', () => {
    expect(scoreLabel('duel')).toBe('Score')
    expect(scoreLabel('sets')).toBe('Sets won')
    expect(scoreLabel('bouts')).toBe('Rounds / points')
    expect(scoreLabel('race')).toBe('Finish position')
    expect(scoreLabel('attempts')).toBe('Best result')
  })
})