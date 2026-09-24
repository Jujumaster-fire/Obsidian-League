"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/utils/supabase/client"
import { formatMatchTimeLabel, type MatchClockStats } from "@/lib/match-clock"

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
  current_minute?: number | null
  stats?: MatchClockStats | null
}

interface HomeRealtimeMatchesProps {
  initialMatches: MatchCardRow[]
}

export function HomeRealtimeMatches({ initialMatches }: HomeRealtimeMatchesProps) {
  const supabase = createClient()
  const [matches, setMatches] = useState<MatchCardRow[]>(initialMatches)

  useEffect(() => {
    const channel = supabase
      .channel("home_matches_realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fixtures",
        },
        (payload) => {
          const changed = payload.new as {
            id?: string
            home_score?: number | null
            away_score?: number | null
            status?: string | null
            current_minute?: number | null
            stats?: MatchClockStats | null
          }
          if (!changed || !changed.id) return

          setMatches((prev) =>
            prev.map((match) => {
              if (match.id !== changed.id) return match

              const isLive = changed.status === "in_progress" || changed.status === "extra_time"
              const updatedStats = changed.stats ?? match.stats
              const timeLabel = formatMatchTimeLabel({
                id: match.id,
                status: changed.status ?? match.status,
                current_minute: changed.current_minute ?? match.current_minute ?? null,
                stats: updatedStats,
              })

              return {
                ...match,
                home: {
                  ...match.home,
                  score: changed.home_score ?? match.home.score,
                },
                away: {
                  ...match.away,
                  score: changed.away_score ?? match.away.score,
                },
                status: isLive ? "LIVE" : changed.status ?? match.status,
                time: timeLabel,
                stats: updatedStats,
                current_minute: changed.current_minute ?? match.current_minute,
              }
            })
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  if (matches.length === 0) {
    return (
      <div className="bg-[#1e293b] rounded-xl p-8 text-center border border-white/5 text-gray-400">
        No matches scheduled for today.
      </div>
    )
  }

  return (
    <section>
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        Matches of the Day
      </h2>
      <div className="space-y-4">
        {matches.map((match) => {
          const timeDisplay = formatMatchTimeLabel({
            id: match.id,
            status: match.status === "LIVE" ? "in_progress" : match.status,
            current_minute: match.current_minute ?? null,
            stats: match.stats,
          })

          return (
            <Link href={`/match/${match.id}`} key={match.id} className="block">
              <div className="bg-[#1e293b] rounded-xl p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between border border-white/5 hover:border-indigo-500/50 transition-colors cursor-pointer group">
                <div className="flex items-center justify-between w-full sm:w-auto flex-1 gap-4">
                  <div className="flex items-center gap-3 sm:gap-4 flex-1">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white text-xs sm:text-sm">
                      {match.home.abbr}
                    </div>
                    <span className="font-semibold text-sm sm:text-lg">{match.home.name}</span>
                  </div>

                  <div className="flex flex-col items-center px-4 sm:px-8 shrink-0">
                    {match.home.score !== undefined && match.away.score !== undefined ? (
                      <>
                        <div className="text-xl sm:text-2xl font-black tabular-nums tracking-tighter group-hover:text-indigo-400 transition-colors">
                          {match.home.score} - {match.away.score}
                        </div>
                        <div
                          className={`text-xs font-medium mt-1 flex items-center gap-1.5 ${
                            match.status === "LIVE" ? "text-red-400 animate-pulse font-bold" : "text-gray-400"
                          }`}
                        >
                          {match.status === "LIVE" && (
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                          )}
                          {timeDisplay}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm sm:text-base font-bold text-gray-400 group-hover:text-indigo-400 transition-colors">
                          VS
                        </div>
                        <div className="text-xs font-medium mt-1 text-gray-400">{match.date}</div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 flex-1 justify-end">
                    <span className="font-semibold text-sm sm:text-lg text-right">{match.away.name}</span>
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white text-xs sm:text-sm">
                      {match.away.abbr}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
