# FESO Progress Summary

Last updated after the server-render split for `/competitions` and `/match/[id]`,
the African sports catalogue expansion (migration 10 + `update_match_clock`),
and the mock/placeholder sweep, then completed with the live-database push
(migrations `00`–`13`) and the Vercel deploy. TypeScript is clean
(`npx tsc --noEmit` → 0 errors), `eslint src/` → 0 errors / 0 warnings, and the
production build is verified (`next build` → 25 routes, 0 errors). The app is
live at `https://obsidian-league.vercel.app` — see `DEPLOY.md` §7 for moving to a
purchased domain.

## Batch 1 - Role & navigation ✅ Done
- `src/lib/admin-auth.ts` is the single server-side source of truth: `getAuthInfo()`
  resolves `user_roles.role` (`app_admin` | `tournament_admin` | `user`) **plus** every
  `tournament_members` row (with `duties`), and derives `isAppAdmin`, `isTournamentAdmin`
  and `canAccessAdmin`. `membershipHasDuty()` / `canManageTournament()` cover scoped checks.
- `src/lib/use-admin-auth.ts` is the client mirror: one `no-store` fetch to
  `/api/admin-auth-info`, so client components never re-implement role logic (and never
  trust the frontend for authorization).
- `src/proxy.ts` (Next 16 Proxy, formerly Middleware) refreshes the Supabase session cookie
  on every matched request, forwards rotated cookies onto redirects, and optimistically
  gates `/admin/**` (anonymous → `/login?next=...`; signed in without any admin capability →
  `/`). RLS + `admin-auth.ts` remain authoritative.
- `src/components/Navigation.tsx` shows Dashboard/Tournaments/Posts (+ Users for app admins)
  from the resolved role, has a mobile drawer, and signs out through both the browser client
  and `POST /auth/signout` (which clears the httpOnly cookies the proxy relies on).

## Batch 2 - Invite flow ✅ Done
- `GET /api/admin-auth-info` is a real App Router route handler (rate limited, `no-store`)
  returning `{ authenticated, role, memberships, isAppAdmin, isTournamentAdmin, canAccessAdmin }`.
- `src/app/invite/[token]/page.tsx` loads the invite via `get_invite_info()` (SECURITY
  DEFINER: name/slug/duties/expiry only - never `created_by` or token metadata) and accepts
  via `accept_tournament_invite()`. It handles signed-out (deep link to
  `/login?next=/invite/<token>`), invalid/expired/revoked, inline RPC errors, and redirects
  into `/admin` on success.
- `/login` is a server wrapper (`next` validated as a site-relative path - no open redirect)
  around a client `LoginForm` supporting **email sign-in, email sign-up (previously missing
  entirely), password reset and Google OAuth**, all honouring `next`.

## Batch 3 - Match manager on RPCs ✅ Done
- `src/app/admin/match/[id]/page.tsx` writes scores through
  `record_score(fixture_id, home, away)` and every stat through
  `record_stat(fixture_id, side, key)` - atomic, duty-checked in Postgres, returning the
  authoritative new value (no lost-update race). The 12 legacy stat keys are offered with a
  `+1` per side.
- The clock (`status`, `current_minute`, `stats.elapsed_seconds`, `stats.timer_started_at`)
  still uses a scoped `fixtures` update (single-writer concern) with pause/resume, half-time,
  full-time and extra-time transitions plus an inline minute override (the old `prompt()` is
  gone).
- Event logging resolves scorer/assist against `players` (writes `player_id` /
  `assist_player_id` so the /competitions scorer & assist tables work), supports deletion and
  reports errors inline. Every write busts the public cache via `POST /api/revalidate`.

## Batch 4 - Admin CRUD ✅ Done
- `/admin` (dashboard) - role-gated and **tournament-scoped**: team create/edit/delete
  (staff, squad, group), fixture schedule/edit/delete, tournament settings upsert on
  `tournament_id`, plus links into the new pages. Every record is written with a non-null
  `tournament_id` (NULL rows stay app-admin-only under RLS).
