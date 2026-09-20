# Obsidian Elite - Tournament Manager

A full-stack tournament management platform for multi-sport games: public
fixtures, live match tracking, squad/roster management, medal tables,
news publishing and a scoped admin console. Built with **Next.js 16**, **React
19**, **Tailwind v4** and **Supabase**, and designed for high-traffic public
pages (ISR + shared cache) with a small, heavily-scoped write surface.

The first tournament hosted on the app is **Coal City Games 2026**
(Enugu, 27 Nov → 11 Dec 2026), seeded by
`supabase/migrations/04_seed_ccgames2026.sql` together with an 18-sport
catalogue.

---

## Features

### Public hub
| Route | What it does |
| --- | --- |
| `/` | Matches of the day, upcoming fixtures, recent results, the **Latest Insights** article carousel and the **team registration** banner (WhatsApp / email with a prefilled message) |
| `/competitions` | Results, fixtures, group tables, play-off bracket and player/team stats |
| `/match/[id]` | Live scoreboard, timeline of events, statistics, line-ups, standings |
| `/teams` + `/team/[id]` | Team directory (search + category/sport/group filters) and team profiles with squad and staff |
| `/news` + `/news/[slug]` | Articles written by tournament staff |
| `/medals` | Gold/silver/bronze standings per team and per athlete |
| `/onboarding` | The guide: every feature explained for Fans · Users · Scouts · Tournament admins · App admins, plus the in-app guided tour of the real controls |
| `/login`, `/invite/[token]` | Sign in / sign up (email, password reset, Google) and tournament invite acceptance |

### Admin console (role-gated, tournament-scoped)
| Route | What it does |
| --- | --- |
| `/admin` | Dashboard: pick a working tournament, register teams (with a **squad checklist**: name + shirt number, add/edit/reorder/remove), schedule fixtures (edit/delete), save tournament settings |
| `/admin/tournaments` | Tournament CRUD + "make active" (single-active enforced by the DB) |
| `/admin/tournaments/[id]` | Overview, settings, article CRUD, invite create/revoke/copy-link, member roster, per-sport enablement (app admins) |
| `/admin/posts` | Newsroom: filter/search articles, draft↔publish, edit, delete |
| `/admin/users` | App-admin-only directory with role management |
| `/admin/match/[id]` | Live match manager: clock (start/pause/half-time/full-time/extra time), atomic score + per-stat writes, event logging with scorer/assist, event deletion |

### Roles & permissions
- `app_admin` - everything, plus user/role administration and global tables.
- `tournament_admin` - scoped to the tournaments they are a member of, with a
  `duties` array (`*` = full manager, or specific duties such as `score`, `posts`).
- `user` - public site only.
- Authorization is enforced in **Postgres RLS** (plus `SECURITY DEFINER` RPCs that
  re-check duties); the UI only mirrors it, never decides it.

---

## Local development

```powershell
npm install
copy .env.example .env.local     # then paste your Supabase URL + anon key
npm run dev                      # http://localhost:3000
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | dev server (Turbopack) |
| `npm run build` / `npm start` | production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (0 errors expected) |
| `npm run smoke [url]` | post-deploy smoke test (defaults to `http://localhost:3000`) |
| `npm run db:push` / `npm run db:list` | apply / inspect Supabase migrations |
| `python scripts/subset-fonts.py` | re-generate the self-hosted Inter `woff2` files |

The app runs without Sentry or Upstash credentials - both integrations degrade
gracefully. Nothing is required beyond the Supabase URL + anon key.

---

## Documentation

| File | Contents |
| --- | --- |
| [`DEPLOY.md`](./DEPLOY.md) | Full deployment guide: env vars, migrations, auth setup, first admin, verification, placeholder inventory, operations & rollback |
| [`FESO.md`](./FESO.md) | Delivery log: what each workstream delivered, the registration message template, and the remaining known gaps |
| [`SECURITY_AND_SCALING.md`](./SECURITY_AND_SCALING.md) | Security model and the scale-up roadmap (cache, realtime, replicas, rate limiting) |
| `/onboarding` (in-app) | Role guide (Fans · Users · Scouts · Tournament admins · App admins) plus the guided component tour — the canonical feature reference for every level of user |
| [`public/fonts/README.md`](./public/fonts/README.md) | Font pipeline (subset + woff2 conversion) |

## Project structure

```
src/
  app/                      routes (public hub, admin console, auth, api)
  components/               shared UI (Navigation, skeletons, HomeInsights...)
  components/admin/         admin widgets + roster checklist editors
  lib/
    admin-auth.ts           server-side role/membership resolution
    use-admin-auth.ts       client mirror via /api/admin-auth-info
    public-api.ts           cached public reads (restGet / cachedRestGet)
    cache.ts                Upstash Redis layer (in-memory fallback)
    rate-limit.ts           Upstash sliding window (in-process fallback)
    monitoring.ts           Sentry helpers + sampling config
    registration.ts         team-registration links + message template
  proxy.ts                  session refresh + optimistic /admin gate
supabase/
  config.toml               Supabase CLI project config
  migrations/01...11          schema source of truth (idempotent)
  schema*.sql               legacy origin schema (history only)
scripts/
  smoke.mjs                 deployment smoke test
  subset-fonts.py           Inter subset → woff2 pipeline
```

---

## Architecture notes

- **Public reads** go through `restGet`/`cachedRestGet`, which use the anon key
  (RLS applies) with the Next.js Data Cache (`revalidate: 30s-1h`) and, when
  configured, a shared Upstash layer for heavy semi-static data. Live scores are
  never cached there.
- **Writes** happen from the browser through Supabase with RLS; scores and stats
  additionally go through the atomic `record_score()` / `record_stat()` RPCs so
  concurrent taps can't lose updates.
- **Cache invalidation** - every admin write calls `POST /api/revalidate`, which
  expires the `public-data` tag and purges the shared keys, so published articles
  and score changes appear immediately.
- **Fonts** are self-hosted (Inter, subset, woff2, ~194 KB) with a system
  fallback; no build-time font downloads.
- **Monitoring** — Sentry captures 100% of unhandled errors at a 10% performance
  sampling rate by default. Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
  in your deploy env to enable source-map uploads (free, automatic on build).
- **Realtime scaling** — The app uses direct Supabase Realtime WebSockets (free tier:
  5 simultaneous connections per project). For high-concurrency deployments where
  this limit is hit, switch to Upstash Redis Pub/Sub as the fan-out layer:
  1. Create a Redis database at [upstash.com](https://upstash.com) ($5/mo for 1M ops/day).
  2. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in your env.
  3. Set `UPSTASH_REALTIME_CHANNEL=obsidian-realtime`.
  4. The edge handler at `/api/realtime-sub` streams changes via Server-Sent Events;
     clients fall back to it automatically when the Supabase connection cap is reached.
  See `.env.example` for the full variable list.
