import Navigation from '@/components/Navigation'
import { createClient } from '@/utils/supabase/server'
import Link from 'next/link'

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; type?: string }>
}) {
  const supabase = createClient()
  const resolvedParams = await searchParams
  const categoryFilter = resolvedParams.category || 'all'
  const typeFilter = resolvedParams.type || 'all'

  let query = (await supabase).from('teams').select('*').order('name')

  if (categoryFilter !== 'all') {
    query = query.eq('category', categoryFilter)
  }
  if (typeFilter !== 'all') {
    query = query.eq('team_type', typeFilter)
  }

  const { data: teams } = await query

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <header className="mb-8 text-center md:text-left flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-2">Registered Teams</h1>
            <p className="text-gray-400 max-w-2xl text-lg">Browse all teams participating in the Obsidian Elite.</p>
          </div>

          <form className="flex flex-col sm:flex-row gap-3">
             <select name="category" defaultValue={categoryFilter} className="bg-[#1e293b] border border-white/10 rounded-lg px-4 py-2 focus:ring-indigo-500 focus:border-indigo-500">
                <option value="all">All Categories</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
             </select>
             <select name="type" defaultValue={typeFilter} className="bg-[#1e293b] border border-white/10 rounded-lg px-4 py-2 focus:ring-indigo-500 focus:border-indigo-500">
                <option value="all">All Types</option>
                <option value="Football">Football</option>
                <option value="Futsal">Futsal</option>
             </select>
             <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg transition-colors">
               Filter
             </button>
          </form>
        </header>

        {(!teams || teams.length === 0) ? (
          <div className="bg-[#1e293b] rounded-xl p-12 text-center border border-white/5">
             <div className="text-gray-400 text-lg mb-2">No teams found matching your criteria.</div>
             <p className="text-gray-500 text-sm">Admins must register teams in the dashboard first.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {teams.map((team) => (
              <Link href={`/team/${team.id}`} key={team.id}>
                <div className="bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 shadow-xl hover:border-indigo-500/50 hover:shadow-indigo-900/20 transition-all group h-full flex flex-col">
                  <div className={`h-24 w-full flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity`} style={{ backgroundColor: team.attire_color === 'Yet to be decided' ? '#334155' : team.attire_color }}>
                     <span className="text-3xl font-black text-white/50 group-hover:text-white/80">{team.short_name}</span>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <h2 className="font-bold text-xl mb-1 group-hover:text-indigo-300 transition-colors">{team.name}</h2>
                    <div className="flex items-center gap-2 mt-auto pt-4">
                       <span className="text-xs font-medium bg-gray-800 text-gray-300 px-2 py-1 rounded border border-gray-700">{team.category || 'Male'}</span>
                       <span className="text-xs font-medium bg-gray-800 text-gray-300 px-2 py-1 rounded border border-gray-700">{team.team_type || 'Football'}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
