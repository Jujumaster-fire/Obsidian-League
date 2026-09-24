/**
 * Onboarding content — the typed, testable description of every feature the app
 * ships, for every level of user.
 *
 * This module powers BOTH onboarding surfaces:
 *
 *   * `/onboarding` (`OnboardingGuide.tsx`) renders the role tabs: Fans ·
 *     Users · Scouts · Tournament admins · App admins.
 *   * `OnboardingExperience` (mounted in the root layout) renders the welcome
 *     dialog and the guided tour that spotlights real components through their
 *     `data-tour` anchors, and highlights the matching route when a step lives
 *     on another page.
 *
 * Everything here is plain data so `src/lib/onboarding.test.ts` can hold the
 * documentation to the same standard as the code: every duty token, every nav
 * link and every tour selector must be documented, and the tour targets must
 * exist in the source.
 *
 * The task/actor model mirrors `supabase/db-setup.sql` (PART 13 scopes) and
 * `src/lib/duties.ts`; when the SQL grammar changes, update this file and the
 * test fails until it is complete again.
 */

import {
  CLOCK_DUTY,
  ENTRY_DUTY,
  LINEUP_DUTY,
  POSTS_DUTY,
  RESERVED_DUTIES,
  ROSTER_DUTY,
  SCORE_DUTY,
  WILDCARD_DUTY,
} from '@/lib/duties'

export type RoleId = 'fan' | 'user' | 'scout' | 'tournament_admin' | 'app_admin'

export interface RoleGuide {
  id: RoleId
  label: string
  tagline: string
  summary: string
  /** What somebody in this role needs before they can do anything. */
  needs: string[]
  journey: JourneyStep[]
  featureIds: string[]
  tourRole: RoleId
}

export interface JourneyStep {
  title: string
  detail: string
  href?: string
}

export interface FeatureDoc {
  id: string
  title: string
  /** Public route where the feature lives. */
  route: string
  roles: RoleId[]
  /** What it is, in one or two sentences. */
  what: string
  /** How to use it, in one or two sentences. */
  how: string
  /** The boundary — what it deliberately cannot do. */
  limits?: string
  tourId?: string
}

export interface TourStep {
  id: string
  title: string
  body: string
  /** CSS selector, normally `[data-tour="…"]`. */
  selector: string
  /** Pathname (or prefix) the element lives on. */
  path: string
  roles: RoleId[]
}

/* -------------------------------------------------------------------------- */
/* Feature catalogue                                                          */
/* -------------------------------------------------------------------------- */