- **Squad checklist (roster CRUD)** - `src/components/admin/RosterEditor.tsx` provides two
  pieces:
  - `RosterEditor` (used in "register a team"): one row per player with a **name box, a shirt
    number box beside it**, reorder ↑/↓, a remove ✕ and an "Add player" button.
  - `TeamRosterManager` (used when editing a saved team): the same checklist wired to the
    `players` table, so every line is fully CRUDable - add, rename, renumber (Save appears only
    when a row is dirty), remove with confirm. Each write regenerates the `teams.roster` CSV
    mirror that the public `/match/[id]` line-up tab reads, so both stay consistent.
- `/admin/tournaments` - list, create, inline edit, delete and "make active" (the current
  active row is deactivated first so the single-active unique index can never be violated).
- `/admin/tournaments/[id]` - single-tournament workspace: overview, competition settings,
  article CRUD, invites (create/revoke/copy-link through `create_tournament_invite`,
  `revoke_tournament_invite`, `list_tournament_invites`), the member roster
  (`list_tournament_members`) and the app-admin-only sports picker.
- `/admin/posts` - **the newsroom**: cross-tournament article list with tournament/status
  filters and search, draft/publish toggles, edit/delete, and a composer that auto-generates
  the slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, unique per tournament).
- `/admin/users` - app-admin-only directory via `list_app_users()` (emails live in
  `auth.users`, which the anon key cannot read) with role changes through `set_user_role()`
  (self-demotion rejected in the database *and* locked in the UI).

## Batch 5 - Public surfaces ✅ Done
- **Filtering**: `/teams` is server-rendered from cached reads and hands the list to a client
  `TeamsExplorer` (search by name/short name + category/sport/group filters).
- **Medals**: `/medals` aggregates `fixture_entries` into team and athlete medal tables
  (gold/silver/bronze + total).
- **News / blog carousel**: `/news` (list with search + category/tournament filters),
  `/news/[slug]` (article with metadata/OG tags) and the home-page "Latest Insights"
  carousel, which now renders real published `tournament_posts` with prev/next controls and
  falls back to the original static showcase when nothing is published yet.
- **Registration banner**: the home-page CTA now opens a pre-filled **WhatsApp message** or
  **email** instead of a dead `/login` link (template below).

