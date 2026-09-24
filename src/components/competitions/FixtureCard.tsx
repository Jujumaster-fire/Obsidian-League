import Link from 'next/link'
import type { Fixture } from '@/lib/competitions-standings'
import { formatMatchTimeLabel } from '@/lib/match-clock'

export function FixtureCard({ match }: { match: Fixture }) {
  const isLive = match.status === 'in_progress' || match.status === 'extra_time'
  const timeLabel = formatMatchTimeLabel(match)

  return (
    <Link href={`/match/${match.id}`} className="block">
      <div className="bg-[#1e293b] rounded-lg p-4 flex flex-col md:flex-row items-center justify-between border border-white/10 hover:border-indigo-500 transition-colors group cursor-pointer">
        <div className="text-sm text-gray-400 mb-2 md:mb-0 w-full md:w-32 text-center md:text-left">
          {new Date(match.match_date).toLocaleDateString()}
          <div className="text-xs uppercase mt-1">{(match.stage ?? 'Group stage').replace(/_/g, ' ')}</div>
        </div>
        <div className="flex items-center justify-center gap-4 flex-1">
          <div className="text-right flex-1 font-bold text-lg group-hover:text-indigo-300 transition-colors">{match.home_team?.name}</div>
          <div className="bg-slate-900 px-4 py-2 rounded font-mono text-xl tracking-wider min-w-[80px] text-center border border-white/5">
            {match.status === 'scheduled' ? 'vs' : `${match.home_score ?? '-'} - ${match.away_score ?? '-'}`}
          </div>
          <div className="text-left flex-1 font-bold text-lg group-hover:text-indigo-300 transition-colors">{match.away_team?.name}</div>
        </div>
        <div className="w-full md:w-32 flex justify-end mt-2 md:mt-0">
          {isLive ? (
            <span className="text-red-500 font-bold animate-pulse text-sm flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              {timeLabel}
            </span>
          ) : match.status === 'full_time' ? (
            <span className="text-gray-500 text-sm">FT</span>
          ) : match.status === 'cancelled' ? (
            <span className="text-gray-600 text-sm">CANCELLED</span>
          ) : (
            <span className="text-indigo-400 text-sm">
              {new Date(match.match_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
