'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'

export function CompetitionsFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentSport = searchParams.get('sport') || 'Football'
  const currentGender = searchParams.get('gender') || 'Female'

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const FIELD_CLASSES =
    'bg-[#1e293b] border border-white/10 rounded-lg py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors'

  return (
    <div className="flex flex-wrap items-center gap-4 mb-6 mt-4">
      <div className="flex items-center gap-2">
        <label htmlFor="global-sport-filter" className="text-sm font-medium text-gray-400">
          Sport:
        </label>
        <select
          id="global-sport-filter"
          value={currentSport}
          onChange={(e) => handleFilterChange('sport', e.target.value)}
          className={`${FIELD_CLASSES} px-4`}
        >
          <option value="Football">Football</option>
          <option value="Futsal">Futsal</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="global-gender-filter" className="text-sm font-medium text-gray-400">
          Category:
        </label>
        <select
          id="global-gender-filter"
          value={currentGender}
          onChange={(e) => handleFilterChange('gender', e.target.value)}
          className={`${FIELD_CLASSES} px-4`}
        >
          <option value="Female">Female</option>
          <option value="Male">Male</option>
        </select>
      </div>
    </div>
  )
}
