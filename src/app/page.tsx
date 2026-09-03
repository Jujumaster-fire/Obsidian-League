import Navigation from '@/components/Navigation'
import Link from 'next/link'

// Define data outside of component where possible
const insights = [
  { title: "The Rise of the Crimson Kings", category: "Tournament Analysis", desc: "An in-depth look at how tactical shifts have propelled them to the top of the leaderboard this season.", img: "https://images.unsplash.com/photo-1518605368461-1e12c1ce3466?q=80&w=1200&auto=format&fit=crop" },
  { title: "Midfield Maestros of the League", category: "Player Spotlight", desc: "Who is truly controlling the tempo in the Obsidian Elite? We break down the stats.", img: "https://images.unsplash.com/photo-1522778119026-d647f0596c20?q=80&w=1200&auto=format&fit=crop" },
  { title: "Defensive Masterclasses", category: "Tactics", desc: "How to effectively shut down the highest scoring teams in the competition.", img: "https://images.unsplash.com/photo-1574629810360-7efbb1925536?q=80&w=1200&auto=format&fit=crop" },
  { title: "Underdogs to Watch", category: "Season Preview", desc: "These teams might not have the biggest budgets, but they are ready to cause upsets.", img: "https://images.unsplash.com/photo-1508344928928-7137b29de216?q=80&w=1200&auto=format&fit=crop" },
]

// Note: any is okay here temporarily while structure is mocked out as requested by the user, but replacing any with unknown fixes lint errors.
const renderMatchList = (matches: unknown[], emptyMessage: string) => {
  if (matches.length === 0) {
      return (
          <div className="bg-[#1e293b] rounded-xl p-8 text-center border border-white/5 text-gray-400">
              {emptyMessage}
          </div>
      )
  }
  return (
      <div className="space-y-4">
          {matches.map((match, i) => (
              <div key={i} className="bg-[#1e293b] rounded-xl p-6 border border-white/5">
                  {/* Placeholder for real match data rendering */}
                  Match Details
              </div>
          ))}
      </div>
  )
}

const MatchesOfTheDaySection = ({ matches }: { matches: unknown[] }) => (
  <section>
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          Matches of the Day
      </h2>
      {renderMatchList(matches, "No matches scheduled for today.")}
  </section>
)

const UpcomingFixturesSection = ({ matches }: { matches: unknown[] }) => (
  <section>
      <h2 className="text-2xl font-bold mb-6">Upcoming Fixtures</h2>
      {renderMatchList(matches, "No upcoming fixtures scheduled.")}
  </section>
)

const ConcludedMatchesSection = ({ matches }: { matches: unknown[] }) => (
  <section>
      <h2 className="text-2xl font-bold mb-6">Results</h2>
      {renderMatchList(matches, "No recent results available.")}
  </section>
)

const InsightsSection = () => (
  <section>
      <div className="flex justify-between items-end mb-6">
          <h2 className="text-2xl font-bold">Latest Insights</h2>
      </div>
      <div className="flex overflow-x-auto gap-6 pb-4 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {insights.map((insight, i) => (
              <div key={i} className="snap-center shrink-0 w-72 sm:w-80 bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 group cursor-pointer">
                  <div className="h-48 bg-gradient-to-br from-indigo-900 to-slate-800 relative">
                      <div className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-overlay group-hover:scale-105 transition-transform duration-700" style={{backgroundImage: `url('${insight.img}')`}}></div>
                  </div>
                  <div className="p-6">
                      <div className="text-xs text-indigo-400 font-medium mb-2">{insight.category}</div>
                      <h4 className="font-bold text-lg mb-2 line-clamp-2">{insight.title}</h4>
                      <p className="text-gray-400 text-sm line-clamp-2">{insight.desc}</p>
                  </div>
              </div>
          ))}
      </div>
  </section>
)

const RegistrationBanner = () => (
  <section className="bg-gradient-to-r from-indigo-900 via-purple-900 to-indigo-900 rounded-2xl p-8 sm:p-12 text-center shadow-2xl relative overflow-hidden border border-indigo-500/30">
      <div className="absolute top-0 left-0 w-full h-full bg-[url('https://images.unsplash.com/photo-1518605368461-1e12c1ce3466?q=80&w=1200&auto=format&fit=crop')] opacity-10 mix-blend-overlay bg-cover bg-center"></div>
      <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl -mr-32 -mt-32"></div>
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -ml-32 -mb-32"></div>

      <div className="relative z-10">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4 text-white tracking-tight">Ready to Prove Yourself?</h2>
          <p className="text-indigo-200 mb-8 max-w-2xl mx-auto text-lg">Register your team for the next Obsidian Elite tournament and compete for glory against the best in the league.</p>
          <Link href="/register" className="inline-block bg-white text-indigo-900 font-bold py-3 px-8 rounded-full hover:bg-indigo-50 transition-colors shadow-[0_0_30px_rgba(255,255,255,0.3)] transform hover:-translate-y-1">
              Register Your Team
          </Link>
      </div>
  </section>
)

export default function Home() {
  // Empty data as requested
  const matchesOfTheDay: unknown[] = []
  const upcomingFixtures: unknown[] = []
  const concludedMatches: unknown[] = []

  const hasMatches = matchesOfTheDay.length > 0;

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />
      <div className="pt-16">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">

          <div className="text-center space-y-4 mb-4">
             <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Obsidian Elite</h1>
             <p className="text-gray-400 max-w-2xl mx-auto text-lg">The premier destination for high-stakes tournament action. Track live scores, view team profiles, and follow the journey to the championship.</p>
          </div>

          {hasMatches ? (
             <>
                <MatchesOfTheDaySection matches={matchesOfTheDay} />
                <InsightsSection />
                <RegistrationBanner />
                <UpcomingFixturesSection matches={upcomingFixtures} />
                <ConcludedMatchesSection matches={concludedMatches} />
             </>
          ) : (
             <>
                <UpcomingFixturesSection matches={upcomingFixtures} />
                <InsightsSection />
                <RegistrationBanner />
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
