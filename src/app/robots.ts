import type { MetadataRoute } from 'next'

/**
 * robots.txt.
 *
 * Admin surfaces, API routes and invite links are excluded from crawling:
 * invite tokens must never end up in a search index, and `/admin` is a
 * signed-in area anyway.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/admin/', '/api/', '/invite/', '/auth/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}