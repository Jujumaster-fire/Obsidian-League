import Navigation from '@/components/Navigation'

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <Navigation />
      <div className="pt-16">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                <div className="lg:col-span-2 space-y-8">
                    <section className="bg-[#1e293b] rounded-2xl p-8 shadow-xl border border-white/5 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
                        <h2 className="text-3xl font-bold mb-2">Welcome to Obsidian Elite</h2>
                        <p className="text-gray-400 mb-8 max-w-xl">The premier destination for high-stakes tournament action. Track live scores, view team profiles, and follow the journey to the championship.</p>

                        <div className="bg-[#0f172a] rounded-xl p-6 border border-white/5">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                                    Live Matches
                                </h3>
                                <a href="/match/demo" className="text-indigo-400 text-sm hover:text-indigo-300">View All</a>
                            </div>

                            <div className="bg-[#1e293b] rounded-lg p-4 flex items-center justify-between border border-white/5 hover:border-indigo-500/50 transition-colors cursor-pointer">
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center font-bold text-red-400">CK</div>
                                    <span className="font-semibold text-lg hidden sm:block">Crimson Kings</span>
                                </div>
                                <div className="flex flex-col items-center px-8">
                                    <div className="text-2xl font-black tabular-nums tracking-tighter">2 - 1</div>
                                    <div className="text-red-400 text-xs font-medium mt-1">68'</div>
                                </div>
                                <div className="flex items-center gap-4 flex-1 justify-end">
                                    <span className="font-semibold text-lg hidden sm:block">Neon Knights</span>
                                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center font-bold text-blue-400">NK</div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <div className="flex justify-between items-end mb-6">
                            <h3 className="text-2xl font-bold">Latest Insights</h3>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-6">
                            <div className="bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 group cursor-pointer">
                                <div className="h-48 bg-gradient-to-br from-indigo-900 to-slate-800 relative">
                                    <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1518605368461-1e12c1ce3466?q=80&w=1200&auto=format&fit=crop')] bg-cover bg-center opacity-40 mix-blend-overlay group-hover:scale-105 transition-transform duration-700"></div>
                                </div>
                                <div className="p-6">
                                    <div className="text-xs text-indigo-400 font-medium mb-2">Tournament Analysis</div>
                                    <h4 className="font-bold text-lg mb-2">The Rise of the Crimson Kings</h4>
                                    <p className="text-gray-400 text-sm line-clamp-2">An in-depth look at how tactical shifts have propelled them to the top of the leaderboard this season.</p>
                                </div>
                            </div>
                            <div className="bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 group cursor-pointer">
                                <div className="h-48 bg-gradient-to-br from-blue-900 to-slate-800 relative">
                                    <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?q=80&w=1200&auto=format&fit=crop')] bg-cover bg-center opacity-40 mix-blend-overlay group-hover:scale-105 transition-transform duration-700"></div>
                                </div>
                                <div className="p-6">
                                    <div className="text-xs text-indigo-400 font-medium mb-2">Player Spotlight</div>
                                    <h4 className="font-bold text-lg mb-2">Midfield Maestros of the League</h4>
                                    <p className="text-gray-400 text-sm line-clamp-2">Who is truly controlling the tempo in the Obsidian Elite? We break down the stats.</p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <div className="space-y-8">
                    <div className="bg-[#1e293b] rounded-2xl p-6 border border-white/5">
                        <h3 className="font-bold text-xl mb-6">Upcoming Fixtures</h3>
                        <div className="space-y-4">
                            {[
                                { home: 'Iron Wolves', away: 'Shadow Strikers', date: 'Tomorrow, 18:00' },
                                { home: 'Azure Titans', away: 'Golden Eagles', date: 'Sat, 14:30' },
                                { home: 'Crimson Kings', away: 'Vortex FC', date: 'Sun, 16:00' }
                            ].map((match, i) => (
                                <div key={i} className="flex justify-between items-center p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
                                    <div className="flex-1 text-right font-medium">{match.home}</div>
                                    <div className="px-4 text-xs text-gray-500 font-mono text-center w-24">{match.date}</div>
                                    <div className="flex-1 font-medium">{match.away}</div>
                                </div>
                            ))}
                        </div>
                        <button className="w-full mt-6 py-3 rounded-lg border border-white/10 text-sm font-medium hover:bg-white/5 transition-colors">
                            Full Schedule
                        </button>
                    </div>

                    <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-6 border border-white/10 relative overflow-hidden">
                        <div className="relative z-10">
                            <h3 className="font-bold text-xl mb-2 text-white">Join the Elite</h3>
                            <p className="text-indigo-200 text-sm mb-6">Create an account to track your favorite teams and get personalized notifications.</p>
                            <a href="/login" className="block text-center w-full bg-white text-indigo-900 font-bold py-3 rounded-lg hover:bg-gray-100 transition-colors">
                                Sign Up Now
                            </a>
                        </div>
                    </div>
                </div>

            </div>
        </main>
      </div>
    </div>
  )
}
