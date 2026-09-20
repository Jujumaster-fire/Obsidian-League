/* eslint-disable @next/next/no-img-element */
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

/**
 * Public news feed item. Mirrors the PostgREST projection used by `/news`
 * (`tournament_posts` + embedded `tournaments`). Type-only exported so server
 * pages can reuse the shape without pulling this client bundle across the
 * boundary.
 */
export interface NewsPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  category: string | null
  image_url: string | null
  published_at: string | null
  tournament_id: string | null
  tournaments: { name: string; slug: string } | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Deterministic (UTC, no Intl) date label so the pre-render and the hydration
 * pass always produce identical markup.
 */
const formatPostDate = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

const FIELD_CLASSES =
  'bg-[#1e293b] border border-white/10 rounded-lg py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors'

export function NewsList({ posts }: { posts: NewsPost[] }) {
  const [query, setQuery] = useState('')
  const [tournamentFilter, setTournamentFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const tournamentOptions = useMemo(() => {
    const seen = new Map<string, string>()
    posts.forEach((post) => {
      if (post.tournaments) seen.set(post.tournaments.slug, post.tournaments.name)
    })
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [posts])

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    posts.forEach((post) => {
      if (post.category) seen.add(post.category)
    })
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [posts])

  const filteredPosts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return posts.filter((post) => {
      if (tournamentFilter !== 'all' && post.tournaments?.slug !== tournamentFilter) return false
      if (categoryFilter !== 'all' && post.category !== categoryFilter) return false
      if (!needle) return true
      return post.title.toLowerCase().includes(needle) || (post.excerpt ?? '').toLowerCase().includes(needle)
    })
  }, [categoryFilter, posts, query, tournamentFilter])

  const filtersActive = query.trim().length > 0 || tournamentFilter !== 'all' || categoryFilter !== 'all'

  const clearFilters = () => {
    setQuery('')
    setTournamentFilter('all')
    setCategoryFilter('all')
  }

  return (
    <div className="space-y-8">
      <div className="bg-[#1e293b] rounded-xl border border-white/5 p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="relative flex-1">
          <svg
            className="w-4 h-4 text-gray-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search articles..."
            aria-label="Search articles by title or excerpt"
            className={`${FIELD_CLASSES} w-full pl-10 pr-4`}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={tournamentFilter}
            onChange={(event) => setTournamentFilter(event.target.value)}
            aria-label="Filter articles by tournament"
            className={`${FIELD_CLASSES} px-4`}
          >
            <option value="all">All tournaments</option>
            {tournamentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filter articles by category"
            className={`${FIELD_CLASSES} px-4`}
          >
            <option value="all">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-gray-400">
          Showing <span className="text-white font-semibold">{filteredPosts.length}</span> of {posts.length}{' '}
          {posts.length === 1 ? 'article' : 'articles'}
        </p>
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {filteredPosts.length === 0 ? (
        <div className="bg-[#1e293b] rounded-xl p-12 text-center border border-white/5">
          <div className="text-gray-400 text-lg mb-2">
            {posts.length === 0 ? 'No articles have been published yet.' : 'No articles match your filters.'}
          </div>
          <p className="text-gray-500 text-sm">
            {posts.length === 0
              ? 'Check back soon for tournament coverage.'
              : 'Try a different search term or clear the filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPosts.map((post) => (
            <Link key={post.id} href={`/news/${post.slug}`} className="block h-full">
              <article className="bg-[#1e293b] rounded-xl overflow-hidden border border-white/5 shadow-xl hover:border-indigo-500/50 hover:shadow-indigo-900/20 transition-all group h-full flex flex-col">
                <div className="h-44 w-full bg-gradient-to-br from-indigo-900 to-slate-800 relative overflow-hidden">
                  {post.image_url ? (
                    <img
                      src={post.image_url}
                      alt={post.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-800 via-purple-900 to-slate-900">
                      <span className="text-xs uppercase tracking-widest text-white/40 px-4 text-center">
                        {post.category ?? 'Obsidian Elite'}
                      </span>
                    </div>
                  )}
                  {post.category ? (
                    <span className="absolute top-3 left-3 text-xs font-medium bg-black/60 backdrop-blur px-2 py-1 rounded text-indigo-300 border border-indigo-500/30">
                      {post.category}
                    </span>
                  ) : null}
                </div>

                <div className="p-5 flex-1 flex flex-col">
                  <h2 className="font-bold text-lg mb-2 line-clamp-2 group-hover:text-indigo-300 transition-colors">
                    {post.title}
                  </h2>
                  {post.excerpt ? <p className="text-gray-400 text-sm line-clamp-3">{post.excerpt}</p> : null}
                  <div className="mt-auto pt-4 flex items-center justify-between gap-3 text-xs text-gray-500">
                    <span className="truncate">{post.tournaments?.name ?? 'Obsidian Elite'}</span>
                    <span className="shrink-0">{formatPostDate(post.published_at)}</span>
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}