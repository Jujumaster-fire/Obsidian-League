import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { cachedRestGet } from '@/lib/public-api'
import { cacheKey } from '@/lib/cache'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Medal Table | Obsidian Elite',
  description: 'Gold, silver and bronze medal standings for every team and athlete competing in the Obsidian Elite.',
  openGraph: {
    title: 'Medal Table | Obsidian Elite',
    description: 'Gold, silver and bronze medal standings for every team and athlete competing in the Obsidian Elite.',
    siteName: 'Obsidian Elite',
    type: 'website',
  },
}

type MedalKind = 'gold' | 'silver' | 'bronze'

const MEDAL_KINDS: MedalKind[] = ['gold', 'silver', 'bronze']

const MEDAL_HEADINGS: Record<MedalKind, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
}

/** Medal colour chips (gold / silver / bronze). */
const MEDAL_CHIP: Record<MedalKind, string> = {
  gold: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  silver: 'text-gray-300 border-gray-300/30 bg-gray-300/10',
  bronze: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
}

const MEDAL_HEADING_COLOUR: Record<MedalKind, string> = {
  gold: 'text-amber-400',
  silver: 'text-gray-300',
  bronze: 'text-orange-400',
}

interface MedalEntry {
  medal: MedalKind | null
  rank: number | null
  fixture_id: string | null
  team_id: string | null
  athlete_id: string | null
  result: Record<string, unknown> | null
  teams: { id: string; name: string | null; short_name: string | null; tournament_id: string | null } | null
  athletes: { id: string; name: string | null; gender: string | null; team_id: string | null } | null
}

interface MedalTally {
  id: string
  name: string
  subtitle?: string
  gold: number
  silver: number
  bronze: number
  total: number
}

const createTally = (id: string, name: string, subtitle?: string): MedalTally => ({
  id,
  name,
  subtitle,
  gold: 0,
  silver: 0,
  bronze: 0,
  total: 0,
})

/** Gold first, then silver, then bronze, then alphabetical. */
const compareTallies = (a: MedalTally, b: MedalTally) =>
  b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.name.localeCompare(b.name)

const fetchEntries = () =>
  cachedRestGet<MedalEntry>(
    'fixture_entries?select=medal,rank,fixture_id,team_id,athlete_id,result,teams(id,name,short_name,tournament_id),athletes(id,name,gender,team_id)&medal=not.is.null&limit=2000',
    {
      // Medal results only change when an event is scored, not every second.
      sharedKey: cacheKey('public', 'medals', 'entries'),
      sharedTtlSeconds: 300,
      revalidate: 60,
    }
  )

function MedalTable({ rows, linkTeams = false }: { rows: MedalTally[]; linkTeams?: boolean }) {
  return (
    <div className="bg-[#1e293b] rounded-xl border border-white/5 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wider text-gray-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                #
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Name
              </th>
              {MEDAL_KINDS.map((kind) => (
                <th key={kind} scope="col" className={`px-4 py-3 text-center font-semibold ${MEDAL_HEADING_COLOUR[kind]}`}>
                  {MEDAL_HEADINGS[kind]}
                </th>
              ))}
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row, index) => (
              <tr key={row.id} className="hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 text-gray-500 tabular-nums">{index + 1}</td>
                <td className="px-4 py-3">
                  {linkTeams ? (
                    <Link href={`/team/${row.id}`} className="font-semibold hover:text-indigo-300 transition-colors">
                      {row.name}
                    </Link>
                  ) : (
                    <span className="font-semibold">{row.name}</span>
                  )}
                  {row.subtitle ? <span className="block text-xs text-gray-500">{row.subtitle}</span> : null}
                </td>
                {MEDAL_KINDS.map((kind) => (
                  <td key={kind} className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex min-w-[2rem] justify-center rounded-full border px-2 py-0.5 font-bold tabular-nums ${
                        row[kind] > 0 ? MEDAL_CHIP[kind] : 'text-gray-600 border-white/5 bg-white/[0.02]'
                      }`}
                    >
                      {row[kind]}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-3 text-center font-bold text-white tabular-nums">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const EmptyPanel = ({ message, hint }: { message: string; hint: string }) => (
  <div className="bg-[#1e293b] rounded-xl p-12 text-center border border-white/5">
    <div className="text-gray-400 text-lg mb-2">{message}</div>
    <p className="text-gray-500 text-sm">{hint}</p>
  </div>
)
export default async function MedalsPage() {
  const entries = await fetchEntries()

  // Team id -> name lookup, so an athlete row can still show their team when
  // the embedded entry only carries the athlete record.
  const teamNames = new Map<string, string>()
  entries.forEach((entry) => {
    if (entry.teams?.id && entry.teams.name) teamNames.set(entry.teams.id, entry.teams.name)
  })

  const teamTallies = new Map<string, MedalTally>()
  const athleteTallies = new Map<string, MedalTally>()

  entries.forEach((entry) => {
    const medal = entry.medal
    if (!medal || !MEDAL_KINDS.includes(medal)) return

    const teamId = entry.teams?.id ?? entry.team_id
    if (teamId) {
      const tally =
        teamTallies.get(teamId) ??
        createTally(teamId, entry.teams?.name ?? 'Unknown team', entry.teams?.short_name ?? undefined)
      tally[medal] += 1
      tally.total += 1
      teamTallies.set(teamId, tally)
    }

    const athleteId = entry.athletes?.id ?? entry.athlete_id
    if (athleteId) {
      const athleteTeamId = entry.athletes?.team_id
      const tally =
        athleteTallies.get(athleteId) ??
        createTally(
          athleteId,
          entry.athletes?.name ?? 'Unknown athlete',
          athleteTeamId ? teamNames.get(athleteTeamId) : undefined
        )
      tally[medal] += 1
      tally.total += 1
      athleteTallies.set(athleteId, tally)
    }
  })

  const teamRows = Array.from(teamTallies.values()).sort(compareTallies)
  const athleteRows = Array.from(athleteTallies.values()).sort(compareTallies)

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div data-tour="medals-table" className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-2">Medal Table</h1>
          <p className="text-gray-400 max-w-2xl text-lg">
            Every gold, silver and bronze awarded across the tournament, for teams and athletes.
          </p>
        </header>

        {entries.length === 0 ? (
          <EmptyPanel
            message="No medals have been awarded yet."
            hint="Medal standings appear here as soon as officials publish the results."
          />
        ) : (
          <div className="space-y-16">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#1e293b] rounded-xl border border-white/5 p-5">
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Medals awarded</div>
                <div className="text-2xl font-bold">{entries.length}</div>
              </div>
              <div className="bg-[#1e293b] rounded-xl border border-white/5 p-5">
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Teams on the board</div>
                <div className="text-2xl font-bold">{teamRows.length}</div>
              </div>
              <div className="bg-[#1e293b] rounded-xl border border-white/5 p-5">
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Athletes on the board</div>
                <div className="text-2xl font-bold">{athleteRows.length}</div>
              </div>
            </div>

            <section>
              <h2 className="text-2xl font-bold mb-6">Team Medal Table</h2>
              {teamRows.length === 0 ? (
                <EmptyPanel message="No team medals recorded." hint="Team medal rows will appear here." />
              ) : (
                <MedalTable rows={teamRows} linkTeams />
              )}
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-6">Athlete Medal Table</h2>
              {athleteRows.length === 0 ? (
                <EmptyPanel message="No athlete medals recorded." hint="Athlete medal rows will appear here." />
              ) : (
                <MedalTable rows={athleteRows} />
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}