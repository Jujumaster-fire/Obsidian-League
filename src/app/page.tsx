import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { HomeInsights } from '@/components/HomeInsights'
import { restGet } from '@/lib/public-api'
import type { InsightPost } from '@/components/HomeInsights'
import {
  buildRegistrationMailto,
  buildWhatsAppUrl,
  type RegistrationTarget,
} from '@/lib/registration'

/** Live-ish home page: 30s freshness window. */
export const revalidate = 30

/** PostgREST projection reused by the three fixture lists below. */
const FIXTURE_SELECT = '*,home_team:home_team_id(*),away_team:away_team_id(*)'

interface FixtureRow {
  id: string
  status: string | null
  match_date: string
  home_score: number | null
  away_score: number | null
  current_minute: number | null
  home_team: { name: string | null; short_name: string | null } | null
  away_team: { name: string | null; short_name: string | null } | null
}

// Render DTOs for the three live home fixture sections.
interface TeamCardInfo {
  name: string;
  abbr: string;
  score?: number;
}
interface MatchCardRow {
  id: string;
  home: TeamCardInfo;
  away: TeamCardInfo;
  status: string;
  time?: string;
  date?: string;
}

const renderMatchList = (matches: MatchCardRow[], emptyMessage: string) => {
  if (matches.length === 0) {
      return (
          <div className="bg-[#1e293b] rounded-xl p-8 text-center border border-white/5 text-gray-400">
              {emptyMessage}
          </div>
      )
  }
  return (
      <div className="space-y-4">
          {matches.map((match) => (
              <Link href={`/match/${match.id}`} key={match.id} className="block">
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

                          <div className="flex items-center gap-3 sm:gap-4 flex-1 justify-end">
                              <span className="font-semibold text-sm sm:text-lg text-right">{match.away.name}</span>
                              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white text-xs sm:text-sm">{match.away.abbr}</div>
                          </div>
                      </div>
                  </div>
              </Link>
          ))}
      </div>
  )
}

const MatchesOfTheDaySection = ({ matches }: { matches: MatchCardRow[] }) => (
  <section>
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          Matches of the Day
      </h2>
      {renderMatchList(matches, "No matches scheduled for today.")}
  </section>
)

const UpcomingFixturesSection = ({ matches }: { matches: MatchCardRow[] }) => (
  <section>
      <h2 className="text-2xl font-bold mb-6">Upcoming Fixtures</h2>
      {renderMatchList(matches, "No upcoming fixtures scheduled.")}
  </section>
)

const ConcludedMatchesSection = ({ matches }: { matches: MatchCardRow[] }) => (
  <section>
      <h2 className="text-2xl font-bold mb-6">Results</h2>
      {renderMatchList(matches, "No recent results available.")}
  </section>
)

/**
 * Team registration CTA.
 *
 * Points at the organisers' WhatsApp / inbox with the shared message template
 * from `@/lib/registration` (documented in the deployment guide) prefilled with the active
 * tournament's name, dates and host city. Falls back to the newsroom when no
 * channel is configured, so the banner is never a dead link.
 */
