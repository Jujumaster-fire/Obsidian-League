# Deployment Guide

Everything needed to take this repository from a clone to a production
deployment, plus the list of placeholder content to replace before launch.

Stack: **Next.js 16** (App Router, Turbopack) on Vercel · **Supabase** (Postgres,
Auth, Realtime, Storage) · optional **Upstash Redis** (shared cache + rate
limiting) · optional **Sentry** (errors + performance).

---

## 0. Tool sign-ups (one-time, before any configuration)

Every tool below has a free tier sufficient for launch. All are linked via environment variables in §1.

### Vercel - hosting + CI
- **Sign up**: [vercel.com](https://vercel.com) → GitHub / GitLab / Bitbucket OAuth. Free tier includes unlimited personal projects, automatic previews on PRs, and built-in HTTPS.
- **After sign-up**: import this repository. Vercel auto-detects Next.js. The build command is `npm run build`; the dev command is `npm run dev`.
- **Key setting**: go to **Project → Settings → General → Framework Preset → Next.js** (default).

### Supabase - database + auth + realtime
- **Sign up**: [supabase.com](https://supabase.com) → create a new project (pick a region close to your users). Free tier: 500 MB database, 1 GB bandwidth/mo, unlimited auth users.
- **Project ref**: found in **Project Settings → API** - it's the `<ref>` in `https://<ref>.supabase.co`. Record this; you need it for the CLI and env vars.
- **Database migrations**: the CLI (`npx supabase`) talks directly to your project. Install it once:
  ```bash
  npm install -g supabase
  supabase login          # opens browser OAuth
  supabase link --project-ref <your-project-ref>
  npm run db:push         # applies migrations 00...13 in order
  ```
- **Auth providers**: enabled under **Authentication → Providers**. Google requires a separate Google Cloud OAuth client (see §2 below). Email/password works out of the box.

### Sentry - error tracking + performance
- **Sign up**: [sentry.io](https://sentry.io) → start free tier (30-day data retention, 5K events/mo, 10% trace sampling). No credit card required.
- **Create a project**: after sign-in, click **+ Project** → choose **Node.js** (server-side) + **JavaScript** (client-side) - or just select "Next.js" if available. Sentry auto-generates a DSN.
- **Organizations & tokens**: go to **User Settings → API** → **Personal Access Tokens** → create one with `project:write` scope. Also note your **Org slug** (found in the URL when viewing your org dashboard, e.g. `sentry.io/orgs/my-org`). You need all three for source-map uploads (§4).

### Upstash - shared cache + rate limiting (optional but recommended for production)
- **Sign up**: [upstash.com](https://upstash.com) → sign in with GitHub. Free tier: 10 MB database, 10K requests/day, 1 GB egress/mo.
- **Create a database**: **Redis → Create Database** → pick region → **REST API** tab gives you `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Paste both into your env.
- **When unset** the app falls back to in-process caching (single-instance only); enable Upstash before expecting multi-region Vercel deployments to share cache state.

---

## 1. Environment variables

Copy `.env.example` → `.env.local` for local work, and add the same keys in
**Vercel → Project → Settings → Environment Variables** (Production + Preview).

### Required

| Variable | Where to get it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | public/anon key (RLS enforces access) |
| `NEXT_PUBLIC_SITE_URL` | this deployment's public URL | used for metadata, `sitemap.xml`, `robots.txt`, OAuth redirects. No trailing slash. **Currently `https://obsidian-league.vercel.app`** — change it after connecting a custom domain (see §7). |

### Registration channels (home-page banner)

| Variable | Example | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_REGISTRATION_WHATSAPP` | `2348012345678` | digits only, international, no `+`. Empty ⇒ WhatsApp button hidden. |
| `NEXT_PUBLIC_REGISTRATION_EMAIL` | `entries@your-domain.com` | Empty ⇒ email button hidden. If both are empty the banner links to `/news`. |

> **Currently wired to TEST values** (`15551234567` / `entries@example.com`).
> Replace them with the organisers' real number and inbox. The message template
> lives in `src/lib/registration.ts` (`REGISTRATION_TEMPLATE`).

### Optional - Sentry (errors + performance)

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | empty (disabled) | Sentry → Your Project → **Settings** → **Client Keys (DSN)**. Required for any error reporting at all. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `NODE_ENV` | set to `production` / `preview`. |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `0.1` | 10% of **successful** transactions; unhandled errors are always captured. Keep `0.05`-`0.1` on the free tier. |
| `NEXT_PUBLIC_SENTRY_REPLAYS` | `false` | Session Replay burns quota quickly - enable deliberately. |
| `SENTRY_AUTH_TOKEN` | unset | Personal Access Token with `project:write` scope - generates readable source maps at build time. See below. |
| `SENTRY_ORG` | unset | Your Sentry organisation slug (e.g. `my-org`). |
| `SENTRY_PROJECT` | unset | The Sentry project slug (created automatically when you enter a DSN). |

**Source-map uploads (free, automatic):** once the three vars above are set in Vercel, every `npm run build` automatically pushes sourcemaps to Sentry - stack traces in your dashboard become human-readable instead of minified garbage.

### Optional - Upstash Redis (shared cache + global rate limiting)

| Variable | Notes |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Console → Database → REST API. |
| `UPSTASH_REDIS_REST_TOKEN` | same screen. |

Both unset ⇒ the app transparently uses its in-process cache/limiter. Cached
reads are limited to **heavy, semi-static** data (article list/detail, medal
tallies, team directory, active-tournament config). Live fixtures and scores are
never cached in Redis. Every admin write purges the shared keys via
`POST /api/revalidate`.

---

## 2. Database

**`supabase/db-setup.sql` is the source of truth** — one idempotent file containing
the whole schema, seed data, RLS, realtime configuration and every write RPC.
`supabase/migrations/00…13` hold the *same* schema split into ordered steps for the
CLI. **Apply one of the two, not both** (doing both is harmless — every statement is
re-runnable — but there is no reason to).

### Option A — one shot (SQL editor / psql)

```powershell
# Supabase dashboard → SQL Editor → paste the whole of supabase/db-setup.sql → Run
# or, with psql and a direct connection string:
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/db-setup.sql
```

### Option B — CLI (`supabase db push`)

```powershell
npx supabase login                    # browser OAuth (or set SUPABASE_ACCESS_TOKEN)
npx supabase link --project-ref <ref> # project ref from the dashboard URL
npm run db:push                       # applies 00 … 13 in order
npm run db:list                       # confirms what has been applied
```

> `00_base_schema.sql` exists because migrations 01–13 all extend the base tables;
> without it a fresh project fails at `01_add_team_details.sql`. It mirrors PART 0
> of `db-setup.sql`, so both routes converge on the same schema.

All migrations are idempotent (re-runnable). What each one does:

| Migration | Purpose |
| --- | --- |
| `00_base_schema.sql` | base schema: `user_roles`, `teams`, `fixtures`, `match_events`, `tournament_settings`, the `logos` bucket + its RLS |
| `01_add_team_details.sql` | extra team columns (staff, roster, ...) |
| `02_tournaments_core.sql` | `tournaments` table + `tournament_id` scoping |
| `03_sports_catalog.sql` | `sports`, `sport_divisions`, `tournament_sports`, fixture scoring columns |
| `04_seed_ccgames2026.sql` | seed tournament + 18-sport catalogue |
| `05_athletes_entries_players.sql` | `athletes`, `fixture_entries` (medals), `players`, widened CHECKs, realtime publication, `logos` bucket |
| `06_roles_invites_rpcs.sql` | role split, `tournament_members`, `tournament_invites`, `record_stat` / `record_score`, scoped member policies |
| `07_tighten_legacy_policies.sql` | narrows legacy `is_admin()` write policies |
| `08_tournament_posts.sql` | `tournament_posts` (news/articles) + RLS + trigger |
| `09_harden_policies_and_admin_rpcs.sql` | finishes tightening, scale indexes, admin RPCs (`list_app_users`, `set_user_role`, `list_tournament_members`, `create_tournament_invite`, `revoke_tournament_invite`, `list_tournament_invites`) |
| `10_african_sports_catalog_and_clock.sql` | expands the catalogue to 39 sports + per-sport `medals`/`clock` blocks, widens `match_events.event_type` CHECK, adds atomic `update_match_clock()` RPC |
| `11_athlete_and_entry_rpcs.sql` | duty-checked athlete CRUD (`create_athlete`, `update_athlete`, `delete_athlete`) + fixture entry upsert (`upsert_fixture_entry`) for individual-sport results |
| `12_harden_remaining_rls.sql` | finishes duty-scoped hardening of `tournament_posts` / `tournament_settings` writes and replaces the legacy `is_admin()` `logos` storage policies with `app_admin`-gated ones |
| `13_scope_duties_recorders_lineups.sql` | the writer surface the live console drives: `has_tournament_duty()` / `can_write_fixture*()` authority, `fixture_loggers` scope claims (`claim_fixture_scope`, `heartbeat_fixture_scope`, `release_fixture_scope`), recorder RPCs (`set_fixture_stat`, `record_match_event`, `delete_match_event`, `set_fixture_rules`, `fixture_effective_rules`, `list_fixture_loggers`), per-match `court` rules and `fixture_lineups` (drag-editable formations) |

> `supabase/schema.sql` and `supabase/schema_updates.sql` describe the original
> single-role schema and are kept for history only - do **not** run them on a
> new project.

### Verify

```sql
select to_regprocedure('public.record_stat(uuid,text,text)');            -- not null
select to_regprocedure('public.record_score(uuid,int,int)');             -- not null
select to_regprocedure('public.update_match_clock(uuid,text,int,int,timestamptz)'); -- not null
select to_regprocedure('public.list_app_users()');                       -- not null
select to_regprocedure('public.create_tournament_invite(uuid,text[],timestamptz)'); -- not null
select to_regprocedure('public.can_write_fixture(uuid,text,text)');      -- not null (scope authority)
select to_regprocedure('public.claim_fixture_scope(uuid,text)');         -- not null (recorder claim)
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';                                             -- 48
select indexname from pg_indexes where tablename = 'fixtures';           -- idx_fixtures_status_match_date ...
```

Security spot-checks (the hardening from Batch 10):

```sql
-- every public table has RLS (expect zero rows)
select tablename from pg_tables t
where schemaname = 'public'
  and not exists (select 1 from pg_class c where c.relname = t.tablename and c.relrowsecurity);

-- invites must not be readable by clients (expect zero rows, and no anon grant)
select policyname from pg_policies
where schemaname = 'public' and tablename = 'tournament_invites' and cmd = 'SELECT';
select grantee from information_schema.role_table_grants
where table_name = 'tournament_invites' and grantee in ('anon') and privilege_type = 'SELECT';

-- no policy may be gated on the legacy is_admin() (expect zero rows)
select schemaname, tablename, policyname from pg_policies
where qual like '%is_admin()%' or with_check like '%is_admin()%';
```

The CLI equivalents (after `supabase link`) are `npx supabase db advisors` (this is
the linter that reports "table without RLS" / "policy too permissive") and
`npx supabase db lint`.


### Bootstrap the first administrator

1. Sign up through `/login` (email + password or Google).
2. Supabase → Authentication → Users → copy your user id.
3. In the SQL editor:

```sql
insert into public.user_roles (user_id, role) values ('<uuid>', 'app_admin')
on conflict (user_id) do update set role = 'app_admin';
```

4. Reload the site: **Tournaments / Posts / Users** appear in the nav. Further
   admins can be promoted from `/admin/users` without SQL.

### Auth configuration (Supabase dashboard)

- **URL Configuration** → **Site URL** = the app's public URL
  (`https://obsidian-league.vercel.app` today, your custom domain after §7);
  **Redirect URLs** += `https://<domain>/**` for **every** host the app answers on
  (`https://obsidian-league.vercel.app/**`, `https://<your-domain>/**`, plus
  `http://localhost:3000/**` for local dev).
- **Providers → Google**: enable, paste the OAuth client id/secret (authorised
  redirect URI = `https://<ref>.supabase.co/auth/v1/callback`).
- **Rate limits**: keep email/password sign-ins and resets tight.
- **Email templates**: confirm/reset links must land on
  `https://<domain>/auth/callback` (the handler exchanges the code and honours a
  `next` parameter).

#### Fixing the Google OAuth consent screen

By default Google shows **"Sign in to [your Supabase project ref]"** - ugly and confusing for users. To show your app name instead:

1. **Create a Google Cloud project** (if you don't have one):
   - Go to [console.cloud.google.com](https://console.cloud.google.com) → **New Project**.
   - Name it after your app (e.g. "Obsidian Elite").

2. **Configure the OAuth consent screen**:
   - **Users & permissions** → **OAuth consent screen**.
   - Choose **External** → **Create**.
   - Fill in:
     - *App name*: your real product name (this is what users see).
     - *User support email*: your contact or support address.
     - *Developer contact email*: your email.
   - **Scopes**: click **Add or Remove Scopes** → add `.../auth/userinfo.email` and `.../auth/userinfo.profile` → **Update**.
   - **Test users**: add any admin/test emails so you can publish before full verification.
   - Click **Save and Continue** → **Back to Dashboard**.

3. **Create the OAuth client**:
   - **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Obsidian Elite Web Client` (or whatever you like).
   - **Authorized redirect URIs**: add BOTH of these:
     - `https://<your-supabase-ref>.supabase.co/auth/v1/callback`
     - `http://localhost:3000/auth/callback` (for local dev)
   - Click **Create** → copy the **Client ID** and **Client Secret**.

4. **Paste into Supabase**:
   - Supabase → **Authentication** → **Providers** → **Google** → paste Client ID + Secret.
   - Save. The next time a user signs in with Google they'll see **"Sign in to Obsidian Elite"**.

> **Note**: Google requires domain verification for public apps. Until verified, only the test users you added in step 2 can see the branded consent screen. Other users will still see the unbranded Supabase-style message. For a fully custom branded screen visible to everyone, complete Google's verification flow (requires a public website with privacy policy and terms).
---

## 3. Fonts (self-hosted Inter)

Drop the files listed in `public/fonts/README.md` into **`public/fonts/`**:

| File | Weight |
| --- | --- |
| `Inter-Regular.woff2` | 400 |
| `Inter-Medium.woff2` | 500 |
| `Inter-SemiBold.woff2` | 600 |
| `Inter-Bold.woff2` | 700 |
| `Inter-ExtraBold.woff2` | 800 |

`src/app/globals.css` already declares the `@font-face` rules with
`font-display: swap` plus a system fallback, so a missing file simply falls back
- it never breaks the build or the page. The app intentionally does **not** use
`next/font/google` (it would make every build depend on network access to
fonts.googleapis.com).

---

## 4. Deploy to Vercel

1. Vercel → **Add New → Project** → import the GitHub repo.
2. Framework preset: **Next.js** (defaults `npm run build`).
3. Add every environment variable from section 1.
4. Deploy - `next.config.ts` applies the security headers (CSP, HSTS, ...) and
   image allowlists automatically.

### Post-deploy verification

```powershell
npm run typecheck                    # TypeScript
npm run lint                         # ESLint
npm run build                        # production build
npm run smoke https://your-domain    # routes, headers, authz boundaries
```

`npm run smoke` asserts: home/`/competitions`/`/teams`/`/news`/`/medals`/`/login`
render, `/admin` is gated, `/api/admin-auth-info` is `no-store` + anonymous,
`/api/revalidate` returns **403** to anonymous callers, the security headers are
present, `robots.txt` + `sitemap.xml` are served, and unknown routes 404.

Then, by hand with a real sign-in:

1. `/admin` → register a team, schedule a fixture, save settings.
2. `/admin/tournaments/[id]` → create an invite, open it in a private window,
   sign up, accept → you land in `/admin` as a tournament member.
3. `/admin/match/[id]` → log an event and tap a stat button; the public
   `/match/[id]` page updates live.
4. `/admin/posts` → publish an article; it appears on the home carousel and
   `/news` **immediately** (proves the cache purge works).
---

## 5. Placeholder content (facts, so you can decide)

Not everything "sample" needs replacing - three items are deliberate:

| Item | Status |
| --- | --- |
| `supabase/migrations/04_seed_ccgames2026.sql` | **Real seed data** - Coal City Games 2026 (Enugu, 27 Nov → 11 Dec 2026) is the first tournament hosted on the app. It also seeds the 18-sport catalogue. Keep it. |
| `public/logo.jpeg`, `logo.png`, `logo-compressed.jpeg`, `og-image.png`, `favicon*`, `apple-touch-icon.png`, `android-chrome-*.png` | **The app's brand assets**, used across the UI, metadata and the PWA manifest. Keep them. |
| `public/fonts/*.woff2` | **Real brand typography** (Inter 18pt, subset + converted to woff2 ≈ 194 KB). Keep; see `public/fonts/README.md`. |

Genuine placeholders to review before launch:

| Where | Placeholder | Replace with |
| --- | --- | --- |
| `.env.example`, `.env.local`, Vercel env | `NEXT_PUBLIC_REGISTRATION_WHATSAPP=15551234567` | the organisers' WhatsApp number (digits, international, no `+`) |
| same | `NEXT_PUBLIC_REGISTRATION_EMAIL=entries@example.com` | the real registration inbox |
| `src/lib/registration.ts` | `REGISTRATION_TEMPLATE` wording | your own copy / translation |
| Supabase Auth → Email templates | default Supabase copy | branded confirm / reset emails |
| `README.md` | still describes the original two-table app | rewrite to match the current feature set (tournaments, roles, invites, articles, medals) |

---

## 6. Operations

| Concern | Current setup | Next step as traffic grows |
| --- | --- | --- |
| Errors/traces | Sentry - 10% of successful transactions, 100% of unhandled errors | raise `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` on a paid plan; add build-time source maps (`SENTRY_AUTH_TOKEN` + `withSentryConfig`) |
| Rate limiting | Upstash sliding window on `/api/*` (in-process fallback) | add Cloudflare + Turnstile in front of sign-in |
| Cache | Next Data Cache (30 s-1 h) + Upstash for semi-static reads | raise TTLs, enable a Postgres read replica |
| Realtime | Supabase Realtime channels | Redis pub/sub fan-out or an enterprise websocket tier |
| Backups | Supabase daily backups | enable PITR + run a documented restore drill |
| CI | `npm run typecheck && npm run lint && npm run build` | run `npm run smoke` against the preview URL in GitHub Actions |

### Rollback

- **App** - Vercel → Deployments → *Promote* the previous build.
- **Cache** - `POST /api/revalidate` with an admin session purges both layers.
- **Database** — migrations 00–13 are additive/idempotent; take a `pg_dump`
  before applying so a policy change can be reverted safely.

---

## 7. Switching to a custom domain (after purchase)

The app is currently served from **`https://obsidian-league.vercel.app`** (the
Vercel project URL). When the real domain is bought, the swap is deliberately
centralised: **everything domain-dependent reads one variable**,
`NEXT_PUBLIC_SITE_URL`, which is consumed in exactly three places.

| File | What it drives |
| --- | --- |
| `src/app/layout.tsx` (`metadataBase`) | absolute URLs in metadata, OG/Twitter cards, canonical links |
| `src/app/robots.ts` | the `Sitemap:` line + `Host:` |
| `src/app/sitemap.ts` | every `<loc>` in `sitemap.xml` |

`next.config.ts` needs **no change**: its image allowlist covers `*.supabase.co`
plus Unsplash, and its CSP allows `connect-src https://*.supabase.co` — neither
mentions the app's own domain. All three consumers use `||` fallbacks, so an
**empty** value degrades to `http://localhost:3000` instead of crashing the build.

### Step 1 — buy the domain and connect it to Vercel

1. Buy the domain (any registrar), e.g. `obsidianelite.com`.
2. Vercel → **Project → Settings → Domains → Add** → type the domain.
3. Create the DNS records Vercel shows, at your registrar:
   - apex (`example.com`) → Vercel's **A** record (or the **ALIAS/ANAME** value it suggests),
   - `www` → **CNAME** `cname.vercel-dns.com`.
4. Wait for **"Valid Configuration"** and the automatic **HTTPS certificate**
   (usually a few minutes).
5. Keep `obsidian-league.vercel.app` attached so existing links keep working.
   Optionally set the custom domain as **primary** so Vercel 308-redirects the
   `*.vercel.app` host to it.

### Step 2 — tell the app about the new domain

`NEXT_PUBLIC_SITE_URL` is **baked into the build** (`metadataBase`, `robots.txt`
and `sitemap.xml` are prerendered), so changing it requires a **redeploy** —
editing the Vercel env var alone changes nothing until a new build runs.

| Where | Set to |
| --- | --- |
| **Vercel → Project → Settings → Environment Variables** (Production **and** Preview) | `https://obsidianelite.com` |
| **GitHub → repo → Settings → Secrets and variables → Actions** → `NEXT_PUBLIC_SITE_URL` | `https://obsidianelite.com` (`.github/workflows/build.yml` feeds it to `next build`) |
| `.env.example` (template) and local `.env.local` | `https://obsidianelite.com` — or keep `http://localhost:3000` for local-only dev |

Then **redeploy**: Vercel → **Deployments** → *Redeploy*, and untick
**"Use existing build cache"** so the new value is picked up.

### Step 3 — Supabase (and Google)

1. Supabase → **Authentication → URL Configuration**:
   - **Site URL** = `https://obsidianelite.com`
   - **Redirect URLs** += `https://obsidianelite.com/**` — keep
     `http://localhost:3000/**` and `https://obsidian-league.vercel.app/**` too,
     so in-flight password resets and invite links never break mid-switch.
2. Supabase → **Authentication → Email Templates**: confirm the confirm/reset
   links use `{{ .SiteURL }}` / `{{ .RedirectTo }}` (default) so they follow the
   new domain automatically; otherwise hardcode
   `https://obsidianelite.com/auth/callback`.
3. **Google OAuth: no change needed.** Its authorised redirect URI is the
   *Supabase* callback (`https://<ref>.supabase.co/auth/v1/callback`), which does
   not move when the app's own domain changes. Only update the consent screen's
   app name / support email if the brand changes.

### Step 4 — verify, then you are done

```powershell
npm run smoke https://obsidianelite.com   # routes, headers, authz boundaries
```

- `https://obsidianelite.com/robots.txt` → `Sitemap: https://obsidianelite.com/sitemap.xml`
- `https://obsidianelite.com/sitemap.xml` → every `<loc>` starts with the new domain
- Sign in with **Google** and **email**, accept an invite link end-to-end, and
  confirm a shared `/news/<slug>` link previews with the new domain.

### Rolling back

Point `NEXT_PUBLIC_SITE_URL` back to `https://obsidian-league.vercel.app` in
Vercel + the GitHub secret and redeploy. The `*.vercel.app` host stays attached,
so the site remains reachable at either address — the switch is non-destructive.