export const FEATURES: FeatureDoc[] = [
  {
    id: 'home-matchday',
    title: 'Match-day hub',
    route: '/',
    roles: ['fan', 'user'],
    what: 'The landing page: matches of the day (live scores, kick-off times, venues), the next fixtures and the most recent results, all read from the live database.',
    how: 'Open `/`. Live cards refresh on their own; tap any card to open the match centre for that fixture.',
    limits: 'Only public competition data is shown — never squad contact details or admin tooling.',
    tourId: 'tour-home-matchday',
  },
  {
    id: 'home-insights',
    title: 'Latest Insights carousel',
    route: '/',
    roles: ['fan', 'user'],
    what: 'The newest published articles, presented as a carousel directly under the match-day block.',
    how: 'Swipe or use the arrows; selecting a card opens the full article.',
    limits: 'Drafts and future-dated articles never appear here.',
    tourId: 'tour-home-insights',
  },
  {
    id: 'home-registration',
    title: 'Team registration banner',
    route: '/',
    roles: ['fan', 'user'],
    what: 'The entry banner: a countdown to the tournament plus WhatsApp and email buttons carrying a pre-filled registration message for the active tournament.',
    how: 'Press WhatsApp or email to open the conversation with the message already written, including the tournament name, dates and host city.',
    limits: 'Entry is a conversation with the organisers, not an account action — there is no self-service team signup.',
    tourId: 'tour-home-registration',
  },
  {
    id: 'competitions-tabs',
    title: 'Competitions hub',
    route: '/competitions',
    roles: ['fan', 'user', 'scout', 'tournament_admin', 'app_admin'],
    what: 'Every result, fixture, table and statistic for the tournament in one page, split into Overview, Results, Fixtures, Stats, Groups and Play-offs.',
    how: 'Use the sticky bar to jump between sections. The active tab is written to `?tab=` so the URL is shareable and the back button works.',
    tourId: 'tour-competitions-tabs',
  },
  {
    id: 'competitions-live',
    title: 'Live match strip',
    route: '/competitions',
    roles: ['fan', 'user', 'scout'],
    what: 'In-progress and extra-time fixtures with their running score, updated over Supabase Realtime the moment a scorer taps in the console.',
    how: 'Open the Overview tab — matches in play appear at the top with a live badge.',
    limits: 'Score changes arrive in realtime, but the surrounding page data is cached for 30 seconds.',
  },
  {
    id: 'competitions-stats',
    title: 'Leaderboards',
    route: '/competitions',
    roles: ['fan', 'user'],
    what: 'Top scorers, assists, yellow and red cards, team expected goals and clean sheets, computed from the logged timeline events.',
    how: 'Open the Stats tab; the tables only include events the operators actually logged.',
    limits: 'Counts come from match events, so a match nobody logged produces no leaders.',
  },
  {
    id: 'competitions-groups',
    title: 'Group standings',
    route: '/competitions',
    roles: ['fan', 'user'],
    what: 'League tables per group and category: played, won, drawn, lost, goals for and against, difference and points.',
    how: 'Open the Groups tab. Tables are derived from finished fixtures, so they update as soon as a match is set to Full time.',
    limits: 'Only `full_time` fixtures count toward a table.',
  },
  {
    id: 'competitions-playoffs',
    title: 'Play-off bracket',
    route: '/competitions',
    roles: ['fan', 'user'],
    what: 'Quarter-final, semi-final and final pairings with their scores, for knockout and group-to-knockout tournaments.',
    how: 'Open the Play-offs tab; each stage is grouped in its own column.',
    limits: 'Stages come from the fixture record — a bracket never reorders itself automatically.',
  },
  {
    id: 'match-live',
    title: 'Live match centre',
    route: '/match/[id]',
    roles: ['fan', 'user', 'scout', 'tournament_admin', 'app_admin'],
    what: 'The public match page: scoreboard with the running clock, status, venue, both line-ups and the competition table.',
    how: 'Open any fixture link (from the hub, a team page or a shared URL). The page subscribes to that fixture and patches itself as events arrive.',
    limits: 'Realtime is one-way here — nothing on this page can change the match.',
    tourId: 'tour-match-live',
  },
  {
    id: 'match-tabs',
    title: 'Match tabs',
    route: '/match/[id]',
    roles: ['fan', 'user'],
    what: 'Five views of one match: Overview, Stats (side-by-side comparison), Timeline (goals, cards, subs, breaks), Line-up (formation on the sport court) and Table.',
    how: 'Pick a tab; the choice is stored in `?tab=` so the exact view can be shared or bookmarked.',
    tourId: 'tour-match-tabs',
  },
  {
    id: 'teams-explorer',
    title: 'Team directory',
    route: '/teams',
    roles: ['fan', 'user'],
    what: 'Every registered team with free-text search plus category, discipline and group filters.',
    how: 'Type a name or pick filters; each card opens the team profile.',
    tourId: 'tour-teams',
  },
  {
    id: 'team-profile',
    title: 'Team profile',
    route: '/team/[id]',
    roles: ['fan', 'user'],
    what: 'One team in full: crest and colours, technical staff (coach, tactical coach, assistant, medical, kit), the squad with shirt numbers, and recent plus upcoming fixtures.',
    how: 'Open a team from the directory or from any fixture card.',
  },
  {
    id: 'news-list',
    title: 'Newsroom',
    route: '/news',
    roles: ['fan', 'user'],
    what: 'Every published article, newest first, with category, cover image and excerpt.',
    how: 'Open `/news` or the News link in the navigation.',
    tourId: 'tour-news',
  },
  {
    id: 'news-article',
    title: 'Article page',
    route: '/news/[slug]',
    roles: ['fan', 'user'],
    what: 'A single story with its cover art, by-line, publish date and body, plus links back to the newsroom.',
    how: 'Open any story from the newsroom or the home carousel. URLs use a readable slug.',
    limits: 'A published article appears immediately because every admin write purges the page cache.',
  },
  {
    id: 'medals-table',
    title: 'Medal tables',
    route: '/medals',
    roles: ['fan', 'user'],
    what: 'Two tables: medals by team and medals by athlete, split into gold, silver and bronze with totals.',
    how: 'Open `/medals`; it is built from fixture entries recorded by tournament staff.',
    limits: 'A medal only appears once an entry with a rank and medal has been saved for that fixture.',
    tourId: 'tour-medals',
  },
  {
    id: 'account-auth',
    title: 'Accounts',
    route: '/login',
    roles: ['fan', 'user', 'scout', 'tournament_admin', 'app_admin'],
    what: 'Sign in, sign up, password reset and Google sign-in, plus sign-out from the navigation.',
    how: 'Use email and password or Google. Signing in after opening an invite link completes your membership automatically.',
    limits: 'Creating an account grants no admin power by itself — access always comes from a role or a tournament invite.',
  },
  {
    id: 'invite-accept',
    title: 'Invite acceptance',
    route: '/invite/[token]',
    roles: ['user', 'scout', 'tournament_admin', 'app_admin'],
    what: 'The page behind a staff invite link: it shows the tournament and the exact duty list you are being offered, then joins you to it with one tap.',
    how: 'Open the link, sign in if asked, then accept. You land in the admin console with only the tools your duties cover.',
    limits: 'Links expire (1-90 days), can be revoked, and every acceptance is written to the membership roster.',
  },
  {
    id: 'guide',
    title: 'This guide and the guided tour',
    route: '/onboarding',
    roles: ['fan', 'user', 'scout', 'tournament_admin', 'app_admin'],
    what: 'The page you are reading: every feature described for every level of user, plus a component tour that spotlights the real controls on any screen.',
    how: 'Pick your role tab to see only what applies to you, then press "Take the tour" to walk through the live interface step by step.',
    tourId: 'tour-guide',
  },
  {
    id: 'admin-dashboard',
    title: 'Tournament dashboard',
    route: '/admin',
    roles: ['tournament_admin', 'app_admin'],
    what: 'The staff home screen: pick the tournament you are working on, then register teams, schedule fixtures, review both lists and save the tournament settings.',
    how: 'Choose a tournament in the selector at the top. Everything below is scoped to that edition, and every write asks the public site to refresh its cache.',
    limits: 'A tournament member only ever sees tournaments they belong to; rows without a tournament stay app-admin-only.',
    tourId: 'tour-admin-dashboard',
  },
  {
    id: 'admin-squad',
    title: 'Register a team with a squad checklist',
    route: '/admin',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Create a team (name, short name, crest, colours, staff) and build its squad as an ordered checklist of player name plus shirt number.',
    how: 'Fill the team form, then use the squad checklist to add, edit, reorder or remove players. Rows land in the `players` table, so the public squad list and the console line-up both see them.',
    limits: 'Squad edits need the `roster` duty (or `*`); the form hides without it and Postgres re-checks it.',
    tourId: 'tour-admin-team',
  },
  {
    id: 'admin-schedule',
    title: 'Schedule a fixture',
    route: '/admin',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Create a fixture by picking the two teams, the sport, the date, the venue, the stage and the group.',
    how: 'Use the schedule form. The new fixture appears immediately in the Fixtures list and on the public hub, ready to open in the live console.',
    limits: 'Needs the `score` or `roster` duty.',
    tourId: 'tour-admin-fixture',
  },
  {
    id: 'admin-fixtures',
    title: 'Fixture management',
    route: '/admin',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Every fixture in the selected tournament with inline edit and delete, plus a direct link into the live match console.',
    how: 'Edit a row to correct a date, venue, stage or score, or delete it. Open the console link when the match starts.',
    limits: 'Deleting a fixture also removes its events, entries and line-ups (cascade).',
    tourId: 'tour-admin-fixture-list',
  },
  {
    id: 'admin-teams',
    title: 'Team list',
    route: '/admin',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Every registered team with its squad size, group and links to the public profile and the roster editor.',
    how: 'Use the search box for larger tournaments; open a row to edit staff, colours or the squad.',
    tourId: 'tour-admin-team-list',
  },
  {
    id: 'admin-settings',
    title: 'Tournament settings',
    route: '/admin',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Per-tournament configuration: format (league, knockouts or group to knockout), table arrangement, rules and contact copy, stored against the tournament row.',
    how: 'Edit the fields and save. Settings are keyed by tournament, so two editions never overwrite each other.',
    limits: 'Legacy rows without a `tournament_id` remain app-admin-only.',
    tourId: 'tour-admin-settings',
  },
  {
    id: 'console-live',
    title: 'Live match console',
    route: '/admin/match/[id]',
    roles: ['scout', 'tournament_admin', 'app_admin'],
    what: 'The single operator screen for one match: running clock, scoreboard, logger roster, stat counters, timeline, line-up canvas and the per-match rule overrides.',
    how: 'Open it from the Fixtures list or from any match page. Every tap is written through a duty-checked database function, so two operators can log different streams without losing each other updates.',
    limits: 'You only see the tools your duties cover, and the server re-checks every write — a forged request cannot exceed them.',
    tourId: 'tour-console-header',
  },
  {
    id: 'console-scopes',
    title: 'Scope rail and logger roster',
    route: '/admin/match/[id]',
    roles: ['scout', 'tournament_admin', 'app_admin'],
    what: 'The rotation rail switches the console between Clock, Stats, Timeline, Line-up and Allocated times; the roster underneath shows who is logging what on this match right now.',
    how: 'Claim a stream to reserve it for yourself — one holder per stream per match — then work inside that scope. A locked scope shows a padlock and the reason.',
    limits: 'A claim is a booking, not a permission: your duties still decide what you may write, and claims lapse after five minutes without a heartbeat.',
    tourId: 'tour-console-scopes',
  },
  {
    id: 'console-stats',
    title: 'Stat counters',
    route: '/admin/match/[id]',
    roles: ['scout', 'tournament_admin', 'app_admin'],
    what: 'Per-side counters (shots, passes, fouls, corners and whatever else the sport vocabulary defines) that increment atomically, plus a set-value control for corrections.',
    how: 'Tap +1 on the side that earned it, or open the value field to correct a number. Each tap calls `record_stat` or `set_fixture_stat` and returns the authoritative new value.',
    limits: 'The key must exist in the fixture vocabulary and be covered by your duties; both are validated in Postgres.',
    tourId: 'tour-console-stats',
  },
  {
    id: 'console-events',
    title: 'Timeline and event logging',
    route: '/admin/match/[id]',
    roles: ['scout', 'tournament_admin', 'app_admin'],
    what: 'Log goals, cards, substitutions, breaks and sport-specific events with minute, team, scorer, assist and details; the timeline lists what has been logged and lets you delete a mistake.',
    how: 'Pick the event type, side, player and minute, then save. The public match page renders the same timeline within seconds.',
    limits: 'Each event type is validated against the fixture vocabulary, and every entry records who logged it.',
    tourId: 'tour-console-timeline',
  },
  {
    id: 'console-clock',
    title: 'Clock and status',
    route: '/admin/match/[id]',
    roles: ['scout', 'tournament_admin', 'app_admin'],
    what: 'Start, pause, half-time, extra time and full time, with elapsed seconds, period control and a manual minute override; the header always shows the live clock.',
    how: 'Use the clock panel. The clock is stored against the fixture and rendered from a server timestamp, so a reload or a second device shows the same time.',
    limits: 'Clock control needs the `clock` or `score` duty.',
    tourId: 'tour-console-clock',
  },
  {
    id: 'console-lineup',
    title: 'Line-ups and formation canvas',
    route: '/admin/match/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'A drag-editable formation board per team. Each token stores a slot, a role, an x/y position inside a unit square and whether the player is captain.',
    how: 'Pick a player from the squad, drag the token into position and save. Coordinates are stored with the match and streamed to the public match page.',
    limits: 'Needs the `lineup` duty, deliberately separate from `score` — a scorer cannot quietly rewrite a formation.',
    tourId: 'tour-console-lineup',
  },
  {
    id: 'console-rules',
    title: 'Per-match allocated times and vocabulary',
    route: '/admin/match/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Which periods this specific match plays, how long each lasts, and which extra stat or event keys this fixture uses — a safe override on top of the sport catalogue.',
    how: 'Change the allocation and save; the console clock and the public clock then follow the fixture rules.',
    limits: 'Unknown keys and negative allocations are rejected in Postgres; the global catalogue is never touched.',
    tourId: 'tour-console-rules',
  },
  {
    id: 'tournaments-workspace',
    title: 'Tournament workspace',
    route: '/admin/tournaments/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'The per-tournament control room: overview and settings, article CRUD, invite management, member roster, athlete roster, fixture entries and per-sport enablement.',
    how: 'Open a tournament from the Tournaments list or the dashboard. Each section is labelled with whether you can manage it or only read it, based on your duties.',
    limits: 'Editable only within the tournaments you belong to (app admins everywhere).',
    tourId: 'tour-workspace',
  },
  {
    id: 'tournaments-crud',
    title: 'Tournament CRUD and the active edition',
    route: '/admin/tournaments',
    roles: ['app_admin'],
    what: 'Create, rename, re-slug, re-date, archive and delete tournament editions, and mark exactly one as active.',
    how: 'Use the new-tournament form and the row actions. The active edition is what the home page, the registration banner and the public hub present.',
    limits: 'App-admin only, and the database enforces a single active tournament.',
    tourId: 'tour-tournaments-new',
  },
  {
    id: 'admin-articles',
    title: 'Article CRUD in the workspace',
    route: '/admin/tournaments/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Write articles with title, slug, excerpt, cover image, category and body, keep them as drafts, then publish.',
    how: 'Create or edit an article and press publish. Published stories appear on the home carousel and in the newsroom straight away.',
    limits: 'Needs the `posts` duty (or `*`). A story stays invisible while it is a draft or future-dated.',
  },
  {
    id: 'admin-invites',
    title: 'Invites',
    route: '/admin/tournaments/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Create unlimited-use invite links carrying the duty they grant, copy the link, set an expiry and revoke the ones you no longer want.',
    how: 'Choose a duty, create the link and share it. Whoever opens it sees the duty before accepting, and the acceptance is recorded on the member roster.',
    limits: 'Only `*` managers (and app admins) can create or revoke invites; expired and revoked links stop working immediately.',
    tourId: 'tour-workspace-invites',
  },
  {
    id: 'admin-members',
    title: 'Member roster',
    route: '/admin/tournaments/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'Everyone who holds a membership in this tournament, with their email, duty list and the date they were granted access.',
    how: 'Review who can do what. App admins can adjust global roles from the Users page; duty changes happen through a fresh invite.',
    limits: 'Reading the roster needs a membership; changing it needs app-admin.',
    tourId: 'tour-workspace-members',
  },
  {
    id: 'admin-athletes',
    title: 'Athlete manager',
    route: '/admin/tournaments/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'The individual-sport competitor roster: add, edit and remove athletes with name, gender, classification, team and division.',
    how: 'Use the athlete form and row actions. Writes go through athlete functions that check the `roster` duty.',
    limits: 'Team-sport players live on the team squad checklist instead.',
  },
  {
    id: 'admin-entries',
    title: 'Fixture entries, results and medals',
    route: '/admin/tournaments/[id]',
    roles: ['tournament_admin', 'app_admin'],
    what: 'The results panel: rank, lane, position and medal for an athlete or team entry in a finished fixture — the data behind the medal tables.',
    how: 'Record an entry against the fixture; ranks and medals feed `/medals` immediately.',
    limits: 'Needs the `entry` or `score` duty.',
  },
  {
    id: 'admin-sports',
    title: 'Per-sport enablement and catalogue',
    route: '/admin/tournaments/[id]',
    roles: ['app_admin'],
    what: 'Switch sports on or off for a tournament and maintain the global catalogue: scoring type, clock, medals and the stat/event vocabulary each sport uses.',
    how: 'Enable a sport for the tournament, then tune its vocabulary so the console offers the right counters for that discipline.',
    limits: 'App-admin only — the catalogue is shared by every tournament.',
  },
  {
    id: 'newsroom',
    title: 'Newsroom console',
    route: '/admin/posts',
    roles: ['tournament_admin', 'app_admin'],
    what: 'All articles across the tournaments you can manage, with search, filters, draft/publish toggling, editing and deletion.',
    how: 'Filter to the story you need, then publish or unpublish. Publishing refreshes the public pages immediately.',
    limits: 'Only tournaments whose membership includes the `posts` duty are listed.',
    tourId: 'tour-newsroom',
  },
  {
    id: 'users-directory',
    title: 'User directory and roles',
    route: '/admin/users',
    roles: ['app_admin'],
    what: 'The platform directory: every account with its email, join date and global role, plus the control to promote or demote.',
    how: 'Search for the account and set its role. Roles are `app_admin`, `tournament_admin` or `user`.',
    limits: 'App-admin only, and the server refuses to remove your own admin role so the last administrator cannot lock everybody out.',
    tourId: 'tour-users',
  },
  {
    id: 'ops-revalidate',
    title: 'Cache purge endpoint',
    route: '/api/revalidate',
    roles: ['app_admin', 'tournament_admin'],
    what: 'A guarded POST endpoint that expires the public page cache and clears the shared cache keys, so an edit shows up instantly.',
    how: 'Called automatically by every admin write — there is nothing to do by hand, and an anonymous caller gets a 403.',
    limits: 'Signed-in staff only, rate limited per IP.',
  },
  {
    id: 'fan-following',
    title: 'Following your team',
    route: '/team/[id]',
    roles: ['fan', 'user'],
    what: 'A team profile keeps everything about one side together: squad, staff, form and the next matches — the fastest way to follow a single team.',
    how: 'Search the team directory once, then bookmark the profile. Fixture cards link straight into the live match centre.',
  },
  {
    id: 'share-links',
    title: 'Shareable views',
    route: '/competitions',
    roles: ['fan', 'user'],
    what: 'The hub and the match centre both keep their state in the URL: `?tab=stats`, `?tab=line-up`, and so on.',
    how: 'Copy the address bar after choosing a tab — whoever opens the link lands on exactly that view.',
  },
]

