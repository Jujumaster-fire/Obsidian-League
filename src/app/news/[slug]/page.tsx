/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { cachedRestGet } from '@/lib/public-api'
import { cacheKey } from '@/lib/cache'
import type { NewsPost } from '@/components/NewsList'

export const revalidate = 60

interface NewsPostDetail extends NewsPost {
  body: string | null
}

interface PageProps {
  params: Promise<{ slug: string }>
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Deterministic (UTC, no Intl) date label shared with the news feed. */
const formatPostDate = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * Single published article. RLS already hides unpublished rows from the anon
 * key, but `published=is.true` keeps the intent explicit and cache-friendly.
 */
const getPost = async (slug: string) => {
  const rows = await cachedRestGet<NewsPostDetail>(
    `tournament_posts?select=id,title,slug,excerpt,body,image_url,category,published_at,tournament_id,tournaments(name,slug)&published=is.true&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    {
      // Articles are edited occasionally and read often — cache them globally.
      sharedKey: cacheKey('public', 'news', 'post', slug),
      sharedTtlSeconds: 600,
      revalidate: 60,
    }
  )
  return rows[0] ?? null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)

  if (!post) {
    return {
      title: 'Article not found | Obsidian Elite',
      description: 'This article is not available.',
    }
  }

  const description = post.excerpt ?? `Read ${post.title} on Obsidian Elite.`

  return {
    title: `${post.title} | Obsidian Elite`,
    description,
    openGraph: {
      title: post.title,
      description,
      type: 'article',
      siteName: 'Obsidian Elite',
      publishedTime: post.published_at ?? undefined,
      images: [{ url: post.image_url ?? '/og-image.png', alt: post.title }],
    },
  }
}

export default async function NewsArticlePage({ params }: PageProps) {
  const { slug } = await params
  const post = await getPost(slug)

  if (!post) {
    notFound()
  }

  const paragraphs = (post.body ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <article className="max-w-3xl mx-auto">
          <Link
            href="/news"
            className="inline-flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors mb-8"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            Back to news
          </Link>

          <header className="mb-8">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {post.category ? (
                <span className="text-xs font-semibold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full">
                  {post.category}
                </span>
              ) : null}
              {post.tournaments ? (
                <span className="text-xs font-semibold uppercase tracking-wider bg-white/5 text-gray-300 border border-white/10 px-3 py-1 rounded-full">
                  {post.tournaments.name}
                </span>
              ) : null}
              {post.published_at ? <span className="text-xs text-gray-500">{formatPostDate(post.published_at)}</span> : null}
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-4">{post.title}</h1>

            {post.excerpt ? <p className="text-lg text-gray-400 leading-relaxed">{post.excerpt}</p> : null}
          </header>

          {post.image_url ? (
            <div className="rounded-xl overflow-hidden border border-white/5 bg-[#1e293b] mb-10">
              <img
                src={post.image_url}
                alt={post.title}
                loading="lazy"
                className="w-full h-auto max-h-[460px] object-cover"
              />
            </div>
          ) : null}

          {paragraphs.length > 0 ? (
            <div className="space-y-5 text-gray-300 leading-relaxed text-base sm:text-lg">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 italic">This article has no content yet.</p>
          )}
        </article>
      </div>
    </div>
  )
}