## Batch 6 - Security hardening, observability & deploy ✅ Done
- `next.config.ts` (restored - it had been deleted in the WIP branch) sets security headers
  (CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`), `poweredByHeader: false`, compression and image allowlists.
- **Rate limiting** - `src/lib/rate-limit.ts`: Upstash sliding window shared across instances
  (`@upstash/ratelimit`) with an in-process fallback; applied to `/api/admin-auth-info`
  (120/min/IP) and `/api/revalidate` (60/min/IP, admin-only, 403 for anonymous callers).
- **Shared cache** - `src/lib/cache.ts` (Upstash Redis, `ol:` prefix, never throws) plus
  `cachedRestGet()` in `src/lib/public-api.ts`. Cached reads are limited to heavy,
  semi-static data: news list/detail, medal tallies, team directory, active-tournament
  config. Live fixtures/scores are **never** cached there.
- **Sentry** - `src/instrumentation.ts` + `src/instrumentation-client.ts` +
  `sentry.server.config.ts` / `sentry.edge.config.ts`, `src/app/global-error.tsx` and
  `src/lib/monitoring.ts`. Free-tier friendly: `tracesSampleRate` defaults to **0.1** (10% of
  successful transactions) while 100% of unhandled errors are captured; Session Replay is off
  unless explicitly enabled. No DSN ⇒ fully disabled (no build coupling, Turbopack untouched).
- **Fonts** - self-hosted **Inter 18pt**, subset to Latin and converted to `woff2`
  (`scripts/subset-fonts.py`): 6 files ≈ 194 KB instead of 54 TTFs ≈ 17.8 MB. Declared with
  `font-display: swap` + system fallback in `globals.css`. `next/font/google` is deliberately
  not used (build-time network dependency; Turbopack rejects try/catch around the loader).
- `src/app/robots.ts` + `src/app/sitemap.ts` (invite links and `/admin` excluded from
  crawling), `metadata`/`generateMetadata` on the public pages.
- Migrations **08** (`tournament_posts` + RLS + trigger) and **09** (finish tightening the
  over-broad `is_admin()` policies, scale indexes, admin RPCs) are idempotent and apply after
  07. `supabase/config.toml` + `npm run db:push` / `db:list` wire up the Supabase CLI.
- `scripts/smoke.mjs` (`npm run smoke [url]`) - dependency-free post-deploy checks:
  public routes render, `/admin` is gated, `/api/admin-auth-info` is `no-store` anonymous,
  `/api/revalidate` returns 403, security headers present, `robots.txt`/`sitemap.xml` served,
  unknown routes 404. **Local run: 12/12 passed.**
- No `alert()` / `prompt()` / `window.confirm()` remain in `src`; every form reports
  success/failure inline and disables its buttons while saving. No source file references
  `FESO.md` in its comments.

## Batch 7 - Server-render split (`/competitions` + `/match/[id]`) ✅ Done
- `/competitions` is now a **server component** (`src/app/competitions/page.tsx`,
  `export const revalidate = 30`) that fetches `fixtures`/`teams`/`match_events`/`players`
  in parallel from PostgREST, derives the full view with the pure server module
  `src/lib/competitions-standings.ts` (`computeCompetitionsView` - results, upcoming,
  per-group standings sorted by points/GD, top scorers/assists/yellow/red cards, team
  xG, clean sheets, play-off buckets), and renders every tab's first paint.
  The thin client `src/app/competitions/RealtimeClient.tsx` only keeps the
  **Live Now** strip fresh via a Realtime `fixtures` subscription
  (`status=in.(scheduled,in_progress,extra_time)`) inside `<Suspense>`.
- Presentational pieces live as server-safe components:
  `src/components/competitions/ServerMatchCard.tsx` (static live-strip card),
  `FixtureCard.tsx` (results/fixtures/overview rows), `Standings.tsx`
  (group tables), `PlayoffTabs.tsx` (final/semi/quarter bracket).
- `/match/[id]` is now split the same way. `src/app/match/[id]/page.tsx` is a
  thin `async` route (`revalidate = 30`, `<Suspense fallback={<MatchCenterFullSkeleton/>}>`)
  around `src/app/match/[id]/MatchServer.tsx`, which fetches the fixture
  (`home_team`/`away_team` joins) + the ordered `match_events` in parallel and
  renders the score header, venue/competition card and mini-events first paint
  with per-page `generateMetadata` (Home vs Away · LIVE/FT/Cancelled + OG tags).
  `src/app/match/[id]/MatchRealtimeClient.tsx` (`'use client'`) renders the
  tab bar (`Overview / Stats / Timeline / Line-up / Table`) plus all five
  panels from the server props, and layers two Realtime subscriptions
  (`fixtures` by id, `match_events` inserts by fixture_id) so score/minute/
  status and the timeline stay live without refetching the page.
- Tab activation is a client concern (`useState` in `MatchRealtimeClient`,
  hash-free link rows on `/competitions`). URL-synced tabs (`?tab=...`) are
  deliberately deferred - see gaps below.

## Batch 8 - African sports catalogue + atomic clock RPC ✅ Done
- Migration **10** (`supabase/migrations/10_african_sports_catalog_and_clock.sql`)
  expands the seeded catalogue from 18 → **39 sports** (Nigerian/African/Games
  programme plus three traditional entries: Dambe, Ayo, Abula) and backfills a
  `medals` + `clock` block on every sport's `scoring_config` (halves/quarters/
  rounds/sets/innings/none, periods, period minutes, extra-time rules).
- `update_match_clock()` (SECURITY DEFINER, duty-checked like `record_score`)
  merges `elapsed_seconds` + `timer_started_at` with an atomic `jsonb_set`,
  closing the lost-update race where a clock save overwrote a concurrently
  recorded stat. `src/app/admin/match/[id]/page.tsx` calls it for every
  pause/resume/half/full-time/extra-time/minute-override transition.
- `src/lib/sports.ts` parses the per-sport configs (`parseScoringConfig`,
  `getClock`, `getEventVocab`, `getMedalConfig`) and drives the manager UI:
  clock controls follow the sport (halves → 1st/2nd half, quarters → Q1-Q4,
  rounds → Round 1-N, sets/innings/none → scoreboard only) and the event
  dropdown follows the fixture's `event_vocab`.

## Batch 9 - Mock / placeholder sweep ✅ Done
- `src/app/page.tsx`: deleted the `// Mock data interfaces` comment plus the
  `TeamMock`/`MatchMock` render shapes and the dead `renderMatchList` (uncalled
  since the ISR rewrite). The live home sections now map `FixtureRow` rows
  straight into `MatchesOfTheDaySection`/`UpcomingFixturesSection`/
  `ConcludedMatchesSection` with neutral slate avatar tiles - no hardcoded
  `'bg-red-500'`/`'bg-blue-500'` colour literals anywhere in `src`.
- `src/components/HomeInsights.tsx`: deleted the `FALLBACK_INSIGHTS` Unsplash
  showcase; when no posts are published the carousel renders an empty state
  with a link to `/news` instead of invented campaigns.
- Kept intentionally: the `AFRICAN / NIGERIAN / PARA` `*_SPORTS` arrays and
  `SPORT_OPTIONS` enum blocks (seeded catalogue choices, not placeholders),
  the `REGISTRATION_TEMPLATE` prose (real organiser wording) and the
  `ccgames2026` seed + logo files (the first real tournament and brand assets,
  not mock data).

---

## Team registration message template

The public "Ready to Prove Yourself?" banner links to the organisers with this message
prefilled (`src/lib/registration.ts` → `REGISTRATION_TEMPLATE`). `{{TOURNAMENT}}` is replaced
with the active tournament's name, edition, dates and host city.

```
Hello Obsidian Elite organisers,

We would like to register a team for {{TOURNAMENT}}.

Team name:
Category (Male / Female / Mixed):
Sport (Football / Futsal / other):
Head coach:
Contact name & phone:
Preferred match window:

Please confirm the entry fee and the documents you need from us.

Thank you.
```

Configure the channels with public env vars (see `.env.example`):

| Variable | Purpose | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_REGISTRATION_WHATSAPP` | digits only, international format, no `+` | `2348012345678` |
| `NEXT_PUBLIC_REGISTRATION_EMAIL` | registration inbox | `entries@obsidianelite.com` |

Either channel can be omitted - its button is then hidden; if neither is set the banner falls
back to a link to `/news`, so it can never be a dead link.

---

## News & articles (the "insights" carousel)

`tournament_posts` is the article store written from **/admin/posts** (newsroom) or the
article section of **/admin/tournaments/[id]**. Drafts are invisible to the public because
RLS only exposes rows where `published` is true **and** `published_at <= now()`. Published
articles appear in the home-page carousel and on `/news` + `/news/[slug]` immediately -
every write calls `POST /api/revalidate`, which expires the `public-data` cache tag.

---

## Batch 10 — Onboarding (guide + in-app tour) and database hardening ✅ Done

### Two onboarding surfaces, one source of truth

`src/lib/onboarding.ts` is the typed content module that both surfaces render, so
the documentation cannot drift from the product (and a test proves it):

- **`/onboarding`** (`src/app/onboarding/page.tsx` + `OnboardingGuide.tsx`) — the
  reference guide with **five role tabs: Fans · Users · Scouts · Tournament admins
  · App admins**. Each tab carries a summary, "before you start" checklist, a
  three-step first-session journey, the full feature catalogue (what it does / how
  to reach it / where it stops) and, for staff roles, the duty glossary. The active
  tab lives in `?role=` (same shallow-routing contract as `CompetitionsTabs`), and
  a signed-in visitor sees a "you are here" banner describing the duties they
  actually hold (via `useAdminAuth()`).
- **In-app onboarding** (`src/components/onboarding/*`) — mounted once in
  `src/app/layout.tsx`:
  - `WelcomeDialog` greets a first-time visitor once per browser (after the splash
    screen) with three entry points: follow the action, accept an invite, or run a
    tournament.
  - `OnboardingExperience` orchestrates the guided tour; `TourOverlay` draws a
    spotlight over the real component and a tooltip beside it.
  - Steps point at **`data-tour` anchors on the shipped UI** (navigation, home
    blocks, competition/match tabs, console scopes/stats/timeline/clock/line-up,
    dashboard forms, workspace invites/members, newsroom, user directory). A step
    whose anchor is not on the current page is skipped, and a role tour walks
    multiple pages in legs (`stepsForCurrentLeg` / `tourEntryRoutes`), navigating
    between public hub → console → workspace and continuing where it left off.
  - Progress is remembered in `localStorage`; the tour can always be relaunched
    from the Guide link in the navigation or the "Take the … tour" button.
- `src/lib/nav-links.ts` now owns the nav lists so the nav, the guide and the tests
  share one definition; `Guide` was added to the public links, `/onboarding` to the
  sitemap and the smoke test.
- `src/lib/onboarding.test.ts` — 12 contract tests: five roles exactly, every role
  has a journey/features, every feature id resolves and lists that role, every nav
  link is documented, every duty token (reserved + the four pattern forms) is
  explained, every tour step has a legal selector/route, and every role has ≥3
  stops reachable from a navigable page.

### Database hardening (found during the RLS audit)

Audited every relation in `supabase/db-setup.sql`: **17/17 tables have RLS
enabled**, there are **no views** in the project, and no surviving policy is gated
on the legacy `is_admin()` (a new test replays every create/drop — including the
PART 09 dynamic loop — to prove the final state). Four real defects were fixed:

| # | Finding | Fix |
| --- | --- | --- |
| H1 | `tournament_invites` had a public SELECT policy **and** an anon SELECT grant, so anyone with the public anon key could read every live invite token and accept it (`accept_tournament_invite`), joining with the invite's duties (usually `*`) | policy replaced by a guarded `DROP`; `REVOKE SELECT … FROM anon, authenticated` (the invite page uses the SECURITY DEFINER `get_invite_info()`, which needs no grant) |
| M1 | `tournament_posts` writes were membership-wide (`is_tournament_admin`) although docs/UI say `posts` duty | policies now require `*` or `posts` duty, drop-then-create so existing projects converge |
| M2 | `tournament_settings` writes were membership-wide | policies now require the `*` duty |
| M3 | `storage.objects` (`logos` bucket) policies still used `is_admin()`, so *any* tournament member could upload/replace/delete files | recreated as `App admins can … logos` with an explicit app-admin check |

Regression tests were added to `tests/db-setup.contract.test.ts` (final-policy
simulator, invite secrecy, duty scoping, storage locking, table ↔ RLS parity).

Verification: `npx tsc --noEmit` → 0 errors · `npx vitest run` → **185 passed**
(4 files) · `eslint` on every touched file → 0 errors.

---

## Deploy checklist — ready for Vercel

All ten FESO batches are implemented and verified:
- `tsc --noEmit` → 0 errors
- `next build` → 25 routes, 0 errors
- `eslint src/` → 0 errors, 0 warnings
- No `alert()` / `prompt()` / `window.confirm()` remain in `src/`
- No `FOSO.md` references in source files
- `npx vitest run` → 185 passed (duties · sports · onboarding · db-setup contract)
- Supabase remote verified: migrations `00`–`13` applied (`npm run db:list`), 48 public
  functions, every table RLS-enabled, no `is_admin()` policies, no anon grant on
  `tournament_invites`, all 20 console RPCs present
- Canonical URL is `https://obsidian-league.vercel.app`.
  **Action required in the dashboards (not in the repo):** set `NEXT_PUBLIC_SITE_URL`
  to that URL in **Vercel → Project → Settings → Environment Variables**
  (Production + Preview) **and** in **GitHub → repo → Settings → Secrets and
  variables → Actions**, then **redeploy**. An empty value no longer breaks the
  build (it falls back to `http://localhost:3000`) but must be set for correct
  canonical / sitemap / OG URLs. Full procedure: `DEPLOY.md` §7.


### Production gaps resolved this pass

1. **Auth callback open redirect fixed** (`src/app/auth/callback/route.ts`).
   `next` query param is now validated site-relative before use — same guard as
   `/login`.
2. **Athlete entry UI** (`src/components/admin/AthleteEditor.tsx` + tournament workspace).
   `TournamentAthletesManager` follows the `RosterEditor` pattern: add, edit name /
   gender / classification, remove with confirm. Writes go through `create_athlete`
   / `update_athlete` / `delete_athlete` RPCs (migration 11, duty-checked).
3. **Fixture entries read UI** added to `/admin/tournaments/[id]` — results table
   shows rank and medal per entry, gated by `score` or `*` duty.
4. **URL-synced tabs** — both `/competitions?tab=...` and `/match/[id]?tab=...`
   now read from and write back to the search params via shallow routing
   (`router.push(..., { scroll: false })`). Browser history works; URLs are shareable.
5. **Sentry source maps** — `next.config.ts` now wraps with `withSentryConfig`.
   Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in Vercel env vars and
   source maps upload automatically at build time. A GitHub Actions workflow is
   included at `.github/workflows/build.yml`.
6. **Migration 11** (`supabase/migrations/11_athlete_and_entry_rpcs.sql`) adds
   four SECURITY DEFINER RPCs: `create_athlete`, `update_athlete`, `delete_athlete`,
   `upsert_fixture_entry` — all duty-checked against `is_app_admin()` or
   `is_tournament_admin(tournament_id)` with `score`/`*` scope.

### Still deferred (by design)

1. **Realtime fan-out remains direct Supabase Realtime.** Upgrade path (Redis pub/sub
   or enterprise WebSocket tier) is documented in `SECURITY_AND_SCALING.md` §2.
2. **URL-synced tabs**: the active tab is persisted in `?tab=` but scrolling to the
   matching section uses `scrollIntoView` — the tab button highlight lags the scroll
   slightly on direct-link navigation. Fixable with a `IntersectionObserver` if
   needed.
3. **`supabase/schema.sql` + `schema_updates.sql`** remain historical; migrations
   00–13 are the source of truth (see `DEPLOY.md` §2).
   `13_scope_duties_recorders_lineups.sql` now carries the scope-authority /
   recorder / lineup surface that previously existed only in `db-setup.sql`, so
   `db push` produces a console-ready database.

---

## Required environment variables for Vercel

| Variable | Purpose | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | `eyJhbGc...` |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL for metadata, sitemap, robots, OAuth | `https://obsidian-league.vercel.app` (swap to the custom domain — `DEPLOY.md` §7) |
| `NEXT_PUBLIC_REGISTRATION_WHATSAPP` | Optional WhatsApp number | `2348012345678` |
| `NEXT_PUBLIC_REGISTRATION_EMAIL` | Optional registration inbox | `entries@example.com` |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional Sentry DSN | `https://...@sentry.io/...` |
| `SENTRY_AUTH_TOKEN` | Source-map upload token (free) | `sntrys_...` |
| `SENTRY_ORG` | Sentry org slug | `my-org` |
| `SENTRY_PROJECT` | Sentry project slug | `obsidian-elite` |
| `UPSTASH_REDIS_REST_URL` | Optional shared cache + rate limit | — |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash token | — |

> **Where to set them.** Vercel env vars are read at build **and** runtime; the CI
> workflow `.github/workflows/build.yml` reads the same names from **GitHub → repo →
> Settings → Secrets and variables → Actions**. `NEXT_PUBLIC_SITE_URL` must be set in
> **both** places: it is baked into `metadataBase`, `robots.txt` and `sitemap.xml` at
> build time, so a change only takes effect after a **redeploy** (Vercel →
> Deployments → *Redeploy*, unticking "use existing build cache"). An empty value is
> now harmless — the three consumers fall back to `http://localhost:3000` — but
> leaving it empty points the sitemap / OG tags at `localhost`. See `DEPLOY.md` §7.