/* -------------------------------------------------------------------------- */
/* Role guides                                                              */
/* -------------------------------------------------------------------------- */

export const ROLES: RoleGuide[] = [
  {
    id: 'fan',
    label: 'Fans',
    tagline: 'Watch everything — no account needed.',
    summary:
      'Fans get the full public hub: match-day strip, live match centre with tabs, competitions hub, teams, news and medal tables. Nothing here needs a sign-in; every link and every tab is shareable.',
    needs: ['No account and no setup. Open the home page and follow the scores.'],
    journey: [
      {
        title: 'Catch up on today',
        detail: 'Open the home page to see matches of the day, the latest insights and upcoming fixtures.',
        href: '/',
      },
      {
        title: 'Dig into the tournament',
        detail: 'Use the Competitions hub tabs to jump between results, fixtures, stats, group tables and the play-off bracket.',
        href: '/competitions',
      },
      {
        title: 'Watch a match live',
        detail: 'Open any fixture for the scoreboard, timeline and line-ups. The Overview, Stats, Timeline, Line-up and Table tabs keep their own shareable URLs.',
      },
    ],
    featureIds: [
      'home-matchday',
      'home-insights',
      'home-registration',
      'competitions-tabs',
      'competitions-live',
      'competitions-stats',
      'competitions-groups',
      'competitions-playoffs',
      'match-live',
      'match-tabs',
      'teams-explorer',
      'team-profile',
      'news-list',
      'news-article',
      'medals-table',
      'fan-following',
      'share-links',
      'guide',
    ],
    tourRole: 'fan',
  },
  {
    id: 'user',
    label: 'Users',
    tagline: 'Signed-in followers get a smoother ride.',
    summary:
      'A free account unlocks session features: signing in, accepting staff or tournament invites, and using the invite links people send you. The public hub stays exactly the same; your account is the key that staff areas check.',
    needs: [
      'Sign up once with email/password or Google on the login page — no invitation needed for a plain account.',
      'If someone sends you an invite link, open it after signing in to join that tournament with the duties the invite lists.',
    ],
    journey: [
      {
        title: 'Create your account',
        detail: 'Sign up on the login page, then confirm your email if the project requires it. You can sign out from the navigation any time.',
        href: '/login',
      },
      {
        title: 'Accept an invite',
        detail: 'Open the invite link you received, read the tournament name and duty list it shows, and press accept. Invalid, expired or revoked links explain themselves.',
      },
      {
        title: 'See what changed',
        detail: 'Once you hold a membership, extra navigation appears (Dashboard, Tournaments, Posts). Everything you still cannot touch stays hidden.',
      },
    ],
    featureIds: [
      'account-auth',
      'invite-accept',
      'home-matchday',
      'competitions-tabs',
      'match-live',
      'teams-explorer',
      'news-list',
      'medals-table',
      'fan-following',
      'guide',
    ],
    tourRole: 'user',
  },
  {
    id: 'scout',
    label: 'Scouts',
    tagline: 'Log one stream, one match — nothing else.',
    summary:
      'Scouts are match-day operators with a narrow, explicit brief: one counter, one event type, or everything on exactly one fixture. The live console shows only the controls their duties cover, and the database re-checks every tap.',
    needs: [
      'A signed-in account plus an invite link from a tournament manager that lists your duty (for example `stat:shots` or `fixture:<match-id>`).',
      'Know which fixture you are assigned to and which scope you are claiming before kick-off.',
    ],
    journey: [
      {
        title: 'Accept your invite',
        detail: 'Open the invite link, check that the duty matches your assignment, and accept. Fixture-pinned duties only work on that one match.',
      },
      {
        title: 'Open the console and claim a stream',
        detail: 'Find the fixture in the admin fixtures list, open its live match console, and claim your stream in the "Logging now" section. One holder per stream per match.',
        href: '/admin',
      },
      {
        title: 'Log through the game',
        detail: 'Tap +1 on the side that earned the stat, or log the event with minute, team, scorer and assist. Release the stream when play stops.',
      },
    ],
    featureIds: [
      'account-auth',
      'invite-accept',
      'console-live',
      'console-scopes',
      'console-stats',
      'console-events',
      'console-clock',
      'match-live',
      'competitions-live',
      'guide',
    ],
    tourRole: 'scout',
  },
  {
    id: 'tournament_admin',
    label: 'Tournament admins',
    tagline: 'Run one tournament end to end.',
    summary:
      'Tournament admins own everything inside the tournaments they belong to: teams and squads, fixtures, athletes, results, articles, invites and the live console. Power comes from the `duties` list — `*` is a full manager, narrower tokens mean one job each.',
    needs: [
      'A signed-in account and a membership in the tournament, granted by an invite (usually `*`) or promoted by an app admin.',
      'Know your duty list — it decides which console buttons, forms and sections you can actually use.',
    ],
    journey: [
      {
        title: 'Set up the tournament',
        detail: 'Pick your tournament on the dashboard, register every team with its squad checklist, schedule every fixture, and save the tournament settings.',
        href: '/admin',
      },
      {
        title: 'Staff it and publish',
        detail: 'In the workspace, invite managers and scouts with the narrowest duty that works, then publish the first articles so the newsroom and home carousel come alive.',
      },
      {
        title: 'Run match day, record results',
        detail: 'Run clock, score, stats, timeline and line-ups from each console; then record entries with ranks and medals so the medal tables fill up.',
      },
    ],
    featureIds: [
      'account-auth',
      'invite-accept',
      'admin-dashboard',
      'admin-squad',
      'admin-schedule',
      'admin-fixtures',
      'admin-teams',
      'admin-settings',
      'console-live',
      'console-scopes',
      'console-stats',
      'console-events',
      'console-clock',
      'console-lineup',
      'console-rules',
      'tournaments-workspace',
      'admin-articles',
      'admin-invites',
      'admin-members',
      'admin-athletes',
      'admin-entries',
      'newsroom',
      'ops-revalidate',
      'competitions-tabs',
      'match-live',
      'guide',
    ],
    tourRole: 'tournament_admin',
  },
  {
    id: 'app_admin',
    label: 'App admins',
    tagline: 'Own the whole platform.',
    summary:
      'App admins see every tournament plus every global surface: the user directory, tournament creation and activation, and the sport catalogue. Global writes are yours alone; RLS narrows the blast radius for everyone else.',
    needs: [
      'A bootstrapped `app_admin` row (SQL bootstrap for the very first admin, then promotion from the Users page).',
      'Use the Users, Tournaments and sport-catalogue surfaces deliberately — nothing else can write there.',
    ],
    journey: [
      {
        title: 'Stand up the platform',
        detail: 'Create the tournament edition and make it active, confirm the sport catalogue covers every discipline, and promote the first tournament managers.',
        href: '/admin/tournaments',
      },
      {
        title: 'Keep it healthy',
        detail: 'Watch the Users directory for stray roles and revoke invites you no longer need.',
        href: '/admin/users',
      },
      {
        title: 'Prove it works',
        detail: 'Publish an article and watch it land on home, news and the sitemap instantly — the cache purge fires on every write.',
      },
    ],
    featureIds: [
      'account-auth',
      'invite-accept',
      'tournaments-crud',
      'tournaments-workspace',
      'admin-sports',
      'users-directory',
      'admin-articles',
      'admin-invites',
      'newsroom',
      'admin-dashboard',
      'admin-squad',
      'admin-schedule',
      'admin-fixtures',
      'admin-settings',
      'console-live',
      'console-clock',
      'console-stats',
      'console-events',
      'console-lineup',
      'console-rules',
      'ops-revalidate',
      'competitions-tabs',
      'guide',
    ],
    tourRole: 'app_admin',
  },
]

