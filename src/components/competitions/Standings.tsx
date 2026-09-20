import type { StandingsRow } from '@/lib/competitions-standings'

interface StandingsTableProps {
  rows: StandingsRow[]
}

export function StandingsTable({ rows }: StandingsTableProps) {
  if (rows.length === 0) {
    return (
      <table className="w-full text-left text-sm">
        <tbody>
          <tr>
            <td colSpan={7} className="p-8 text-center text-gray-500 italic">
              No teams assigned to this group yet.
            </td>
          </tr>
        </tbody>
      </table>
    )
  }

  return (
    <div className="bg-[#1e293b] rounded-lg p-6 border border-white/5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/20 text-gray-400">
          <tr>
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Team</th>
            <th className="px-4 py-3 text-center">P</th>
            <th className="px-4 py-3 text-center">W</th>
            <th className="px-4 py-3 text-center">D</th>
            <th className="px-4 py-3 text-center">L</th>
            <th className="px-4 py-3 text-center">GD</th>
            <th className="px-4 py-3 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, index) => (
            <tr
              key={t.id}
              className={`hover:bg-white/5 ${index < 2 ? 'border-l-4 border-indigo-500' : ''}`}
            >
              <td className="px-4 py-3 font-semibold">{index + 1}</td>
              <td className="px-4 py-3">{t.name}</td>
              <td className="px-4 py-3 text-center">{t.played}</td>
              <td className="px-4 py-3 text-center">{t.won}</td>
              <td className="px-4 py-3 text-center">{t.drawn}</td>
              <td className="px-4 py-3 text-center">{t.lost}</td>
              <td className="px-4 py-3 text-center">{t.gd > 0 ? `+${t.gd}` : t.gd}</td>
              <td className="px-4 py-3 text-right font-bold text-lg text-indigo-400">{t.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
