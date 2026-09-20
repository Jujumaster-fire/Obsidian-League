import type { Fixture } from '@/lib/competitions-standings'
import { FixtureCard } from '@/components/competitions/FixtureCard'

interface PlayoffTabsProps {
  quarterFinal: Fixture[]
  semiFinal: Fixture[]
  final: Fixture[]
}

export function PlayoffTabs({ quarterFinal, semiFinal, final }: PlayoffTabsProps) {
  const renderBlock = (label: string, matches: Fixture[]) => {
    if (matches.length === 0) return null
    return (
      <div key={label} className="mt-6">
        <h3 className="text-xl font-semibold mb-4 text-indigo-300 uppercase tracking-widest">
          {label}
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {matches.map((f) => (
            <FixtureCard key={f.id} match={f} />
          ))}
        </div>
      </div>
    )
  }

  const hasAny = quarterFinal.length > 0 || semiFinal.length > 0 || final.length > 0

  return (
    <div className="space-y-12">
      <h2 className="text-2xl font-bold">Tournament Bracket</h2>

      <div className="space-y-10">
        {renderBlock('Final', final)}
        {renderBlock('Semi Final', semiFinal)}
        {renderBlock('Quarter Final', quarterFinal)}
        {!hasAny && (
          <div className="p-20 text-center bg-[#1e293b] rounded-lg border border-white/5">
            The play-offs bracket has not been generated yet.
          </div>
        )}
      </div>
    </div>
  )
}
