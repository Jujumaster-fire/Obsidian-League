import Navigation from '@/components/Navigation'

export default function TeamProfile() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <Navigation />
      <div className="pt-16">

        {/* Team Header Hero */}
        <div className="relative h-80 bg-[#1e293b] overflow-hidden border-b border-white/10">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1556056504-5c7696c4c28d?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center opacity-30 mix-blend-luminosity"></div>
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/80 to-transparent"></div>

            <div className="absolute bottom-0 w-full">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 flex items-end gap-8">
                    <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-red-600 to-red-900 flex items-center justify-center shadow-[0_0_40px_rgba(220,38,38,0.4)] border-2 border-red-500/50 flex-shrink-0">
                        <span className="text-5xl font-black text-white tracking-tighter">CK</span>
                    </div>
                    <div className="mb-2">
                        <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-2">Crimson Kings</h1>
                        <p className="text-gray-400 font-medium">Est. 2021 &bull; Sector 4, Neon District &bull; Head Coach: Marcus Vance</p>
                    </div>
                </div>
            </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Left Column: Stats & Info */}
                <div className="space-y-8">
                    <div className="bg-[#1e293b] rounded-2xl p-6 border border-white/5">
                        <h3 className="font-bold text-xl mb-6 border-b border-white/10 pb-4">Season Overview</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-[#0f172a] p-4 rounded-xl border border-white/5 text-center">
                                <div className="text-3xl font-black text-red-400 mb-1">1st</div>
                                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">League Pos</div>
                            </div>
                            <div className="bg-[#0f172a] p-4 rounded-xl border border-white/5 text-center">
                                <div className="text-3xl font-black text-white mb-1">28</div>
                                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Points</div>
                            </div>
                            <div className="bg-[#0f172a] p-4 rounded-xl border border-white/5 text-center">
                                <div className="text-3xl font-black text-white mb-1">9</div>
                                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Wins</div>
                            </div>
                            <div className="bg-[#0f172a] p-4 rounded-xl border border-white/5 text-center">
                                <div className="text-3xl font-black text-green-400 mb-1">+14</div>
                                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Goal Diff</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#1e293b] rounded-2xl p-6 border border-white/5">
                        <h3 className="font-bold text-xl mb-6 border-b border-white/10 pb-4">Recent Form</h3>
                        <div className="flex gap-2 justify-between">
                            {['W', 'W', 'D', 'W', 'L'].map((result, i) => (
                                <div key={i} className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                                    result === 'W' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                    result === 'D' ? 'bg-gray-500/20 text-gray-400 border border-gray-500/30' :
                                    'bg-red-500/20 text-red-400 border border-red-500/30'
                                }`}>
                                    {result}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Column: Roster */}
                <div className="lg:col-span-2">
                    <div className="bg-[#1e293b] rounded-2xl p-6 border border-white/5">
                        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                            <h3 className="font-bold text-xl">Active Roster</h3>
                            <button className="text-sm text-indigo-400 hover:text-indigo-300 font-medium">Full Squad &rarr;</button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                                        <th className="pb-3 font-semibold">No.</th>
                                        <th className="pb-3 font-semibold">Player</th>
                                        <th className="pb-3 font-semibold">Position</th>
                                        <th className="pb-3 font-semibold text-right">Apps</th>
                                        <th className="pb-3 font-semibold text-right">Gls</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    <tr className="hover:bg-white/5 transition-colors group cursor-pointer">
                                        <td className="py-4 text-gray-400 font-mono">01</td>
                                        <td className="py-4 font-medium text-white flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden"></div>
                                            David Chen
                                        </td>
                                        <td className="py-4 text-gray-400 text-sm">Goalkeeper</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">12</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">0</td>
                                    </tr>
                                    <tr className="hover:bg-white/5 transition-colors group cursor-pointer">
                                        <td className="py-4 text-gray-400 font-mono">04</td>
                                        <td className="py-4 font-medium text-white flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden"></div>
                                            Marcus Silva <span className="text-xs bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">C</span>
                                        </td>
                                        <td className="py-4 text-gray-400 text-sm">Defender</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">11</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">1</td>
                                    </tr>
                                    <tr className="hover:bg-white/5 transition-colors group cursor-pointer">
                                        <td className="py-4 text-gray-400 font-mono">08</td>
                                        <td className="py-4 font-medium text-white flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden"></div>
                                            Jaxon Sterling
                                        </td>
                                        <td className="py-4 text-gray-400 text-sm">Midfielder</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">12</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">4</td>
                                    </tr>
                                    <tr className="hover:bg-white/5 transition-colors group cursor-pointer">
                                        <td className="py-4 text-gray-400 font-mono">10</td>
                                        <td className="py-4 font-medium text-white flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden"></div>
                                            Kaelen Thorne
                                        </td>
                                        <td className="py-4 text-gray-400 text-sm">Forward</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">10</td>
                                        <td className="py-4 text-right tabular-nums text-gray-300">8</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
        </main>
      </div>
    </div>
  )
}