const RegistrationBanner = ({ tournament }: { tournament: RegistrationTarget | null }) => {
  const target: RegistrationTarget = tournament ?? {}
  const whatsappUrl = buildWhatsAppUrl(target)
  const mailtoUrl = buildRegistrationMailto(target)
  const eventLabel =
    [target.name, target.edition].filter(Boolean).join(' — ') || 'the next Obsidian Elite tournament'
  const dateLine =
    target.start_date || target.end_date
      ? `${target.start_date ?? 'TBC'} → ${target.end_date ?? 'TBC'}`
      : null

  return (
    <section className="bg-gradient-to-r from-indigo-900 via-purple-900 to-indigo-900 rounded-2xl p-8 sm:p-12 text-center shadow-2xl relative overflow-hidden border border-indigo-500/30">
      <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl -mr-32 -mt-32"></div>
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -ml-32 -mb-32"></div>

      <div className="relative z-10">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-4 text-white tracking-tight">
          Ready to Prove Yourself?
        </h2>
        <p className="text-indigo-200 mb-2 max-w-2xl mx-auto text-lg">
          Register your team for {eventLabel} and compete for glory against the best in the league.
        </p>
        {(dateLine || target.venue_city) && (
          <p className="text-indigo-300/80 text-sm mb-8">
            {[dateLine, target.venue_city ? `Host city: ${target.venue_city}` : null]
              .filter(Boolean)
              .join(' • ')}
          </p>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 bg-[#25D366] text-[#0b3d20] font-bold py-3 px-8 rounded-full hover:bg-[#1ebe5b] transition-colors shadow-[0_0_30px_rgba(37,211,102,0.35)] transform hover:-translate-y-1"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.347-.347.52-.52.174-.174.232-.298.347-.497.115-.198.058-.372-.03-.52-.086-.148-.664-1.6-.91-2.19-.239-.577-.482-.5-.663-.508-.171-.008-.368-.01-.565-.01-.197 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347z" />
                <path d="M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.892c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a12.03 12.03 0 0 0 5.71 1.447h.006c6.585 0 11.946-5.335 11.949-11.893a11.82 11.82 0 0 0-3.48-8.453zM12.05 21.785h-.005a9.98 9.98 0 0 1-5.08-1.387l-.364-.216-3.759.98 1.005-3.653-.24-.377a9.83 9.83 0 0 1-1.51-5.24c.002-5.45 4.455-9.884 9.938-9.884a9.86 9.86 0 0 1 7.017 2.9 9.79 9.79 0 0 1 2.91 6.99c-.003 5.45-4.456 9.887-9.912 9.887z" />
              </svg>
              Register on WhatsApp
            </a>
          )}

          {mailtoUrl && (
            <a
              href={mailtoUrl}
              className="inline-flex items-center gap-3 bg-white text-indigo-900 font-bold py-3 px-8 rounded-full hover:bg-indigo-50 transition-colors shadow-[0_0_30px_rgba(255,255,255,0.3)] transform hover:-translate-y-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email the organisers
            </a>
          )}

          {!whatsappUrl && !mailtoUrl && (
            <Link
              href="/news"
              className="inline-block bg-white text-indigo-900 font-bold py-3 px-8 rounded-full hover:bg-indigo-50 transition-colors shadow-[0_0_30px_rgba(255,255,255,0.3)] transform hover:-translate-y-1"
            >
              Registration updates in the newsroom
            </Link>
          )}
        </div>

        {(whatsappUrl || mailtoUrl) && (
          <p className="mt-6 text-xs text-indigo-200/80">
            Your message is pre-filled with the details we need — just add your team information and
            send.
          </p>
        )}
      </div>
    </section>
  )
}

export default async function Home() {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date()
  endOfDay.setHours(23, 59, 59, 999)

  // Single source of truth for the fixture projection used by the three
  // queries below.
  const matchesSelect = FIXTURE_SELECT

  // Cached public reads (Next Data Cache: `revalidate` + the shared
  // `public-data` tag busted by POST /api/revalidate). Reading through
  // `restGet` instead of the cookie-bound Supabase client keeps this route
  // cacheable, so a traffic spike is served from the edge/ISR cache rather
  // than from Postgres — see SECURITY_AND_SCALING.md §2.
  const [todayMatchesData, upcomingMatchesData, concludedMatchesData, postsData, activeTournamentRows] =
    await Promise.all([
      restGet<FixtureRow>(
        `fixtures?select=${matchesSelect}&match_date=gte.${startOfDay.toISOString()}&match_date=lte.${endOfDay.toISOString()}&order=match_date.asc`
      ),
      restGet<FixtureRow>(
        `fixtures?select=${matchesSelect}&match_date=gt.${endOfDay.toISOString()}&order=match_date.asc&limit=5`
      ),
      restGet<FixtureRow>(
        `fixtures?select=${matchesSelect}&status=in.(full_time,cancelled)&order=match_date.desc&limit=5`
      ),
      restGet<InsightPost>(
        'tournament_posts?select=id,title,slug,excerpt,category,image_url,published_at&published=is.true&order=published_at.desc&limit=6'
      ),
      restGet<RegistrationTarget & { is_active?: boolean }>(
        'tournaments?select=name,slug,edition,venue_city,start_date,end_date,is_active&is_active=is.true&limit=1',
        { revalidate: 300 }
      ),
    ])

  const activeTournament = activeTournamentRows[0] ?? null

  const matchesOfTheDay: MatchCardRow[] = todayMatchesData.map((m) => ({
    id: m.id,
    home: { name: m.home_team?.name || 'Unknown', abbr: m.home_team?.short_name || 'UNK', score: m.home_score ?? undefined },
    away: { name: m.away_team?.name || 'Unknown', abbr: m.away_team?.short_name || 'UNK', score: m.away_score ?? undefined },
    status: m.status === 'in_progress' ? 'LIVE' : m.status ?? 'scheduled',
    time: m.current_minute ? m.current_minute + "'" : new Date(m.match_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }))
  const upcomingFixtures: MatchCardRow[] = upcomingMatchesData.map((m) => ({
    id: m.id,
    home: { name: m.home_team?.name || 'Unknown', abbr: m.home_team?.short_name || 'UNK' },
    away: { name: m.away_team?.name || 'Unknown', abbr: m.away_team?.short_name || 'UNK' },
    status: 'UPCOMING',
    date: new Date(m.match_date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }))
  const concludedMatches: MatchCardRow[] = concludedMatchesData.map((m) => ({
    id: m.id,
    home: { name: m.home_team?.name || 'Unknown', abbr: m.home_team?.short_name || 'UNK', score: m.home_score ?? undefined },
    away: { name: m.away_team?.name || 'Unknown', abbr: m.away_team?.short_name || 'UNK', score: m.away_score ?? undefined },
    status: m.status === 'full_time' ? 'FT' : 'CANCELLED'
  }))

  const hasMatches = matchesOfTheDay.length > 0

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />
      <div className="pt-16">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">

          <div className="text-center space-y-4 mb-4">
            <h1 className="text-gray-400 max-w-2xl mx-auto text-lg font-normal">
              The premier destination for high-stakes tournament action. Track live scores, view team profiles, and follow the journey to the championship.
            </h1>
          </div>

          {hasMatches ? (
             <>
                <div data-tour="home-matchday">
                  <MatchesOfTheDaySection matches={matchesOfTheDay} />
                </div>
                <div data-tour="home-insights">
                  <HomeInsights posts={postsData} />
                </div>
                <div data-tour="home-registration">
                  <RegistrationBanner tournament={activeTournament} />
                </div>
                <UpcomingFixturesSection matches={upcomingFixtures} />
                <ConcludedMatchesSection matches={concludedMatches} />
             </>
          ) : (
             <>
                <UpcomingFixturesSection matches={upcomingFixtures} />
                <div data-tour="home-insights">
                  <HomeInsights posts={postsData} />
                </div>
                <div data-tour="home-registration">
                  <RegistrationBanner tournament={activeTournament} />
                </div>
                <ConcludedMatchesSection matches={concludedMatches} />
             </>
          )}

        </main>
      </div>

      <div className="fixed bottom-8 left-0 right-0 z-40 flex justify-center pointer-events-none px-4">
        <div className="pointer-events-auto">
            <Link href="/login" className="flex items-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-8 rounded-full shadow-[0_10px_40px_rgba(79,70,229,0.6)] transition-all transform hover:scale-105 border border-indigo-400/50 backdrop-blur-md">
                <span className="text-base sm:text-lg">Sign Up & Follow Your Team</span>
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </Link>
        </div>
      </div>
    </div>
  )
}
