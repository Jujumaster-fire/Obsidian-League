# Architecture & Security Guidelines: Scaling to 3 Million Users

This document outlines the security measures and architectural recommendations required for the Obsidian Elite Tournament Manager to handle 3 million concurrent users securely and efficiently.

## 1. Authentication Security (Anti-Spam & Overload)

Handling a massive user base requires strict protection against brute-force attacks, credential stuffing, and sign-in spam.

*   **Supabase Rate Limiting:**
    *   Configure strict email rate limits within the Supabase Auth settings to prevent spamming sign-up and password reset endpoints.
    *   Implement IP-based rate limiting on the Supabase project level (via Cloudflare/Supabase custom domains) to block malicious IPs attempting thousands of logins.
*   **Next.js Middleware Rate Limiting:**
    *   Implement custom Next.js Middleware that tracks login attempts per IP address using a fast, in-memory store like Redis (e.g., Upstash Redis). If an IP exceeds 5 failed attempts in 5 minutes, temporarily block them.
*   **CAPTCHA Integration:**
    *   Integrate Cloudflare Turnstile or Google reCAPTCHA v3 invisibly on the sign-in and sign-up forms. This prevents automated bot networks from overwhelming the auth endpoints without disrupting genuine users.
*   **Role-Based Access Control (RBAC):**
    *   As implemented in the database schema, admin privileges are strictly derived from the `user_roles` table in the database, secured by Row Level Security (RLS). The frontend should *never* dictate a user's role.

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
