import Navigation from '@/components/Navigation'

export default function MatchCenter() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <Navigation />
      <div className="pt-16">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            {/* Scoreboard Header */}
            <div className="bg-[#1e293b] rounded-2xl p-8 mb-8 border border-white/5 relative overflow-hidden shadow-2xl">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-gradient-to-b from-indigo-500/10 to-transparent pointer-events-none"></div>

                <div className="text-center mb-6 relative z-10">
                    <span className="inline-block px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-sm font-bold tracking-wider animate-pulse border border-red-500/30">
                        LIVE &bull; 68'
                    </span>
                    <div className="text-gray-400 text-sm mt-3 font-medium">Obsidian Premier League &bull; Matchday 12</div>
                    <div className="text-gray-500 text-xs mt-1">Neon Arena, Sector 4</div>
                </div>

                <div className="flex items-center justify-between max-w-2xl mx-auto relative z-10">
                    {/* Home Team */}
                    <div className="flex flex-col items-center gap-4 flex-1">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-red-600 to-red-900 flex items-center justify-center shadow-[0_0_30px_rgba(220,38,38,0.3)] border-2 border-red-500/30 relative">
                            <span className="text-4xl font-black text-white">CK</span>
                        </div>
                        <h2 className="text-xl font-bold tracking-tight text-center">Crimson Kings</h2>
                        <div className="text-sm text-gray-400 font-medium">4-3-3</div>
                    </div>

                    {/* Score */}
                    <div className="flex flex-col items-center px-8">
                        <div className="text-6xl font-black tracking-tighter tabular-nums flex items-center gap-4">
                            <span className="text-white">2</span>
                            <span className="text-gray-600 text-4xl">-</span>
                            <span className="text-gray-400">1</span>
                        </div>
                    </div>

                    {/* Away Team */}
                    <div className="flex flex-col items-center gap-4 flex-1">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-600 to-blue-900 flex items-center justify-center shadow-[0_0_30px_rgba(37,99,235,0.3)] border-2 border-blue-500/30 relative opacity-80">
                            <span className="text-4xl font-black text-white">NK</span>
                        </div>
                        <h2 className="text-xl font-bold tracking-tight text-center text-gray-300">Neon Knights</h2>
                        <div className="text-sm text-gray-500 font-medium">3-5-2</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Match Events */}
                <div className="lg:col-span-2 space-y-6">
                    <h3 className="text-2xl font-bold tracking-tight border-b border-white/10 pb-4">Match Timeline</h3>
                    <div className="relative pl-8 space-y-8 before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">

                        {/* Event 1 */}
                        <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-[#0f172a] bg-red-500 absolute left-2 md:left-1/2 -translate-x-1/2 shadow-[0_0_10px_rgba(239,68,68,0.5)] z-10"></div>
                            <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] bg-[#1e293b] p-4 rounded-xl border border-white/5 shadow-md ml-auto md:ml-0 md:mr-auto">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-bold text-red-400">Crimson Kings</span>
                                    <span className="text-xs font-mono bg-white/5 px-2 py-1 rounded text-gray-300">68'</span>
                                </div>
                                <div className="font-medium text-white flex items-center gap-2">
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
                                    Red Card - K. Thorne
                                </div>
                                <div className="text-sm text-gray-400 mt-2">Reckless challenge, straight red.</div>
                            </div>
                        </div>

                        {/* Event 2 */}
                        <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-[#0f172a] bg-white absolute left-2 md:left-1/2 -translate-x-1/2 z-10"></div>
                            <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] bg-[#1e293b] p-4 rounded-xl border border-white/5 shadow-md ml-auto md:ml-0 md:mr-auto">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-bold text-red-400">Crimson Kings</span>
                                    <span className="text-xs font-mono bg-white/5 px-2 py-1 rounded text-gray-300">42'</span>
                                </div>
                                <div className="font-medium text-white flex items-center gap-2">
                                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                                    Goal - J. Sterling
                                </div>
                                <div className="text-sm text-gray-400 mt-2">Powerful strike from outside the box. Assist: M. Vance.</div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* Match Stats */}
                <div className="space-y-6">
                    <h3 className="text-2xl font-bold tracking-tight border-b border-white/10 pb-4">Match Stats</h3>
                    <div className="bg-[#1e293b] rounded-2xl p-6 border border-white/5 space-y-6">

                        {/* Stat Item */}
                        <div>
                            <div className="flex justify-between text-sm font-medium mb-2">
                                <span className="text-red-400">58%</span>
                                <span className="text-gray-400 uppercase text-xs tracking-wider">Possession</span>
                                <span className="text-blue-400">42%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full flex overflow-hidden">
                                <div className="bg-red-500 h-full" style={{width: '58%'}}></div>
                                <div className="bg-blue-500 h-full" style={{width: '42%'}}></div>
                            </div>
                        </div>

                        {/* Stat Item */}
                        <div>
                            <div className="flex justify-between text-sm font-medium mb-2">
                                <span className="text-red-400">14</span>
                                <span className="text-gray-400 uppercase text-xs tracking-wider">Shots</span>
                                <span className="text-blue-400">8</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full flex overflow-hidden">
                                <div className="bg-red-500 h-full" style={{width: '63%'}}></div>
                                <div className="bg-blue-500 h-full" style={{width: '37%'}}></div>
                            </div>
                        </div>

                         {/* Stat Item */}
                         <div>
                            <div className="flex justify-between text-sm font-medium mb-2">
                                <span className="text-red-400">6</span>
                                <span className="text-gray-400 uppercase text-xs tracking-wider">Shots on Target</span>
                                <span className="text-blue-400">3</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full flex overflow-hidden">
                                <div className="bg-red-500 h-full" style={{width: '66%'}}></div>
                                <div className="bg-blue-500 h-full" style={{width: '33%'}}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </main>
      </div>
    </div>
  )
}
