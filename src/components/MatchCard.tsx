import Link from 'next/link'

export interface TeamCardInfo {
  name: string
  abbr: string
  score?: number
}

export interface MatchCardRow {
  id: string
  home: TeamCardInfo
  away: TeamCardInfo
  status: string
  time?: string
  date?: string
}

export function MatchCard({ match }: { match: MatchCardRow }) {
  return (
    <Link href={`/match/${match.id}`} className="block">
        <div className="bg-[#1e293b] rounded-xl p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between border border-white/5 hover:border-indigo-500/50 transition-colors cursor-pointer group">
            <div className="flex items-center justify-between w-full sm:w-auto flex-1 gap-4">
                <div className="flex items-center gap-3 sm:gap-4 flex-1">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white text-xs sm:text-sm">{match.home.abbr}</div>
                    <span className="font-semibold text-sm sm:text-lg">{match.home.name}</span>
                </div>

                <div className="flex flex-col items-center px-4 sm:px-8 shrink-0">
                    {match.home.score !== undefined && match.away.score !== undefined ? (
                      <>
                        <div className="text-xl sm:text-2xl font-black tabular-nums tracking-tighter group-hover:text-indigo-400 transition-colors">{match.home.score} - {match.away.score}</div>
                        <div className={`text-xs font-medium mt-1 ${match.status === 'LIVE' ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>{match.time || match.status}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm sm:text-base font-bold text-gray-400 group-hover:text-indigo-400 transition-colors">VS</div>
                        <div className="text-xs font-medium mt-1 text-gray-400">{match.date}</div>
                      </>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 sm:gap-4 flex-1">
                    <span className="font-semibold text-sm sm:text-lg text-right">{match.away.name}</span>
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white text-xs sm:text-sm">{match.away.abbr}</div>
                </div>
            </div>

            <div className="w-full sm:w-auto flex justify-center sm:justify-end mt-4 sm:mt-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-indigo-400 text-sm font-medium flex items-center gap-1">
                    View <span aria-hidden="true">&rarr;</span>
                </span>
            </div>
        </div>
    </Link>
  )
}
