export interface MatchClockStats {
  elapsed_seconds?: number
  timer_started_at?: string | null
  added_minutes?: number
  [key: string]: unknown
}

export interface MatchClockFixture {
  id: string
  status: string | null
  current_minute: number | null
  stats?: MatchClockStats | Record<string, unknown> | null
}

/**
 * Calculates the live display minute for a match.
 *
 * If the timer is actively running (`status === 'in_progress'` or `'extra_time'` and
 * `timer_started_at` is set), calculates the live elapsed minute dynamically based on
 * the current wall-clock time so public viewers see the minute ticking up continuously.
 */
export function getEffectiveMinute(fixture: MatchClockFixture): number {
  const isLive = fixture.status === 'in_progress' || fixture.status === 'extra_time'
  const stats = fixture.stats as MatchClockStats | null | undefined

  if (isLive && stats?.timer_started_at) {
    const startedAt = new Date(stats.timer_started_at).getTime()
    if (!Number.isNaN(startedAt)) {
      const now = Date.now()
      const accumulated = typeof stats.elapsed_seconds === 'number' ? stats.elapsed_seconds : 0
      const currentRunSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
      const totalSeconds = accumulated + currentRunSeconds
      return Math.max(1, Math.floor(totalSeconds / 60) + 1)
    }
  }

  return fixture.current_minute && fixture.current_minute > 0 ? fixture.current_minute : 1
}

export function formatMatchTimeLabel(fixture: MatchClockFixture): string {
  const isLive = fixture.status === 'in_progress' || fixture.status === 'extra_time' || fixture.status === 'paused'
  const stats = fixture.stats as MatchClockStats | null | undefined
  const addedMinutes = typeof stats?.added_minutes === 'number' && stats.added_minutes > 0 ? stats.added_minutes : 0

  if (isLive) {
    const minute = getEffectiveMinute(fixture)
    if (addedMinutes > 0) {
      if (minute >= 90) return `90+${addedMinutes}'`
      if (minute >= 45) return `45+${addedMinutes}'`
    }
    return `${minute}'`
  }
  if (fixture.status === 'half_time') return 'HT'
  if (fixture.status === 'full_time') return 'FT'
  if (fixture.status === 'cancelled') return 'CANCELLED'
  return 'LIVE'
}
