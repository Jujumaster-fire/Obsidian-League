import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import { TeamsExplorer } from '@/components/TeamsExplorer'
import { cachedRestGet } from '@/lib/public-api'
import { cacheKey } from '@/lib/cache'
import type { TeamRow } from '@/components/TeamsExplorer'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Teams | Obsidian Elite',
  description: 'Browse every team competing in the Obsidian Elite, filtered by category, discipline and group.',
  openGraph: {
    title: 'Teams | Obsidian Elite',
    description: 'Browse every team competing in the Obsidian Elite, filtered by category, discipline and group.',
    siteName: 'Obsidian Elite',
    type: 'website',
  },
}

export default async function TeamsPage() {
  const teams = await cachedRestGet<TeamRow>('teams?select=*&order=name.asc&limit=1000', {
    // The team directory changes rarely and is read constantly.
    sharedKey: cacheKey('public', 'teams', 'list'),
    sharedTtlSeconds: 600,
    revalidate: 300,
  })

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div data-tour="teams-explorer" className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-2">Registered Teams</h1>
          <p className="text-gray-400 max-w-2xl text-lg">Browse all teams participating in the Obsidian Elite.</p>
        </header>

        <TeamsExplorer teams={teams} />
      </div>
    </div>
  )
}
