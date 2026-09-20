import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import { NewsList } from '@/components/NewsList'
import { cachedRestGet } from '@/lib/public-api'
import { cacheKey } from '@/lib/cache'
import type { NewsPost } from '@/components/NewsList'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'News | Obsidian Elite',
  description: 'Match reports, tactical breakdowns and tournament announcements from the Obsidian Elite league.',
  openGraph: {
    title: 'News | Obsidian Elite',
    description: 'Match reports, tactical breakdowns and tournament announcements from the Obsidian Elite league.',
    siteName: 'Obsidian Elite',
    type: 'website',
  },
}

export default async function NewsPage() {
  const posts = await cachedRestGet<NewsPost>(
    'tournament_posts?select=id,title,slug,excerpt,category,image_url,published_at,tournament_id,tournaments(name,slug)&published=is.true&order=published_at.desc&limit=60',
    {
      // Article lists change a few times a day — a good shared-cache candidate.
      sharedKey: cacheKey('public', 'news', 'list'),
      sharedTtlSeconds: 300,
      revalidate: 60,
    }
  )

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div data-tour="news-list" className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-2">Newsroom</h1>
          <p className="text-gray-400 max-w-2xl text-lg">
            Match reports, tactical breakdowns and tournament announcements from the Obsidian Elite.
          </p>
        </header>

        <NewsList posts={posts} />
      </div>
    </div>
  )
}