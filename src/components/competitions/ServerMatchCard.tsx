import type { Fixture } from '@/lib/competitions-standings'

export interface ServerMatchCardProps {
  match: Fixture
}

/**
 * Static, server-rendered match card.
 *
 * This is identical in shape to the card that was inside the old
 * `CompetitionsContent` client component, but it has no state and no
 * Realtime wiring — it just renders whatever was passed to it. The new
 * competitions page uses it both for the server-rendered first paint and
 * as the shell that the client-side Realtime subscriber updates.
 */
export function ServerMatchCard({ match }: ServerMatchCardProps) {
  const statusLabel =
    match.status === 'in_progress'
      ? 'LIVE'
      : match.status === 'full_time'
        ? 'FT'
        : match.status === 'cancelled'
          ? 'CANCELLED'
          : new Date(match.match_date).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })

  const dateLabel = new Date(match.match_date).toLocaleDateString()
  const stageLabel = (match.stage ?? 'Group stage').replace(/_/g, ' ')

  return (
    <div className="bg-[#1e293b] rounded-lg p-4 flex flex-col md:flex-row items-center justify-between border border-white/10 hover:border-indigo-500 transition-colors group">
      <div className="text-sm text-gray-400 mb-2 md:mb-0 w-full md:w-32 text-center md:text-left">
        {dateLabel}
        <div className="text-xs uppercase mt-1">{stageLabel}</div>
      </div>

      <div className="flex items-center justify-center gap-4 flex-1">
        <div className="text-right flex-1 font-bold text-lg">
          {match.home_team?.name ?? 'Unknown'}
        </div>
        <div className="bg-slate-900 px-4 py-2 rounded font-mono text-xl tracking-wider min-w-[80px] text-center border border-white/5">
          {match.status === 'scheduled'
            ? 'vs'
            : `${match.home_score ?? '-'} - ${match.away_score ?? '-'}`}
        </div>
        <div className="text-left flex-1 font-bold text-lg">
          {match.away_team?.name ?? 'Unknown'}
        </div>
      </div>

      <div className="w-full md:w-32 flex justify-end mt-2 md:mt-0">
        {match.status === 'in_progress' ? (
          <span className="text-red-500 font-bold animate-pulse text-sm">
            {statusLabel}
          </span>
        ) : match.status === 'full_time' ? (
          <span className="text-gray-500 text-sm">{statusLabel}</span>
        ) : match.status === 'cancelled' ? (
          <span className="text-gray-600 text-sm">{statusLabel}</span>
        ) : (
          <span className="text-indigo-400 text-sm">{statusLabel}</span>
        )}
      </div>
    </div>
  )
}
