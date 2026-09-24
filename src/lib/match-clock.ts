export interface MatchClockStats {
  elapsed_seconds?: number
  timer_started_at?: string | null
  [key: string]: unknown
}

export interface MatchClockFixture {
  id: string
  status: string | null
  current_minute: number | null
  stats?: MatchClockStats | null
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
  const stats = fixture.stats

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
  const isLive = fixture.status === 'in_progress' || fixture.status === 'extra_time'
  if (isLive) {
    return `${getEffectiveMinute(fixture)}'`
  }
  if (fixture.status === 'half_time') return 'HT'
  if (fixture.status === 'full_time') return 'FT'
  if (fixture.status === 'cancelled') return 'CANCELLED'
  return 'LIVE'
}
