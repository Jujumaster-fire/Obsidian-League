import { BrandedLoader } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <div className="pt-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <BrandedLoader message="Loading the guide…" />
      </div>
    </div>
  )
}
