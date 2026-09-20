'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { Fixture } from '@/lib/competitions-standings'
import { ServerMatchCard } from '@/components/competitions/ServerMatchCard'

interface RealtimeClientProps {
  /** The server-rendered live fixtures, refreshed via ISR every 30s. */
  liveFixtures: Fixture[]
}

/**
 * Thin client layer that keeps the "Live Now" strip fresh as matches
 * start/end without reloading the page.
 *
 * The server component is responsible for the first paint of the live
 * strip (and every other tab). This component only adds the Realtime
 * refresh on top.
 */
export function RealtimeClient({ liveFixtures: initial }: RealtimeClientProps) {
  const supabase = createClient()
  const [liveFixtures, setLiveFixtures] = useState<Fixture[]>(initial)

  useEffect(() => {
    const channel = supabase
      .channel('competitions_live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'fixtures',
          filter: 'status=in.("scheduled","in_progress","extra_time")',
        },
        (payload) => {
          const changed = (payload.new as Fixture) ?? null
          if (!changed) return
          setLiveFixtures((prev) => {
            const existing = prev.find((f) => f.id === changed.id)
            if (!existing) {
              return [...prev, changed]
            }
            return prev.map((f) => (f.id === changed.id ? changed : f))
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  // Newest live match first.
  const ordered = [...liveFixtures].sort(
    (a, b) =>
      new Date(b.match_date).getTime() - new Date(a.match_date).getTime(),
  )

  if (ordered.length === 0) return null

  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold text-red-400 flex items-center gap-3">
        <span className="inline-block w-3 h-3 rounded-full bg-red-500 animate-pulse" />
        Live Now
      </h2>
      <div className="grid gap-4">
        {ordered.map((f) => (
          <ServerMatchCard key={f.id} match={f} />
        ))}
      </div>
    </section>
  )
}
