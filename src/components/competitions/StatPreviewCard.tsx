'use client'

import type { StatModalRow } from './StatModal'

interface StatPreviewCardProps {
  title: string
  data: StatModalRow[]
  themeColor?: 'indigo' | 'emerald' | 'rose' | 'amber' | 'blue' | 'yellow'
  isTotalView?: boolean
  onClick: () => void
}

export function StatPreviewCard({ title, data, themeColor = 'indigo', isTotalView = false, onClick }: StatPreviewCardProps) {
  const colorMap = {
    indigo: 'text-indigo-400',
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
  }

  const textColorClass = colorMap[themeColor]
  const totalValue = data.reduce((acc, row) => acc + (typeof row.value === 'number' ? row.value : 0), 0)

  return (
    <div
      onClick={onClick}
      className="bg-[#1e293b] rounded-xl border border-white/5 overflow-hidden cursor-pointer hover:border-white/20 transition-all group hover:shadow-lg hover:-translate-y-1 duration-200 flex flex-col h-full"
    >
      <div className="p-5 border-b border-white/5 flex justify-between items-start bg-black/10">
        <h3 className="font-bold text-lg text-white group-hover:text-gray-200">{title}</h3>
        {isTotalView && (
          <div className="bg-black/40 px-3 py-1 rounded text-sm font-mono border border-white/5 shadow-inner">
            Total: <span className={`font-bold ${textColorClass}`}>{totalValue}</span>
          </div>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col justify-center">
        {data.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No data yet.</p>
        ) : (
          <div className="space-y-4">
            {data.slice(0, 3).map((row, idx) => (
              <div key={row.id || idx} className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 w-4 text-center">{idx + 1}</span>
                  <div>
                    <div className="font-medium text-gray-200">{row.title}</div>
                    {row.subtitle && <div className="text-xs text-gray-500">{row.subtitle}</div>}
                  </div>
                </div>
                <div className={`text-xl font-black ${textColorClass}`}>{row.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.length > 3 && (
        <div className="bg-black/20 p-3 text-center border-t border-white/5">
          <span className="text-xs font-medium text-gray-400 group-hover:text-white transition-colors uppercase tracking-wider">
            View full list ({data.length}) &rarr;
          </span>
        </div>
      )}
      {data.length > 0 && data.length <= 3 && (
        <div className="bg-black/20 p-3 text-center border-t border-white/5">
          <span className="text-xs font-medium text-gray-400 group-hover:text-white transition-colors uppercase tracking-wider">
            View full list &rarr;
          </span>
        </div>
      )}
    </div>
  )
}
