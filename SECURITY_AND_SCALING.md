# Architecture & Security Guidelines: Scaling to 3 Million Users

This document outlines the security measures and architectural recommendations
required for the Obsidian Elite Tournament Manager to handle 3 million concurrent
users securely and efficiently.

> **Implementation status (current):** items marked ✅ below are already wired in
> the codebase; the rest is the staged roadmap.

## 0. What is already implemented

| Area | Implementation |
| --- | --- |
| ✅ Public read caching | `restGet`/`cachedRestGet` — anon-key PostgREST reads through the Next.js Data Cache (`revalidate` 30 s–1 h, shared `public-data` tag) |
| ✅ Shared cache layer | Upstash Redis (`src/lib/cache.ts`) for heavy semi-static reads (articles, medals, team directory, config) with an in-memory fallback; live scores never cached |
| ✅ On-demand invalidation | `POST /api/revalidate` — expires the tag (`revalidateTag(tag, { expire: 0 })`) **and** purges the Redis keys; admin-only (403 otherwise) |
| ✅ Rate limiting | Upstash sliding window (`src/lib/rate-limit.ts`) on `/api/*`, in-process fallback; Supabase Auth limits remain the anti-brute-force layer |
| ✅ Atomic writes | `record_score()` / `record_stat()` RPCs — duty-checked in Postgres, no read-modify-write races |
| ✅ RLS everywhere | Every table behind RLS; legacy `is_admin()` write policies tightened to `app_admin` (migrations 07 + 09); member-scoped policies with duty checks (migration 06) |
| ✅ Security headers | CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` via `next.config.ts` |
| ✅ Observability | Sentry (100% errors, 10% traces by default), route-handler breadcrumbs for admin writes |
| ✅ SEO/pagination-ready | `robots.txt`, `sitemap.xml` (hourly), per-page metadata |

## 1. Authentication Security (Anti-Spam & Overload)

Handling a massive user base requires strict protection against brute-force attacks, credential stuffing, and sign-in spam.

*   **Supabase Rate Limiting:**
    *   Configure strict email rate limits within the Supabase Auth settings to prevent spamming sign-up and password reset endpoints.
    *   ✅ Implemented in-app: `/api/*` handlers are rate limited per IP (Upstash shared window, in-process fallback).
*   **Next.js Proxy Rate Limiting (edge):**
    *   For a hard global limit in front of *everything*, add Cloudflare rules or an Upstash-backed limiter in the proxy. The current in-app limiter covers the app's own API surface.
*   **CAPTCHA Integration:**
    *   Integrate Cloudflare Turnstile invisibly on the sign-in/sign-up forms (Supabase supports Turnstile server-side) — recommended before public launch.
*   **Role-Based Access Control (RBAC):**
    *   ✅ Admin privileges derive strictly from the `user_roles` + `tournament_members` tables secured by RLS; the frontend never dictates a role.

## 2. Scaling Architecture (Handling 3 Million Users)

Serving 3 million concurrent users requires a robust, distributed architecture that minimizes database hits.

*   **Edge Caching & CDN:**
    *   **Vercel / Cloudflare Edge:** Deploy the Next.js application to an Edge network. Use Next.js Incremental Static Regeneration (ISR) or App Router Cache (`revalidate`) for public pages (Fixtures, Team Profiles).
    *   **Static Assets:** All images (like team logos) and CSS/JS bundles must be served via CDN.
*   **Database Connection Pooling:**
    *   Direct connections to the PostgreSQL database will fail at this scale. You *must* use PgBouncer (provided by Supabase via IPv4 connection pooling) to multiplex thousands of client requests into a small number of actual database connections.
*   **Real-time Infrastructure:**
    *   For live match updates (score changes, red cards), rely on Supabase Realtime (which uses WebSockets). However, at 3 million users, broadcasting to every single client directly from the DB might bottleneck.
    *   **Recommendation:** Use Redis Pub/Sub in conjunction with a specialized WebSocket server (or an enterprise tier of Supabase Realtime/Pusher) to fan out updates to millions of connected clients efficiently.
*   **Read Replicas:**
    *   For heavy read traffic (users refreshing the tournament hub), configure PostgreSQL read replicas. Route all `SELECT` queries from unauthenticated users to the read replicas, reserving the primary database for admin writes (entering match events).
*   **Data Fetching Strategy:**
    *   Public data (match lists, scores) should be fetched server-side and heavily cached using Next.js `fetch` with `next: { revalidate: 30 }` (cache for 30 seconds). This means millions of users requesting the home page will only hit your database a few times per minute.

## 3. Database Security & Integrity

*   **Row Level Security (RLS):** All tables are strictly protected by RLS. Anonymous and logged-in users can only read data. Only users with the `admin` role in `user_roles` can write data.
*   **Security Definer Functions:** The `is_admin()` helper function is set to `SECURITY DEFINER`, allowing it to bypass RLS internally to check the user's role securely without exposing the `user_roles` table to unauthorized queries.
