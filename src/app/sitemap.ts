import type { MetadataRoute } from 'next'
import { restGet } from '@/lib/public-api'

/** Regenerate the sitemap hourly; the underlying reads are cache-tagged. */
export const revalidate = 3600

interface SlugRow {
  id: string
  slug?: string | null
}

/**
 * sitemap.xml.
 *
 * Covers the static public routes plus team pages and published articles so
 * search engines can discover the hub without crawling the whole fixture list
 * (fixtures are reachable from /competitions and /match/[id]).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${baseUrl}/competitions`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/teams`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${baseUrl}/news`, lastModified: now, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${baseUrl}/medals`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${baseUrl}/onboarding`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
  ]

  const [teams, posts] = await Promise.all([
    restGet<SlugRow>('teams?select=id&order=name.asc&limit=1000', { revalidate: 3600 }),
    restGet<SlugRow>(
      'tournament_posts?select=slug&published=is.true&order=published_at.desc&limit=500',
      { revalidate: 3600 }
    ),
  ])

  return [
    ...staticRoutes,
    ...teams.map((team) => ({
      url: `${baseUrl}/team/${team.id}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
    ...posts
      .filter((post) => Boolean(post.slug))
      .map((post) => ({
        url: `${baseUrl}/news/${post.slug}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
  ]
}