import { Suspense } from 'react'
import MatchServer from './MatchServer'
import { MatchCenterFullSkeleton } from '@/components/Skeleton'

export const revalidate = 30

interface MatchPageProps {
  params: Promise<{ id: string }>
}

/**
 * Thin route wrapper. `MatchServer` renders the first paint (score header,
 * mini-events and all five tab panels' server data); `MatchRealtimeClient`
 * inside it mounts the tab buttons, the ticking clock and the Realtime
 * subscriptions.
 */
export default async function MatchPage({ params }: MatchPageProps) {
  return (
    <Suspense fallback={<MatchCenterFullSkeleton />}>
      <MatchServer params={params} />
    </Suspense>
  )
}
