import Navigation from '@/components/Navigation'

export default function CompetitionsPage() {
  // Empty data as requested
  const groups = [
    { name: 'Group A', teams: [] },
    { name: 'Group B', teams: [] },
    { name: 'Group C', teams: [] },
    { name: 'Group D', teams: [] },
  ]

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <header className="mb-12 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">Competitions</h1>
          <p className="text-gray-400 max-w-2xl text-lg">Current group standings for the Obsidian Elite tournament.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          {groups.map((group, i) => (
            <div key={i} className="bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 shadow-xl">
              <div className="bg-gradient-to-r from-indigo-900 to-slate-800 p-4 border-b border-white/10">
                <h2 className="font-bold text-xl">{group.name}</h2>
              </div>
              <div className="p-4 space-y-3">
                {/* 4 empty team slots */}
                {[...Array(4)].map((_, j) => (
                  <div key={j} className="flex items-center gap-3 p-3 rounded-lg bg-[#0f172a]/50 border border-white/5 opacity-50">
                     <div className="w-8 h-8 rounded-full bg-slate-700"></div>
                     <div className="flex-1">
                        <div className="h-4 bg-slate-700 rounded w-24 mb-2"></div>
                        <div className="h-2 bg-slate-700 rounded w-16"></div>
                     </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
