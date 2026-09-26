import Link from 'next/link'
import type { Fixture } from '@/lib/competitions-standings'

interface PlayoffTabsProps {
  playoffMatches: Fixture[]
}

export function PlayoffTabs({ playoffMatches }: PlayoffTabsProps) {
  // Try to find the Final match (the one that doesn't have a next_fixture_id, or stage='final')
  const finalMatch = playoffMatches.find(f => f.stage === 'final') || playoffMatches.find(f => !f.next_fixture_id && f.stage !== 'group_stage')

  if (!finalMatch && playoffMatches.length === 0) {
    return (
      <div className="space-y-12">
        <h2 className="text-2xl font-bold">Tournament Bracket</h2>
        <div className="p-20 text-center bg-[#1e293b] rounded-lg border border-white/5">
          The play-offs bracket has not been generated yet.
        </div>
      </div>
    )
  }

  // Recursive function to build the tree node
  const renderNode = (fixtureId: string, level: number = 0): React.ReactNode => {
    const match = playoffMatches.find(f => f.id === fixtureId)
    if (!match) return null

    const leftChildren = playoffMatches.filter(f => f.next_fixture_id === match.id && f.next_fixture_slot === 'home')
    const rightChildren = playoffMatches.filter(f => f.next_fixture_id === match.id && f.next_fixture_slot === 'away')

    return (
      <div className="flex flex-col items-center justify-center relative">
        <div className="flex justify-center items-stretch gap-8 mb-8">
          {leftChildren.map(f => (
            <div key={f.id} className="relative flex flex-col items-center">
              {renderNode(f.id, level + 1)}
              <div className="w-px h-8 bg-white/20 absolute -bottom-8"></div>
              <div className="h-px w-1/2 bg-white/20 absolute -bottom-8 right-0"></div>
            </div>
          ))}
          {rightChildren.map(f => (
            <div key={f.id} className="relative flex flex-col items-center">
              {renderNode(f.id, level + 1)}
              <div className="w-px h-8 bg-white/20 absolute -bottom-8"></div>
              <div className="h-px w-1/2 bg-white/20 absolute -bottom-8 left-0"></div>
            </div>
          ))}
        </div>

        <Link href={`/match/${match.id}`} className="block relative z-10 w-64 bg-[#1e293b] rounded border border-white/10 hover:border-indigo-500 transition-colors group">
          <div className="text-[10px] text-center uppercase tracking-widest text-gray-500 py-1 border-b border-white/5 bg-black/20 rounded-t">
            {match.stage?.replace(/_/g, ' ') || 'Knockout'}
          </div>
          <div className="flex flex-col">
            <div className="flex justify-between items-center px-3 py-2 border-b border-white/5">
              <span className="font-semibold text-sm truncate pr-2 group-hover:text-indigo-300 transition-colors">{match.home_team?.name || 'TBD'}</span>
              <span className="font-mono text-sm bg-black/40 px-2 py-0.5 rounded">{match.home_score ?? '-'}</span>
            </div>
            <div className="flex justify-between items-center px-3 py-2">
              <span className="font-semibold text-sm truncate pr-2 group-hover:text-indigo-300 transition-colors">{match.away_team?.name || 'TBD'}</span>
              <span className="font-mono text-sm bg-black/40 px-2 py-0.5 rounded">{match.away_score ?? '-'}</span>
            </div>
          </div>
        </Link>
        {level > 0 && <div className="w-px h-8 bg-white/20"></div>}
      </div>
    )
  }

  // If we can't find a single root (e.g. unfinished bracket), just fallback to listing them
  if (!finalMatch) {
    return (
       <div className="space-y-6">
        <h2 className="text-2xl font-bold">Tournament Bracket</h2>
        <div className="grid gap-4">
          {playoffMatches.map((f) => (
             <Link key={f.id} href={`/match/${f.id}`} className="block relative z-10 bg-[#1e293b] rounded border border-white/10 hover:border-indigo-500 transition-colors group">
              <div className="text-[10px] text-center uppercase tracking-widest text-gray-500 py-1 border-b border-white/5 bg-black/20 rounded-t">
                {f.stage?.replace(/_/g, ' ') || 'Knockout'}
              </div>
              <div className="flex flex-col">
                <div className="flex justify-between items-center px-3 py-2 border-b border-white/5">
                  <span className="font-semibold text-sm truncate pr-2 group-hover:text-indigo-300 transition-colors">{f.home_team?.name || 'TBD'}</span>
                  <span className="font-mono text-sm bg-black/40 px-2 py-0.5 rounded">{f.home_score ?? '-'}</span>
                </div>
                <div className="flex justify-between items-center px-3 py-2">
                  <span className="font-semibold text-sm truncate pr-2 group-hover:text-indigo-300 transition-colors">{f.away_team?.name || 'TBD'}</span>
                  <span className="font-mono text-sm bg-black/40 px-2 py-0.5 rounded">{f.away_score ?? '-'}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-12">
      <h2 className="text-2xl font-bold">Tournament Bracket</h2>

      <div className="overflow-x-auto py-8">
        <div className="min-w-max flex justify-center pb-8">
          {renderNode(finalMatch.id)}
        </div>
      </div>
    </div>
  )
}