/* -------------------------------------------------------------------------- */
/* Guided-tour steps                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The `path` column is the page the anchor lives on. Pages under a dynamic
 * segment (a specific match, console or workspace) are entry points only — the
 * provider starts a navigated tour exclusively on `NAVIGABLE_TOUR_PATHS` and
 * auto-skips steps whose anchor is absent, so a step can name the right page
 * without ever sending the user to a dead URL.
 */
export const NAVIGABLE_TOUR_PATHS: readonly string[] = [
  '/',
  '/competitions',
  '/teams',
  '/news',
  '/medals',
  '/onboarding',
  '/admin',
  '/admin/tournaments',
  '/admin/posts',
  '/admin/users',
]

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'tour-home-nav',
    title: 'The navigation',
    body: 'Home, Teams, Competitions, News and Medals are always here, plus the Guide you are reading. Staff links appear only after you sign in with a role.',
    selector: '[data-tour="nav-public"]',
    path: '/',
    roles: ['fan', 'user'],
  },
  {
    id: 'tour-home-matchday',
    title: 'Matches of the day',
    body: 'Today\u2019s live scores, kick-off times and venues. Tap any card to open that fixture in the live match centre.',
    selector: '[data-tour="home-matchday"]',
    path: '/',
    roles: ['fan', 'user'],
  },
  {
    id: 'tour-home-insights',
    title: 'Latest Insights',
    body: 'The newest published articles, straight under the match-day block. Selecting a card opens the full story.',
    selector: '[data-tour="home-insights"]',
    path: '/',
    roles: ['fan', 'user'],
  },
  {
    id: 'tour-home-registration',
    title: 'Team registration',
    body: 'The entry banner for the active tournament: a countdown plus WhatsApp and email buttons that open a pre-filled registration message.',
    selector: '[data-tour="home-registration"]',
    path: '/',
    roles: ['fan', 'user'],
  },
  {
    id: 'tour-competitions-tabs',
    title: 'Competitions tabs',
    body: 'One page, six views: overview with live counters, results, fixtures, stats leaders, group tables and the play-off bracket. The tab lives in the URL, so share it.',
    selector: '[data-tour="competitions-tabs"]',
    path: '/competitions',
    roles: ['fan', 'user', 'scout', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-match-live',
    title: 'Live scoreboard',
    body: 'Score, running clock, status, venue and the competition table — patched in realtime as the console operators tap.',
    selector: '[data-tour="match-live"]',
    path: '/match',
    roles: ['fan', 'user', 'scout', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-match-tabs',
    title: 'Match tabs',
    body: 'Overview, side-by-side stats, the event timeline, the formation line-up and the table. Each keeps a shareable URL.',
    selector: '[data-tour="match-tabs"]',
    path: '/match',
    roles: ['fan', 'user'],
  },
  {
    id: 'tour-teams',
    title: 'Team directory',
    body: 'Every registered team with search plus category, discipline and group filters. Each card opens the team profile with squad, staff and fixtures.',
    selector: '[data-tour="teams-explorer"]',
    path: '/teams',
    roles: ['fan', 'user'],
  },
  {
    id: 'tour-news',
    title: 'Newsroom',
    body: 'Every published article, newest first. Publishing here is instant because each admin write purges the page cache.',
    selector: '[data-tour="news-list"]',
    path: '/news',
    roles: ['fan', 'user', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-medals',
    title: 'Medal tables',
    body: 'Gold, silver and bronze by team and by athlete — built from the fixture entries tournament staff record after each final.',
    selector: '[data-tour="medals-table"]',
    path: '/medals',
    roles: ['fan', 'user'],
  },
  {
    id: 'tour-admin-dashboard',
    title: 'Tournament dashboard',
    body: 'Pick the edition you are working on, then register teams, schedule fixtures, review both lists and save settings.',
    selector: '[data-tour="admin-tournament-picker"]',
    path: '/admin',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-admin-team',
    title: 'Register a team',
    body: 'Name, colours and staff, then a squad checklist of names with shirt numbers that feeds the profiles and the console.',
    selector: '[data-tour="admin-team-form"]',
    path: '/admin',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-admin-fixture',
    title: 'Schedule a fixture',
    body: 'Two teams, sport, date, venue, stage and group. The fixture goes live on the public hub immediately.',
    selector: '[data-tour="admin-fixture-form"]',
    path: '/admin',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-admin-fixture-list',
    title: 'Fixture list',
    body: 'Edit, delete and jump straight into each match console from here.',
    selector: '[data-tour="admin-fixture-list"]',
    path: '/admin',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-admin-team-list',
    title: 'Team list',
    body: 'Every registered team with squad size and links to the public profile and the roster editor.',
    selector: '[data-tour="admin-team-list"]',
    path: '/admin',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-admin-settings',
    title: 'Tournament settings',
    body: 'Format, table arrangement, rules and contact copy — stored per tournament so editions never clash.',
    selector: '[data-tour="admin-settings"]',
    path: '/admin',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-console-header',
    title: 'Live match console',
    body: 'The single operator screen for one match: clock, scoreboard, logger roster, stat counters, timeline and line-ups. Every tap is a duty-checked database call.',
    selector: '[data-tour="console-header"]',
    path: '/admin/match',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-console-scopes',
    title: 'Scopes and claims',
    body: 'The rail switches between Clock, Stats, Timeline, Line-up and Allocated times; "Logging now" shows who holds which stream so two people never double-log.',
    selector: '[data-tour="console-scopes"]',
    path: '/admin/match',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-console-stats',
    title: 'Stat counters',
    body: 'Tap +1 for the side that earned it. Counters are atomic — concurrent taps can never lose an update.',
    selector: '[data-tour="console-stats"]',
    path: '/admin/match',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-console-timeline',
    title: 'Timeline and events',
    body: 'Log goals, cards, subs and breaks with scorer and assist; delete a mistaken entry from the same panel.',
    selector: '[data-tour="console-timeline"]',
    path: '/admin/match',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-console-clock',
    title: 'Clock and status',
    body: 'Start, pause, half-time, extra time and full time with a server timestamp, plus a manual minute override.',
    selector: '[data-tour="console-clock"]',
    path: '/admin/match',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-console-lineup',
    title: 'Line-ups and formations',
    body: 'Drag player tokens into position on the sport court. Line-up naming is its own duty, separate from scoring.',
    selector: '[data-tour="console-lineup"]',
    path: '/admin/match',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-console-rules',
    title: 'Allocated times',
    body: 'Per-match period lengths and vocabulary overrides for this fixture, kept separate from the global catalogue.',
    selector: '[data-tour="console-rules"]',
    path: '/admin/match',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-workspace',
    title: 'Tournament workspace',
    body: 'Overview, settings, articles, invites, members, athletes, entries and per-sport toggles for one tournament.',
    selector: '[data-tour="workspace-header"]',
    path: '/admin/tournaments',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-workspace-invites',
    title: 'Invites',
    body: 'Create duty-carrying invite links, copy them, set expiries and revoke dead ones.',
    selector: '[data-tour="workspace-invites"]',
    path: '/admin/tournaments',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-workspace-members',
    title: 'Member roster',
    body: 'Who holds access, which duty list they accepted, and when they were granted it.',
    selector: '[data-tour="workspace-members"]',
    path: '/admin/tournaments',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-tournaments-new',
    title: 'New tournament',
    body: 'Create an edition and mark it active. The active tournament is what the public site presents.',
    selector: '[data-tour="tournaments-new"]',
    path: '/admin/tournaments',
    roles: ['app_admin'],
  },
  {
    id: 'tour-newsroom',
    title: 'Newsroom console',
    body: 'Filter and search every article you can manage, then publish, edit or delete. Publishing busts the public cache.',
    selector: '[data-tour="newsroom-filters"]',
    path: '/admin/posts',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    id: 'tour-users',
    title: 'User directory',
    body: 'Every account with its global role. Promote or demote here — the server blocks removing your own admin role.',
    selector: '[data-tour="users-directory"]',
    path: '/admin/users',
    roles: ['app_admin'],
  },
  {
    id: 'tour-guide',
    title: 'Role guide',
    body: 'Fans, Users, Scouts, Tournament admins and App admins each get their own tab here; the duty table below is the exact grammar the database enforces.',
    selector: '[data-tour="guide-tabs"]',
    path: '/onboarding',
    roles: ['fan', 'user', 'scout', 'tournament_admin', 'app_admin'],
  },
]

/* -------------------------------------------------------------------------- */
/* Duty glossary — the exact grammar PART 13 enforces                        */
/* -------------------------------------------------------------------------- */

export interface DutyDoc {
  token: string
  kind: string
  can: string
  roles: RoleId[]
}

export const DUTY_DOCS: DutyDoc[] = [
  {
    token: WILDCARD_DUTY,
    kind: 'Full manager',
    can: 'Everything inside that tournament: teams, fixtures, clock, stats, events, entries, line-ups, articles, settings and invites.',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    token: SCORE_DUTY,
    kind: 'Scoreboard operator',
    can: 'Scoreboard, clock, stats and events on every fixture of the tournament; entries and rule overrides; also covers scheduling fixtures.',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    token: CLOCK_DUTY,
    kind: 'Clock operator',
    can: 'Clock and period control only (start, pause, half-time, extra time, full time) on every fixture.',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    token: POSTS_DUTY,
    kind: 'News writer',
    can: 'News and articles for the tournament (workspace article CRUD and the newsroom).',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    token: ROSTER_DUTY,
    kind: 'Squad manager',
    can: 'Teams, players and athletes: register teams, manage squad checklists and the athlete roster.',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    token: ENTRY_DUTY,
    kind: 'Results recorder',
    can: 'Fixture entries, results and medals: rank, lane, position and medal per entry.',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    token: LINEUP_DUTY,
    kind: 'Line-up coach',
    can: 'Formations and the starting XI on the console formation canvas.',
    roles: ['tournament_admin', 'app_admin'],
  },
  {
    token: 'stat:<key>',
    kind: 'Stat logger',
    can: 'One counter (for example `stat:shots`) on every fixture of the tournament.',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    token: 'event:<type>',
    kind: 'Event logger',
    can: 'One timeline event type (for example `event:goal`) on every fixture of the tournament.',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    token: 'fixture:<uuid>',
    kind: 'Match scout',
    can: 'Everything, but only on that one fixture — the console opens fully for that match alone.',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    token: 'stat:<key>@<fixture>',
    kind: 'Scoped stat logger',
    can: 'One counter on one fixture only (for example `stat:shots@<match-id>`).',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
  {
    token: 'event:<type>@<fixture>',
    kind: 'Scoped event logger',
    can: 'One event type on one fixture only (for example `event:goal@<match-id>`).',
    roles: ['scout', 'tournament_admin', 'app_admin'],
  },
]

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

const FEATURE_BY_ID = new Map(FEATURES.map((feature) => [feature.id, feature] as const))
const ROLE_BY_ID = new Map(ROLES.map((role) => [role.id, role] as const))
const TOUR_BY_ID = new Map(TOUR_STEPS.map((step) => [step.id, step] as const))
const RESERVED_DUTY_TOKENS: readonly string[] = [...RESERVED_DUTIES]

export function roleById(id: RoleId): RoleGuide {
  const role = ROLE_BY_ID.get(id)
  if (!role) throw new Error(`Unknown onboarding role: ${id}`)
  return role
}

/** `'/onboarding'` matches itself; `'/'` only matches the exact home path. */
export function pathMatches(pathname: string, path: string): boolean {
  /**
   * `/scout/[id]` is the scout's own logging surface — the same console the
   * admin side serves at `/admin/match/[id]` — so a tour step declared for
   * the console must match both routes.
   */
  const normalized = pathname.startsWith('/scout/')
    ? `/admin/match${pathname.slice('/scout'.length)}`
    : pathname
  if (path === '/') return normalized === '/'
  return normalized === path || normalized.startsWith(`${path}/`)
}

/** Steps whose page prefix matches the current pathname, in declared order. */
export function stepsForCurrentLeg(role: RoleId, pathname: string): TourStep[] {
  return TOUR_STEPS.filter((step) => step.roles.includes(role) && pathMatches(pathname, step.path))
}

export function featureById(id: string): FeatureDoc {
  const feature = FEATURE_BY_ID.get(id)
  if (!feature) throw new Error(`Unknown onboarding feature: ${id}`)
  return feature
}

export function featuresForRole(id: RoleId): FeatureDoc[] {
  return roleById(id).featureIds.map(featureById)
}

/** Ordered navigable entry points for a role's tour (routes first, then the rest). */
export function tourEntryRoutes(role: RoleId): string[] {
  const routes: string[] = []
  for (const step of TOUR_STEPS) {
    if (!step.roles.includes(role)) continue
    if (!NAVIGABLE_TOUR_PATHS.includes(step.path)) continue
    if (routes.includes(step.path)) continue
    routes.push(step.path)
  }
  return routes
}

export function tourStepsForRole(role: RoleId): TourStep[] {
  return TOUR_STEPS.filter((step) => step.roles.includes(role))
}

export function dutyGlossaryForRole(id: RoleId): DutyDoc[] {
  return DUTY_DOCS.filter((doc) => doc.roles.includes(id))
}

export function reservedDutyTokens(): readonly string[] {
  return RESERVED_DUTY_TOKENS
}

export function tourStepById(id: string): TourStep {
  const step = TOUR_BY_ID.get(id)
  if (!step) throw new Error(`Unknown tour step: ${id}`)
  return step
}

/* -------------------------------------------------------------------------- */
/* Viewer role detection                                                      */
/* -------------------------------------------------------------------------- */

/** The slice of `useAdminAuth()` state the detector needs (kept structural for tests). */
export interface ViewerAuthLike {
  authenticated: boolean
  /** Global `user_roles.role` (app_admin | tournament_admin | user) or null. */
  role: string | null
  memberships: { duties: string[] | null }[]
}

/**
 * Duties that mark tournament management rather than match-day logging.
 * `score` / `clock` and the stat/event/fixture tokens stay scout-level.
 */
const MANAGEMENT_DUTIES: readonly string[] = [
  WILDCARD_DUTY,
  POSTS_DUTY,
  ROSTER_DUTY,
  ENTRY_DUTY,
  LINEUP_DUTY,
]

/**
 * What the current visitor actually is, in onboarding terms.
 *
 * Everybody is treated as a fan on their first visit; signing in (or up)
 * makes them a user; granted duties promote them to scout (logging tokens
 * such as `score`, `clock`, `stat:<key>`, `event:<type>`, `fixture:<uuid>`)
 * or tournament admin (a management duty or the wildcard); the global
 * `user_roles` row tops the hierarchy for tournament admins and app admins.
 */
export function viewerRoleFor(auth: ViewerAuthLike): RoleId {
  if (!auth.authenticated) return 'fan'
  if (auth.role === 'app_admin') return 'app_admin'
  if (auth.role === 'tournament_admin') return 'tournament_admin'

  const duties = auth.memberships.flatMap((membership) => membership.duties ?? [])
  if (duties.length === 0) return 'user'

  const hasManagement = duties.some((duty) => MANAGEMENT_DUTIES.includes(duty))
  return hasManagement ? 'tournament_admin' : 'scout'
}
