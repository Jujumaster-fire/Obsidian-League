'use client'

import Link from 'next/link'
import { useMemo, useRef } from 'react'

/** Public post shape used by the home carousel (subset of `tournament_posts`). */
export interface InsightPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  category: string | null
  image_url: string | null
  published_at: string | null
}

/** Empty state shown when the league has not published any post yet. */
export function InsightsEmptyState() {
  return (
    <div className="rounded-xl border border-white/5 bg-[#1e293b] p-8 text-center">
      <p className="text-sm text-gray-400">No insights published yet.</p>
      <Link href="/news" className="mt-3 inline-block text-sm font-medium text-indigo-400 hover:text-indigo-300">
        Browse all news
      </Link>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Deterministic (UTC, no Intl) label so pre-render and hydration match. */
const formatPostDate = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

interface InsightCardData {
  key: string
  title: string
  category: string
  description: string
  image: string | null
  date: string
  slug: string | null
}

const CARD_CLASSES =
  'snap-center shrink-0 w-72 sm:w-80 bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 group flex flex-col'

const InsightCardBody = ({ card }: { card: InsightCardData }) => (
  <>
    <div className="h-48 bg-gradient-to-br from-indigo-900 to-slate-800 relative overflow-hidden">
      {card.image ? (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-overlay group-hover:scale-105 transition-transform duration-700"
          style={{ backgroundImage: `url('${card.image}')` }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-700/70 via-purple-800/50 to-slate-900 group-hover:scale-105 transition-transform duration-700" />
      )}
    </div>
    <div className="p-6 flex-1 flex flex-col">
      <div className="text-xs text-indigo-400 font-medium mb-2">{card.category}</div>
      <h4 className="font-bold text-lg mb-2 line-clamp-2">{card.title}</h4>
      <p className="text-gray-400 text-sm line-clamp-2">{card.description}</p>
      {card.date ? <div className="mt-auto pt-4 text-xs text-gray-500">{card.date}</div> : null}
    </div>
  </>
)

const ARROW_BUTTON_CLASSES =
  'w-9 h-9 flex items-center justify-center rounded-full bg-[#1e293b] border border-white/10 text-gray-300 hover:text-white hover:border-indigo-500/50 transition-colors'

export function HomeInsights({ posts }: { posts: InsightPost[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const cards = useMemo<InsightCardData[]>(() => {
    if (posts.length === 0) {
      return []
    }

    return posts.map((post) => ({
      key: post.id || post.slug,
      title: post.title,
      category: post.category ?? 'News',
      description: post.excerpt ?? '',
      image: post.image_url,
      date: formatPostDate(post.published_at),
      slug: post.slug,
    }))
  }, [posts])

  const scrollByStep = (direction: -1 | 1) => {
    const node = scrollerRef.current
    if (!node) return
    node.scrollBy({ left: direction * Math.round(node.clientWidth * 0.8), behavior: 'smooth' })
  }

  if (cards.length === 0) {
    return (
      <section>
        <div className="flex justify-between items-end mb-6 gap-4">
          <h2 className="text-2xl font-bold">Latest Insights</h2>
          <Link
            href="/news"
            className="hidden sm:block text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            All news
          </Link>
        </div>
        <InsightsEmptyState />
      </section>
    )
  }

  return (
    <section>
      <div className="flex justify-between items-end mb-6 gap-4">
        <h2 className="text-2xl font-bold">Latest Insights</h2>

        <div className="flex items-center gap-3">
          <Link
            href="/news"
            className="hidden sm:block text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            All news
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scrollByStep(-1)}
              aria-label="Scroll to previous insights"
              className={ARROW_BUTTON_CLASSES}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scrollByStep(1)}
              aria-label="Scroll to next insights"
              className={ARROW_BUTTON_CLASSES}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex overflow-x-auto gap-6 pb-4 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {cards.map((card) =>
          card.slug ? (
            <Link
              key={card.key}
              href={`/news/${card.slug}`}
              className={`${CARD_CLASSES} hover:border-indigo-500/50 transition-colors`}
            >
              <InsightCardBody card={card} />
            </Link>
          ) : (
            <div key={card.key} className={CARD_CLASSES}>
              <InsightCardBody card={card} />
            </div>
          )
        )}
      </div>
    </section>
  )
}