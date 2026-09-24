'use client'

import { use } from 'react'
import Navigation from '@/components/Navigation'
import { ScoutLogPanel } from '@/components/scout/ScoutLogPanel'

/**
 * Scout logging surface for one fixture.
 *
 * This is a match-day operator's own UI: the panel gates itself on the
 * visitor's duties and only ever renders the controls those duties cover.
 * Nothing on this page mentions or links to any higher role.
 */
export default function ScoutMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <div className="min-h-screen bg-[#0f172a] pb-24 text-white">
      <Navigation />
      <main className="mx-auto max-w-5xl px-4 pt-24 sm:px-6 lg:px-8">
        <ScoutLogPanel fixtureId={id} />
      </main>
    </div>
  )
}
