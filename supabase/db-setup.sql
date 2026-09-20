-- ============================================================================
-- Obsidian Elite — COMPLETE DATABASE SETUP (single source of truth)
-- ============================================================================
-- This one file is the entire database: schema, seed data, row level security,
-- realtime configuration, scope/duty authority and every write RPC the app
-- uses. It replaces the old supabase/schema.sql, supabase/schema_updates.sql
-- and supabase/migrations/*.sql — do not reintroduce per-change migration
-- files; edit this file instead.
--
-- HOW TO RUN
--   Supabase SQL editor : paste the whole file and run it.
--   Supabase CLI        : supabase db execute --file supabase/db-setup.sql
--   psql                : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/db-setup.sql
--
-- SAFE TO RUN REPEATEDLY
--   Every statement is idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT
--   EXISTS, CREATE OR REPLACE FUNCTION, policies dropped by name before being
--   recreated, guarded constraint/foreign-key blocks, and guarded publication
--   membership. Running it twice on the same project is a no-op, so the same
--   file serves both "first setup" and "apply the latest changes".
--
--   One deliberate exception: seed rows are inserted with ON CONFLICT DO
--   NOTHING (and clock/medals blocks merged with ||), so editable data — a
--   vocabulary an app admin has customised — is never overwritten by a re-run.
--
-- WHAT IT CONTAINS (read top to bottom; each part is independent)
--   PART 0      base schema (roles, teams, fixtures, match_events, settings) + RLS
--   PART 01     team staff columns
--   PART 02     tournaments, tournament scoping, cascade FKs
--   PART 03     sports catalogue, divisions, per-tournament sports, fixture scoring columns
--   PART 04     seed: Coal City Games Enugu 2026 + 18-sport catalogue
--   PART 05     athletes, fixture_entries, players, squads, realtime publication
--   PART 06     role split (app_admin/tournament_admin/user), members, invites, first RPCs
--   PART 07     tighten legacy write policies to app_admin
--   PART 08     tournament posts (news/articles)
--   PART 09     policy hardening, scale indexes, admin RPCs, is_app_admin()
--   PART 10     African/Nigerian catalogue expansion (39 sports) + atomic clock RPC
--   PART 11     athlete CRUD + fixture-entry RPCs
--   PART 12     FUTSAL + data-driven rules (per-fixture clock/vocab overrides,
--               vocabulary format CHECK so event types are not hardcoded)
--   PART 13     SCOPE AUTHORITY: duty tokens, can_write_fixture(), fixture_loggers
--               (one logger per stream), attribution, duty-scoped policies
--   PART 14     RECORDER RPCs: stats, score, clock, events, entries, rules,
--               catalogue editing — every write the live console performs
--
-- ROLES
--   app_admin         full control of the platform (users, sports catalogue, all tournaments)
--   tournament_admin  member of specific tournaments only; power comes from `duties`
--   user              public site only
--
-- DUTIES (public.tournament_members.duties — see PART 13 for the full grammar)
--   '*'         full manager of that tournament
--   'score'     scoreboard + clock + own stats and events
--   'clock'     clock/period control only
--   'posts'     news & articles
--   'roster'    teams, players, athletes
--   'entry'     fixture entries / results / medals
--   'stat:<key>'             one counter (e.g. stat:shots) — every fixture of the tournament
--   'event:<type>'           one timeline event type (e.g. event:goal)
--   'fixture:<uuid>'         everything, but only on that one fixture (match scout)
--   'stat:<key>@<fixture>'   one counter on one fixture
--   'event:<type>@<fixture>' one event type on one fixture
--
-- SECURITY MODEL
--   * RLS is enabled on every table; missing policy = no access.
--   * Reads are public for competition data; writes are app_admin or duty-scoped.
--   * The browser never writes live data tables directly — it calls the
--     SECURITY DEFINER RPCs in PART 14, which re-check scope and vocabulary in
--     Postgres, so a forged request cannot exceed the caller's duties.
--   * Scoped functions are SECURITY DEFINER with an explicit SET search_path.
-- ============================================================================

-- ============================================================================
-- PART 0 — base schema (roles, teams, fixtures, match_events, settings)
-- ============================================================================

-- ============================================================================
-- PART 0 — Base schema (idempotent)
-- ============================================================================
-- The original `schema.sql` + `schema_updates.sql`, merged and made
-- re-runnable: every CREATE is guarded and every policy is dropped by name
-- before it is recreated, so running this file twice is a no-op.
--
-- Later parts (01..14) evolve this base: they widen the CHECK constraints,
-- split the roles, and replace the write policies with duty-scoped ones. That
-- is intentional — the file reads top-to-bottom as the history of the schema,
-- and each part is individually idempotent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- user_roles — global application role (app_admin | tournament_admin | user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50),
    logo_url TEXT,
    coach VARCHAR(255),
    attire_color VARCHAR(100) DEFAULT 'Yet to be decided',
    roster TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Staff columns (schema_updates.sql).
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS medical_staff TEXT;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS tactical_coach VARCHAR(255);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS assistant_coach VARCHAR(255);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS kit_personnel TEXT;

-- Category / type columns (schema_updates.sql). These CHECKs are the narrow
-- originals; part 05 (§6c/§6d) drops and re-adds the wide lists.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Male'
    CHECK (category IN ('Male', 'Female'));
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS team_type VARCHAR(50) DEFAULT 'Football'
    CHECK (team_type IN ('Football', 'Futsal'));

-- ---------------------------------------------------------------------------
-- fixtures (matches)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fixtures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    home_team_id UUID NOT NULL REFERENCES public.teams(id),
    away_team_id UUID NOT NULL REFERENCES public.teams(id),
    match_date TIMESTAMP WITH TIME ZONE NOT NULL,
    venue VARCHAR(255),
    status VARCHAR(50) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'half_time', 'full_time', 'cancelled')),
    home_score INT DEFAULT 0,
    away_score INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- match_events (timeline: goals, cards, corners, subs, whistles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fixture_id UUID NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL
        CHECK (event_type IN ('goal', 'red_card', 'yellow_card', 'corner', 'free_kick',
                              'substitution', 'half_time_whistle', 'full_time_whistle', 'kick_off')),
    team_id UUID REFERENCES public.teams(id),
    player_id UUID,
    player_name VARCHAR(255),
    minute INT NOT NULL,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- tournament_settings (schema_updates.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    format VARCHAR(50) DEFAULT 'league'
        CHECK (format IN ('knockouts', 'league', 'group_to_knockout')),
    table_arrangement TEXT,
    rules TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- is_admin(): legacy global admin check.
-- Part 06 redefines this as "app_admin OR any tournament membership"; part 07
-- narrows the policies that used to lean on it. It stays defined here so the
-- base policies below can reference it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
    role_val VARCHAR;
BEGIN
    SELECT role INTO role_val FROM public.user_roles WHERE user_id = auth.uid();
    RETURN role_val = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- Base policies (dropped by name first so this file stays re-runnable).
-- Write policies here are the legacy global ones; parts 06-09 replace them
-- with app_admin / duty-scoped policies. Reads stay public throughout.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
CREATE POLICY "Users can view their own role" ON public.user_roles
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles
    FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view teams" ON public.teams;
CREATE POLICY "Anyone can view teams" ON public.teams FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert teams" ON public.teams;
CREATE POLICY "Admins can insert teams" ON public.teams
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update teams" ON public.teams;
CREATE POLICY "Admins can update teams" ON public.teams
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete teams" ON public.teams;
CREATE POLICY "Admins can delete teams" ON public.teams
    FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view fixtures" ON public.fixtures;
CREATE POLICY "Anyone can view fixtures" ON public.fixtures FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert fixtures" ON public.fixtures;
CREATE POLICY "Admins can insert fixtures" ON public.fixtures
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update fixtures" ON public.fixtures;
CREATE POLICY "Admins can update fixtures" ON public.fixtures
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete fixtures" ON public.fixtures;
CREATE POLICY "Admins can delete fixtures" ON public.fixtures
    FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view match events" ON public.match_events;
CREATE POLICY "Anyone can view match events" ON public.match_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert match events" ON public.match_events;
CREATE POLICY "Admins can insert match events" ON public.match_events
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update match events" ON public.match_events;
CREATE POLICY "Admins can update match events" ON public.match_events
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete match events" ON public.match_events;
CREATE POLICY "Admins can delete match events" ON public.match_events
    FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view tournament settings" ON public.tournament_settings;
CREATE POLICY "Anyone can view tournament settings" ON public.tournament_settings
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert tournament settings" ON public.tournament_settings;
CREATE POLICY "Admins can insert tournament settings" ON public.tournament_settings
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update tournament settings" ON public.tournament_settings;
CREATE POLICY "Admins can update tournament settings" ON public.tournament_settings
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete tournament settings" ON public.tournament_settings;
CREATE POLICY "Admins can delete tournament settings" ON public.tournament_settings
    FOR DELETE USING (public.is_admin());

-- Live-match columns (schema_updates.sql).
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS current_minute INT DEFAULT 0;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT
    '{"home": {"passes": 0, "shots": 0, "fouls": 0, "corners": 0}, "away": {"passes": 0, "shots": 0, "fouls": 0, "corners": 0}}'::jsonb;

-- ============================================================================
-- PART 01 — 01_add_team_details.sql
-- ============================================================================

-- Add new columns to the teams table for coach, attire color, and a simple roster list
ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS coach VARCHAR(255),
ADD COLUMN IF NOT EXISTS attire_color VARCHAR(100) DEFAULT 'Yet to be decided',
ADD COLUMN IF NOT EXISTS roster TEXT; -- We will use a TEXT field to store comma-separated player names for simplicity in this iteration

-- ============================================================================
-- PART 02 — 02_tournaments_core.sql
-- ============================================================================

-- ============================================================================
-- Migration 02 — Tournaments core (Phase 1, steps 1–3 + 5)
-- ============================================================================
-- Purpose:
--   * Create the `tournaments` table (one row per tournament edition).
--   * Scope existing rows to a tournament via nullable `tournament_id`
--     columns on `teams`, `fixtures`, and `match_events` (nullable so
--     existing data backfills without loss; a seed migration assigns rows
--     to the active tournament afterwards).
--   * Begin the `tournament_settings` → per-tournament conversion by adding
--     a nullable `tournament_id` (full upsert-by-tournament_id comes later).
--
-- FK DELETE-behavior decision (documented per review):
--   * fixtures.tournament_id      → ON DELETE CASCADE. A fixture belongs to
--     exactly one tournament; deleting the tournament removes its fixtures.
--   * match_events.tournament_id → ON DELETE CASCADE. Same reasoning: an
--     event belongs to one tournament (mirrors the existing
--     fixture_id → CASCADE rule).
--   * teams.tournament_id         → ON DELETE SET NULL. Teams are reusable
--     entities that may appear in several tournaments over time, so
--     deleting a tournament must NOT delete the team; the link is cleared.
--   * tournament_settings.tournament_id → ON DELETE CASCADE. Settings rows
--     are owned by their tournament (a tournament without settings falls
--     back to app defaults).
--
-- Single-active enforcement:
--   * Partial unique index `uq_tournaments_single_active` on the constant
--     expression (1) WHERE is_active IS TRUE — at most one row may be
--     active at any time (NULL/false rows are unaffected).
--
-- RLS / policy note:
--   * `tournaments` follows the existing convention: public SELECT, writes
--     gated on public.is_admin() (created in supabase/schema.sql).
--   * Tournament-scoped member roles (tournament_members + duties) arrive in
--     Phase 4; until then `tournament_settings` keeps its existing
--     global policies (anyone reads, admin writes) — no policy rewrite here.
--
-- Idempotency: every statement is safe to re-run. Tables use
--   CREATE TABLE IF NOT EXISTS, columns use ADD COLUMN IF NOT EXISTS,
--   indexes use CREATE [UNIQUE] INDEX IF NOT EXISTS, and policies /
--   constraints / FKs are added inside DO blocks guarded by catalog
--   lookups (pg_policies / pg_constraint).
--
-- Depends on: supabase/schema.sql (tables + public.is_admin()),
--   supabase/schema_updates.sql (tournament_settings table).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------------------------
-- tournaments table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournaments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    edition TEXT,
    venue_city TEXT,
    start_date DATE,
    end_date DATE,
    logo_url TEXT,
    status TEXT NOT NULL DEFAULT 'upcoming'
        CONSTRAINT tournaments_status_check
        CHECK (status IN ('upcoming', 'active', 'archived')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill the CHECK if the table pre-existed without it (e.g. created by an
-- older, non-conforming DDL statement with the same table name).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournaments'
          AND c.conname = 'tournaments_status_check'
    ) THEN
        ALTER TABLE public.tournaments
            ADD CONSTRAINT tournaments_status_check
            CHECK (status IN ('upcoming', 'active', 'archived'));
    END IF;
END
$$;

-- created_by → auth.users (nullable; author disappears → link cleared).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournaments'
          AND c.conname = 'fk_tournaments_created_by'
    ) THEN
        ALTER TABLE public.tournaments
            ADD CONSTRAINT fk_tournaments_created_by
            FOREIGN KEY (created_by)
            REFERENCES auth.users (id)
            ON DELETE SET NULL;
    END IF;
END
$$;

-- Enforce a single active tournament.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournaments_single_active
    ON public.tournaments ((1))
    WHERE is_active IS TRUE;

-- Helpful lookup indexes (slug already covered by its UNIQUE constraint).
CREATE INDEX IF NOT EXISTS idx_tournaments_status
    ON public.tournaments (status);
CREATE INDEX IF NOT EXISTS idx_tournaments_start_date
    ON public.tournaments (start_date);

-- --------------------------------------------------------------------------
-- RLS + policies on tournaments (public read; admin write via is_admin())
-- --------------------------------------------------------------------------
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tournaments'
          AND policyname = 'Anyone can view tournaments'
    ) THEN
        CREATE POLICY "Anyone can view tournaments"
            ON public.tournaments FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tournaments'
          AND policyname = 'Admins can insert tournaments'
    ) THEN
        CREATE POLICY "Admins can insert tournaments"
            ON public.tournaments FOR INSERT WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tournaments'
          AND policyname = 'Admins can update tournaments'
    ) THEN
        CREATE POLICY "Admins can update tournaments"
            ON public.tournaments FOR UPDATE USING (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tournaments'
          AND policyname = 'Admins can delete tournaments'
    ) THEN
        CREATE POLICY "Admins can delete tournaments"
            ON public.tournaments FOR DELETE USING (public.is_admin());
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- Scope existing tables to a tournament (nullable for backfill)
-- --------------------------------------------------------------------------
ALTER TABLE public.teams        ADD COLUMN IF NOT EXISTS tournament_id UUID;
ALTER TABLE public.fixtures     ADD COLUMN IF NOT EXISTS tournament_id UUID;
ALTER TABLE public.match_events ADD COLUMN IF NOT EXISTS tournament_id UUID;

-- teams.tournament_id → SET NULL (teams are reusable across tournaments).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'teams'
          AND c.conname = 'fk_teams_tournament_id'
    ) THEN
        ALTER TABLE public.teams
            ADD CONSTRAINT fk_teams_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE SET NULL;
    END IF;
END
$$;

-- fixtures.tournament_id → CASCADE (a fixture belongs to one tournament).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fk_fixtures_tournament_id'
    ) THEN
        ALTER TABLE public.fixtures
            ADD CONSTRAINT fk_fixtures_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;
END
$$;

-- match_events.tournament_id → CASCADE (mirrors the fixture_id CASCADE rule).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'match_events'
          AND c.conname = 'fk_match_events_tournament_id'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT fk_match_events_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_teams_tournament_id
    ON public.teams (tournament_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_tournament_id
    ON public.fixtures (tournament_id);
CREATE INDEX IF NOT EXISTS idx_match_events_tournament_id
    ON public.match_events (tournament_id);

-- --------------------------------------------------------------------------
-- tournament_settings → per-tournament (first step of Phase 1, step 5)
-- --------------------------------------------------------------------------
-- Adds nullable `tournament_id`: existing singleton rows keep NULL (allowed
-- multiple times — Postgres UNIQUE ignores NULLs) until the seed/backfill
-- assigns them; all new rows must carry their tournament_id. The follow-up
-- work (upsert by tournament_id, singleton removal) is a later migration.
-- Existing global policies are intentionally untouched here; per-tournament
-- member-scoped write policies arrive with Phase 4 roles.
ALTER TABLE public.tournament_settings ADD COLUMN IF NOT EXISTS tournament_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_settings'
          AND c.conname = 'fk_tournament_settings_tournament_id'
    ) THEN
        ALTER TABLE public.tournament_settings
            ADD CONSTRAINT fk_tournament_settings_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;
END
$$;

-- One settings row per tournament (NULL legacy rows exempt — UNIQUE skips NULLs).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_settings_tournament_id
    ON public.tournament_settings (tournament_id);

-- ============================================================================
-- PART 03 — 03_sports_catalog.sql
-- ============================================================================

-- ============================================================================
-- Migration 03 — Sports catalog, divisions, per-tournament picker (Phase 2)
-- ============================================================================
-- Purpose:
--   * Global `sports` catalog: one row per game (football, athletics, …)
--     with its scoring_type and JSONB vocab/config payloads.
--   * `sport_divisions`: named subdivisions of a sport (e.g. Para Athletics
--     is a division of Athletics, Wheelchair Basketball 3x3 of Basketball).
--   * `tournament_sports`: per-tournament game picker (which sports a given
--     tournament edition runs).
--   * Sport linkage on `fixtures` (sport_id, division_id, scoring_type,
--     result_data, current_round/leg/set) and `teams` (sport_id).
--
-- Scoring types: 'duel' (head-to-head, e.g. football), 'sets' (tennis,
--   badminton, volleyball), 'bouts' (boxing, wrestling, judo), 'race'
--   (athletics track, swimming, canoeing — lanes/heats), 'attempts'
--   (field events, powerlifting, weightlifting).
--
-- DELETE-behavior decisions:
--   * sport_divisions.sport_id        → ON DELETE CASCADE (divisions are
--     owned by their sport).
--   * tournament_sports (both FKs)   → ON DELETE CASCADE (picker rows are
--     pure links; removing a tournament or a sport removes its links).
--   * fixtures.sport_id/division_id  → ON DELETE SET NULL (a fixture keeps
--     existing if its catalog entry is removed; app re-links it).
--   * teams.sport_id                 → ON DELETE SET NULL (same reasoning —
--     teams must never disappear because a catalog row was deleted).
--
-- Integrity notes (enforced at app level, not by DB constraint):
--   * fixtures.division_id should belong to fixtures.sport_id's sport; no
--     cross-column FK is expressible declaratively, so the admin fixture
--     form (Phase 5) must only offer divisions of the chosen sport.
--   * fixtures.scoring_type should normally mirror sports.scoring_type;
--     it is denormalized (nullable) so legacy football rows keep working
--     before backfill, and so a fixture can pin its rules even if the
--     catalog entry later changes.
--
-- RLS: new tables follow the existing convention — public SELECT, writes
--   gated on public.is_admin() (created in supabase/schema.sql).
--   Duty-scoped tournament-member writes arrive in Phase 4.
--
-- Deferred (NOT in this migration, per plan):
--   * Widening of teams.team_type / teams.category CHECKs (Phase 2.4 /
--     Phase 3 parity work) — needs a coordinated code + data change.
--   * Seeding the 18 ccgames2026 sports with full scoring detail — a
--     separate seed migration (Phase 2.5).
--
-- Idempotency: every statement is safe to re-run. Tables use
--   CREATE TABLE IF NOT EXISTS, columns use ADD COLUMN IF NOT EXISTS,
--   indexes use CREATE [UNIQUE] INDEX IF NOT EXISTS, and policies /
--   constraints / FKs are added inside DO blocks guarded by catalog
--   lookups (pg_policies / pg_constraint).
--
-- Depends on: supabase/schema.sql (is_admin, teams, fixtures),
--   02_tournaments_core.sql (tournaments table).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------------------------
-- sports — global catalog
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    scoring_type TEXT NOT NULL
        CONSTRAINT sports_scoring_type_check
        CHECK (scoring_type IN ('duel', 'sets', 'bouts', 'race', 'attempts')),
    stat_vocab JSONB DEFAULT '[]'::jsonb,
    event_vocab JSONB DEFAULT '[]'::jsonb,
    scoring_config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill the CHECK if the table pre-existed without it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'sports'
          AND c.conname = 'sports_scoring_type_check'
    ) THEN
        ALTER TABLE public.sports
            ADD CONSTRAINT sports_scoring_type_check
            CHECK (scoring_type IN ('duel', 'sets', 'bouts', 'race', 'attempts'));
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- sport_divisions — named subdivisions of a sport
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sport_divisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sport_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sport_divisions_sport_name UNIQUE (sport_id, name)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'sport_divisions'
          AND c.conname = 'fk_sport_divisions_sport_id'
    ) THEN
        ALTER TABLE public.sport_divisions
            ADD CONSTRAINT fk_sport_divisions_sport_id
            FOREIGN KEY (sport_id)
            REFERENCES public.sports (id)
            ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sport_divisions_sport_id
    ON public.sport_divisions (sport_id);

-- --------------------------------------------------------------------------
-- tournament_sports — per-tournament game picker
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_sports (
    tournament_id UUID NOT NULL,
    sport_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_tournament_sports PRIMARY KEY (tournament_id, sport_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_sports'
          AND c.conname = 'fk_tournament_sports_tournament_id'
    ) THEN
        ALTER TABLE public.tournament_sports
            ADD CONSTRAINT fk_tournament_sports_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_sports'
          AND c.conname = 'fk_tournament_sports_sport_id'
    ) THEN
        ALTER TABLE public.tournament_sports
            ADD CONSTRAINT fk_tournament_sports_sport_id
            FOREIGN KEY (sport_id)
            REFERENCES public.sports (id)
            ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_tournament_sports_sport_id
    ON public.tournament_sports (sport_id);

-- --------------------------------------------------------------------------
-- RLS + policies (public read; admin write via is_admin())
-- --------------------------------------------------------------------------
ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_sports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- sports
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sports'
          AND policyname = 'Anyone can view sports'
    ) THEN
        CREATE POLICY "Anyone can view sports"
            ON public.sports FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sports'
          AND policyname = 'Admins can insert sports'
    ) THEN
        CREATE POLICY "Admins can insert sports"
            ON public.sports FOR INSERT WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sports'
          AND policyname = 'Admins can update sports'
    ) THEN
        CREATE POLICY "Admins can update sports"
            ON public.sports FOR UPDATE USING (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sports'
          AND policyname = 'Admins can delete sports'
    ) THEN
        CREATE POLICY "Admins can delete sports"
            ON public.sports FOR DELETE USING (public.is_admin());
    END IF;

    -- sport_divisions
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sport_divisions'
          AND policyname = 'Anyone can view sport divisions'
    ) THEN
        CREATE POLICY "Anyone can view sport divisions"
            ON public.sport_divisions FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sport_divisions'
          AND policyname = 'Admins can insert sport divisions'
    ) THEN
        CREATE POLICY "Admins can insert sport divisions"
            ON public.sport_divisions FOR INSERT WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sport_divisions'
          AND policyname = 'Admins can update sport divisions'
    ) THEN
        CREATE POLICY "Admins can update sport divisions"
            ON public.sport_divisions FOR UPDATE USING (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sport_divisions'
          AND policyname = 'Admins can delete sport divisions'
    ) THEN
        CREATE POLICY "Admins can delete sport divisions"
            ON public.sport_divisions FOR DELETE USING (public.is_admin());
    END IF;

    -- tournament_sports
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_sports'
          AND policyname = 'Anyone can view tournament sports'
    ) THEN
        CREATE POLICY "Anyone can view tournament sports"
            ON public.tournament_sports FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_sports'
          AND policyname = 'Admins can insert tournament sports'
    ) THEN
        CREATE POLICY "Admins can insert tournament sports"
            ON public.tournament_sports FOR INSERT WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_sports'
          AND policyname = 'Admins can update tournament sports'
    ) THEN
        CREATE POLICY "Admins can update tournament sports"
            ON public.tournament_sports FOR UPDATE USING (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_sports'
          AND policyname = 'Admins can delete tournament sports'
    ) THEN
        CREATE POLICY "Admins can delete tournament sports"
            ON public.tournament_sports FOR DELETE USING (public.is_admin());
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- fixtures — sport linkage + generic scoring state
-- --------------------------------------------------------------------------
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS sport_id UUID;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS division_id UUID;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS scoring_type TEXT;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS result_data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 0;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS current_leg INTEGER DEFAULT 0;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS current_set INTEGER DEFAULT 0;

-- Nullable denormalized scoring_type: NULL = legacy/unset (treated as duel
-- by the app until backfilled); any non-NULL value must be a known type.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fixtures_scoring_type_check'
    ) THEN
        ALTER TABLE public.fixtures
            ADD CONSTRAINT fixtures_scoring_type_check
            CHECK (scoring_type IN ('duel', 'sets', 'bouts', 'race', 'attempts'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fk_fixtures_sport_id'
    ) THEN
        ALTER TABLE public.fixtures
            ADD CONSTRAINT fk_fixtures_sport_id
            FOREIGN KEY (sport_id)
            REFERENCES public.sports (id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fk_fixtures_division_id'
    ) THEN
        ALTER TABLE public.fixtures
            ADD CONSTRAINT fk_fixtures_division_id
            FOREIGN KEY (division_id)
            REFERENCES public.sport_divisions (id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_fixtures_sport_id
    ON public.fixtures (sport_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_division_id
    ON public.fixtures (division_id);

-- --------------------------------------------------------------------------
-- teams — sport linkage
-- --------------------------------------------------------------------------
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS sport_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'teams'
          AND c.conname = 'fk_teams_sport_id'
    ) THEN
        ALTER TABLE public.teams
            ADD CONSTRAINT fk_teams_sport_id
            FOREIGN KEY (sport_id)
            REFERENCES public.sports (id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_teams_sport_id
    ON public.teams (sport_id);

-- ============================================================================
-- PART 04 — 04_seed_ccgames2026.sql
-- ============================================================================

-- ============================================================================
-- Migration 04 — Seed Coal City Games 2026 + 18-sport catalog (Phases 1–2)
-- ============================================================================
-- Purpose:
--   * Seed the `tournaments` row for The 23rd National Sports Festival —
--     Coal City Games Enugu 2026 (`ccgames2026`), 2026-11-27 → 2026-12-11,
--     status `upcoming`, active (single-active partial unique index holds
--     because every other tournament is deactivated first).
--   * Seed the 18-sport global `sports` catalog with full scoring detail
--     (stat_vocab / event_vocab / scoring_config per sport).
--   * Seed the 6 para `sport_divisions` (one per parent sport).
--   * Enable all 18 sports for ccgames2026 in `tournament_sports`.
--   * Backfill `tournament_id` of legacy teams/fixtures/match_events rows
--     (where NULL) to ccgames2026; default legacy fixtures to football's
--     `sport_id` where NULL; insert a per-tournament `tournament_settings`
--     row for ccgames2026 if none exists.
--
-- Idempotency: every statement is safe to re-run. Tournament upsert uses
--   INSERT ... ON CONFLICT (slug) DO UPDATE; sports use
--   ON CONFLICT (code) DO UPDATE; divisions use INSERT ... WHERE NOT EXISTS;
--   tournament_sports uses ON CONFLICT DO NOTHING; backfills are
--   WHERE-NULL guarded UPDATEs; settings insert is WHERE-NOT-EXISTS guarded.
--
-- Depends on: 02_tournaments_core.sql (tournaments + tournament_id scoping +
--   uq_tournaments_single_active + tournament_settings.tournament_id),
--   03_sports_catalog.sql (sports, sport_divisions, tournament_sports,
--   fixtures.sport_id, teams.sport_id).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------------------------
-- 1. Seed tournament: deactivate others first so the partial unique index
--    (at most one is_active row) can never be violated by the upsert below.
-- --------------------------------------------------------------------------
UPDATE public.tournaments
SET is_active = FALSE, updated_at = NOW()
WHERE slug <> 'ccgames2026'
  AND is_active IS TRUE;

INSERT INTO public.tournaments
    (name, slug, edition, venue_city, start_date, end_date, status, is_active)
VALUES
    ('Coal City Games 2026',
     'ccgames2026',
     'The 23rd National Sports Festival — Coal City Games Enugu 2026',
     'Enugu',
     '2026-11-27',
     '2026-12-11',
     'upcoming',
     TRUE)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    edition = EXCLUDED.edition,
    venue_city = EXCLUDED.venue_city,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    status = EXCLUDED.status,
    is_active = TRUE,
    updated_at = NOW();

-- --------------------------------------------------------------------------
-- 2. Seed the 18-sport global catalog.
--    stat_vocab: JSON array of {key,label}; event_vocab: JSON string array
--    (always includes point/foul/injury/disqualification + scoring-specific
--    tokens); scoring_config: JSON object with the sport's pinned rules.
-- --------------------------------------------------------------------------
INSERT INTO public.sports (code, name, scoring_type, stat_vocab, event_vocab, scoring_config)
VALUES
-- (1) athletics — race
('athletics', 'Athletics', 'race',
 '[{"key":"attempts","label":"Attempts"},{"key":"fouls","label":"Fouls"},{"key":"heats_won","label":"Heats Won"},{"key":"wins","label":"Wins"},{"key":"personal_bests","label":"Personal Bests"}]'::jsonb,
 '["point","foul","injury","disqualification","time_record","distance_record","false_start","heat_win"]'::jsonb,
 '{"timed":true,"heats":true,"lanes":8}'::jsonb),
-- (2) badminton — sets
('badminton', 'Badminton', 'sets',
 '[{"key":"points","label":"Points"},{"key":"sets_won","label":"Sets Won"},{"key":"aces","label":"Aces"},{"key":"faults","label":"Faults"},{"key":"rallies_won","label":"Rallies Won"}]'::jsonb,
 '["point","set_win","foul","injury","disqualification"]'::jsonb,
 '{"sets_to_win":2,"points_per_set":21}'::jsonb),
-- (3) basketball — 3x3 duel
('basketball', 'Basketball', 'duel',
 '[{"key":"points","label":"Points"},{"key":"rebounds","label":"Rebounds"},{"key":"assists","label":"Assists"},{"key":"steals","label":"Steals"},{"key":"blocks","label":"Blocks"},{"key":"fouls","label":"Fouls"}]'::jsonb,
 '["point","foul","injury","disqualification"]'::jsonb,
 '{"format":"3x3","target_score":21,"shot_clock_seconds":12}'::jsonb),
-- (4) boxing — bouts
('boxing', 'Boxing', 'bouts',
 '[{"key":"punches_landed","label":"Punches Landed"},{"key":"knockdowns","label":"Knockdowns"},{"key":"rounds_won","label":"Rounds Won"},{"key":"blocks","label":"Blocks"},{"key":"fouls","label":"Fouls"}]'::jsonb,
 '["point","round_win","foul","injury","disqualification"]'::jsonb,
 '{"rounds":3,"round_minutes":3}'::jsonb),
-- (5) canoeing — race
('canoeing', 'Canoeing', 'race',
 '[{"key":"heats_won","label":"Heats Won"},{"key":"attempts","label":"Attempts"},{"key":"fouls","label":"Fouls"},{"key":"wins","label":"Wins"}]'::jsonb,
 '["point","foul","injury","disqualification","time_record","heat_win"]'::jsonb,
 '{"lanes":8,"distances_m":[200,500,1000]}'::jsonb),
-- (6) cricket — duel
('cricket', 'Cricket', 'duel',
 '[{"key":"runs","label":"Runs"},{"key":"wickets","label":"Wickets"},{"key":"fours","label":"Fours"},{"key":"sixes","label":"Sixes"},{"key":"catches","label":"Catches"},{"key":"maiden_overs","label":"Maiden Overs"}]'::jsonb,
 '["point","wicket","foul","injury","disqualification"]'::jsonb,
 '{"overs_limit":20,"wickets":10}'::jsonb),
-- (7) cycling — race
('cycling', 'Cycling', 'race',
 '[{"key":"heats_won","label":"Heats Won"},{"key":"attempts","label":"Attempts"},{"key":"fouls","label":"Fouls"},{"key":"stage_wins","label":"Stage Wins"}]'::jsonb,
 '["point","foul","injury","disqualification","time_record","heat_win"]'::jsonb,
 '{"road":true,"track":true}'::jsonb),
-- (8) darts — duel (legs)
('darts', 'Darts', 'duel',
 '[{"key":"legs_won","label":"Legs Won"},{"key":"tons_180","label":"180s"},{"key":"checkout_avg","label":"Checkout Avg"},{"key":"darts_thrown","label":"Darts Thrown"}]'::jsonb,
 '["point","foul","injury","disqualification"]'::jsonb,
 '{"legs_to_win":3,"starting_score":501}'::jsonb),
-- (9) football — duel (canonical 12-key vocab)
('football', 'Football', 'duel',
 '[{"key":"passes","label":"Passes"},{"key":"shots","label":"Shots"},{"key":"shots_on_target","label":"Shots On Target"},{"key":"shots_off_target","label":"Shots Off Target"},{"key":"fouls","label":"Fouls"},{"key":"corners","label":"Corners"},{"key":"freekicks","label":"Freekicks"},{"key":"offsides","label":"Offsides"},{"key":"yellow_cards","label":"Yellow Cards"},{"key":"red_cards","label":"Red Cards"},{"key":"gk_saves","label":"GK Saves"},{"key":"interceptions","label":"Interceptions"}]'::jsonb,
 '["goal","point","foul","injury","disqualification","corner","free_kick","yellow_card","red_card","substitution","half_time_whistle","full_time_whistle","kick_off"]'::jsonb,
 '{"halves":2,"half_minutes":45,"extra_time_minutes":30}'::jsonb),
-- (10) gymnastics — attempts
('gymnastics', 'Gymnastics', 'attempts',
 '[{"key":"attempts","label":"Attempts"},{"key":"falls","label":"Falls"},{"key":"perfect_scores","label":"Perfect Scores"},{"key":"difficulty_bonus","label":"Difficulty Bonus"},{"key":"execution_score","label":"Execution Score"}]'::jsonb,
 '["point","attempt","foul","injury","disqualification"]'::jsonb,
 '{"apparatus":["floor","pommel","rings","vault","parallel_bars","horizontal_bar"]}'::jsonb),
-- (11) judo — bouts
('judo', 'Judo', 'bouts',
 '[{"key":"ippons","label":"Ippons"},{"key":"waza_ari","label":"Waza-ari"},{"key":"throws","label":"Throws"},{"key":"holds","label":"Holds"},{"key":"penalties","label":"Penalties"}]'::jsonb,
 '["point","round_win","foul","injury","disqualification"]'::jsonb,
 '{"bout_minutes":4,"golden_score":true}'::jsonb),
-- (12) mma — bouts
('mma', 'Mixed Martial Arts', 'bouts',
 '[{"key":"strikes_landed","label":"Strikes Landed"},{"key":"takedowns","label":"Takedowns"},{"key":"knockdowns","label":"Knockdowns"},{"key":"submissions","label":"Submissions"},{"key":"rounds_won","label":"Rounds Won"}]'::jsonb,
 '["point","round_win","foul","injury","disqualification"]'::jsonb,
 '{"rounds":3,"round_minutes":5}'::jsonb),
-- (13) swimming — race
('swimming', 'Swimming', 'race',
 '[{"key":"heats_won","label":"Heats Won"},{"key":"attempts","label":"Attempts"},{"key":"fouls","label":"Fouls"},{"key":"personal_bests","label":"Personal Bests"},{"key":"wins","label":"Wins"}]'::jsonb,
 '["point","foul","injury","disqualification","time_record","false_start","heat_win"]'::jsonb,
 '{"pool_m":50,"strokes":["freestyle","backstroke","breaststroke","butterfly","medley"]}'::jsonb),
-- (14) table_tennis — sets
('table_tennis', 'Table Tennis', 'sets',
 '[{"key":"points","label":"Points"},{"key":"sets_won","label":"Sets Won"},{"key":"aces","label":"Aces"},{"key":"faults","label":"Faults"},{"key":"rallies_won","label":"Rallies Won"}]'::jsonb,
 '["point","set_win","foul","injury","disqualification"]'::jsonb,
 '{"sets_to_win":4,"points_per_set":11}'::jsonb),
-- (15) taekwondo — bouts
('taekwondo', 'Taekwondo', 'bouts',
 '[{"key":"kicks_landed","label":"Kicks Landed"},{"key":"head_kicks","label":"Head Kicks"},{"key":"rounds_won","label":"Rounds Won"},{"key":"knockdowns","label":"Knockdowns"},{"key":"penalties","label":"Penalties"}]'::jsonb,
 '["point","round_win","foul","injury","disqualification"]'::jsonb,
 '{"rounds":3,"round_minutes":2}'::jsonb),
-- (16) tennis — sets
('tennis', 'Tennis', 'sets',
 '[{"key":"points","label":"Points"},{"key":"games_won","label":"Games Won"},{"key":"sets_won","label":"Sets Won"},{"key":"aces","label":"Aces"},{"key":"double_faults","label":"Double Faults"},{"key":"breaks","label":"Breaks"}]'::jsonb,
 '["point","set_win","foul","injury","disqualification"]'::jsonb,
 '{"sets_to_win":2,"games_per_set":6}'::jsonb),
-- (17) weightlifting — attempts (3 attempts per lift)
('weightlifting', 'Weightlifting & Para Powerlifting', 'attempts',
 '[{"key":"attempts","label":"Attempts"},{"key":"successful_lifts","label":"Successful Lifts"},{"key":"fouls","label":"Fouls"},{"key":"personal_bests","label":"Personal Bests"},{"key":"total_kg","label":"Total (kg)"}]'::jsonb,
 '["point","attempt","foul","injury","disqualification"]'::jsonb,
 '{"attempts_per_lift":3,"lifts":["snatch","clean_and_jerk"]}'::jsonb),
-- (18) wrestling — bouts
('wrestling', 'Wrestling', 'bouts',
 '[{"key":"takedowns","label":"Takedowns"},{"key":"pins","label":"Pins"},{"key":"reversals","label":"Reversals"},{"key":"rounds_won","label":"Rounds Won"},{"key":"penalties","label":"Penalties"}]'::jsonb,
 '["point","round_win","foul","injury","disqualification"]'::jsonb,
 '{"periods":2,"period_minutes":3}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    scoring_type = EXCLUDED.scoring_type,
    stat_vocab = EXCLUDED.stat_vocab,
    event_vocab = EXCLUDED.event_vocab,
    scoring_config = EXCLUDED.scoring_config,
    updated_at = NOW();

-- --------------------------------------------------------------------------
-- 3. Para divisions (per sport code + division name; no-op when present).
-- --------------------------------------------------------------------------
INSERT INTO public.sport_divisions (sport_id, name)
SELECT s.id, 'Para Athletics'
FROM public.sports s WHERE s.code = 'athletics'
  AND NOT EXISTS (SELECT 1 FROM public.sport_divisions d
                  WHERE d.sport_id = s.id AND d.name = 'Para Athletics');

INSERT INTO public.sport_divisions (sport_id, name)
SELECT s.id, 'Para Badminton'
FROM public.sports s WHERE s.code = 'badminton'
  AND NOT EXISTS (SELECT 1 FROM public.sport_divisions d
                  WHERE d.sport_id = s.id AND d.name = 'Para Badminton');

INSERT INTO public.sport_divisions (sport_id, name)
SELECT s.id, 'Wheelchair Basketball (3x3)'
FROM public.sports s WHERE s.code = 'basketball'
  AND NOT EXISTS (SELECT 1 FROM public.sport_divisions d
                  WHERE d.sport_id = s.id AND d.name = 'Wheelchair Basketball (3x3)');

INSERT INTO public.sport_divisions (sport_id, name)
SELECT s.id, 'Para Canoeing'
FROM public.sports s WHERE s.code = 'canoeing'
  AND NOT EXISTS (SELECT 1 FROM public.sport_divisions d
                  WHERE d.sport_id = s.id AND d.name = 'Para Canoeing');

INSERT INTO public.sport_divisions (sport_id, name)
SELECT s.id, 'Para Table Tennis'
FROM public.sports s WHERE s.code = 'table_tennis'
  AND NOT EXISTS (SELECT 1 FROM public.sport_divisions d
                  WHERE d.sport_id = s.id AND d.name = 'Para Table Tennis');

INSERT INTO public.sport_divisions (sport_id, name)
SELECT s.id, 'Para Powerlifting'
FROM public.sports s WHERE s.code = 'weightlifting'
  AND NOT EXISTS (SELECT 1 FROM public.sport_divisions d
                  WHERE d.sport_id = s.id AND d.name = 'Para Powerlifting');

-- --------------------------------------------------------------------------
-- 4. Enable all 18 sports for ccgames2026 (no-op when already linked).
-- --------------------------------------------------------------------------
INSERT INTO public.tournament_sports (tournament_id, sport_id)
SELECT t.id, s.id
FROM public.tournaments t
CROSS JOIN public.sports s
WHERE t.slug = 'ccgames2026'
  AND s.code IN (
    'athletics', 'badminton', 'basketball', 'boxing',
    'canoeing', 'cricket', 'cycling', 'darts',
    'football', 'gymnastics', 'judo', 'mma',
    'swimming', 'table_tennis', 'taekwondo', 'tennis',
    'weightlifting', 'wrestling'
  )
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------------
-- 5. Backfill legacy rows (tournament_id NULL → ccgames2026; legacy
--    fixtures are football, so default their sport_id where NULL).
-- --------------------------------------------------------------------------
UPDATE public.teams
SET tournament_id = (SELECT id FROM public.tournaments WHERE slug = 'ccgames2026')
WHERE tournament_id IS NULL;

UPDATE public.fixtures
SET tournament_id = (SELECT id FROM public.tournaments WHERE slug = 'ccgames2026')
WHERE tournament_id IS NULL;

UPDATE public.match_events
SET tournament_id = (SELECT id FROM public.tournaments WHERE slug = 'ccgames2026')
WHERE tournament_id IS NULL;

UPDATE public.fixtures
SET sport_id = (SELECT id FROM public.sports WHERE code = 'football')
WHERE sport_id IS NULL
  AND tournament_id = (SELECT id FROM public.tournaments WHERE slug = 'ccgames2026');

-- --------------------------------------------------------------------------
-- 6. Per-tournament settings row for ccgames2026 (singleton legacy rows
--    with NULL tournament_id are left untouched).
-- --------------------------------------------------------------------------
INSERT INTO public.tournament_settings (tournament_id, format, rules)
SELECT t.id,
       'group_to_knockout',
       'Coal City Games 2026 — group stage followed by knockout rounds. Teams earn 3 points for a win and 1 for a draw; group ties break on goal difference, then goals scored, then head-to-head.'
FROM public.tournaments t
WHERE t.slug = 'ccgames2026'
  AND NOT EXISTS (SELECT 1 FROM public.tournament_settings ts
                  WHERE ts.tournament_id = t.id);

-- ============================================================================
-- PART 05 — 05_athletes_entries_players.sql
-- ============================================================================

-- ============================================================================
-- Migration 05 — Athletes, entries, players + schema parity (Phase 3)
-- ============================================================================
-- Purpose:
--   * `athletes` table (individual-sport competitors with optional team
--     affiliation and sport link).
--   * `fixture_entries` table (multi-competitor lanes/positions with result
--     JSONB, rank, medal) — medals tally derives from these rows.
--   * `players` table (team-sport squads) + match_events.player_id /
--     assist_player_id FKs.
--   * Parity columns used by app code: fixtures.stage/home_xg/away_xg/
--     home_clean_sheet/away_clean_sheet/home_goalkeeper_id/
--     away_goalkeeper_id; teams.group_name (+ logo_url guard).
--   * Widen CHECKs: fixtures.status (+paused, +extra_time),
--     match_events.event_type (superset incl. injury/water_break + generic
--     scoring tokens), teams.category (+mixed, +open), teams.team_type
--     (multi-sport list).
--   * RLS (public SELECT; admin writes) on the three new tables.
--   * Realtime publication + REPLICA IDENTITY FULL for fixtures,
--     match_events, fixture_entries.
--   * `logos` storage bucket + policies.
--   * Seed helper: CSV teams.roster → players rows (one INSERT...SELECT).
--
-- Idempotency: every statement is safe to re-run. Tables use
--   CREATE TABLE IF NOT EXISTS, columns use ADD COLUMN IF NOT EXISTS,
--   indexes use CREATE INDEX IF NOT EXISTS, and policies / constraints /
--   FKs / publication members are added inside DO blocks guarded by catalog
--   lookups (pg_policies / pg_constraint) or exception handlers
--   (duplicate_object / undefined_object).
--
-- Depends on: supabase/schema.sql (is_admin, teams, fixtures, match_events),
--   02_tournaments_core.sql (tournaments), 03_sports_catalog.sql (sports),
--   04_seed_ccgames2026.sql (seed rows this migration backfills against).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------------------------
-- 1. athletes — individual-sport competitors
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athletes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL,
    name TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'mixed'
        CONSTRAINT athletes_gender_check
        CHECK (gender IN ('male', 'female', 'mixed')),
    classification TEXT,
    team_id UUID,
    sport_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill the gender CHECK if the table pre-existed without it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'athletes'
          AND c.conname = 'athletes_gender_check'
    ) THEN
        ALTER TABLE public.athletes
            ADD CONSTRAINT athletes_gender_check
            CHECK (gender IN ('male', 'female', 'mixed'));
    END IF;
END
$$;

-- FKs (guarded; re-runnable).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'athletes'
          AND c.conname = 'fk_athletes_tournament_id'
    ) THEN
        ALTER TABLE public.athletes
            ADD CONSTRAINT fk_athletes_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'athletes'
          AND c.conname = 'fk_athletes_team_id'
    ) THEN
        ALTER TABLE public.athletes
            ADD CONSTRAINT fk_athletes_team_id
            FOREIGN KEY (team_id)
            REFERENCES public.teams (id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'athletes'
          AND c.conname = 'fk_athletes_sport_id'
    ) THEN
        ALTER TABLE public.athletes
            ADD CONSTRAINT fk_athletes_sport_id
            FOREIGN KEY (sport_id)
            REFERENCES public.sports (id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_athletes_tournament_sport
    ON public.athletes (tournament_id, sport_id);
CREATE INDEX IF NOT EXISTS idx_athletes_team_id
    ON public.athletes (team_id);

-- --------------------------------------------------------------------------
-- 2. fixture_entries — multi-competitor lanes/positions, results, medals
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fixture_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fixture_id UUID NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    lane TEXT,
    athlete_id UUID,
    team_id UUID,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    rank INTEGER,
    medal TEXT
        CONSTRAINT fixture_entries_medal_check
        CHECK (medal IN ('gold', 'silver', 'bronze')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fixture_entries_athlete_or_team_check
        CHECK (athlete_id IS NOT NULL OR team_id IS NOT NULL)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixture_entries'
          AND c.conname = 'fk_fixture_entries_fixture_id'
    ) THEN
        ALTER TABLE public.fixture_entries
            ADD CONSTRAINT fk_fixture_entries_fixture_id
            FOREIGN KEY (fixture_id)
            REFERENCES public.fixtures (id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixture_entries'
          AND c.conname = 'fk_fixture_entries_athlete_id'
    ) THEN
        ALTER TABLE public.fixture_entries
            ADD CONSTRAINT fk_fixture_entries_athlete_id
            FOREIGN KEY (athlete_id)
            REFERENCES public.athletes (id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixture_entries'
          AND c.conname = 'fk_fixture_entries_team_id'
    ) THEN
        ALTER TABLE public.fixture_entries
            ADD CONSTRAINT fk_fixture_entries_team_id
            FOREIGN KEY (team_id)
            REFERENCES public.teams (id)
            ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_fixture_entries_fixture_id
    ON public.fixture_entries (fixture_id);

-- --------------------------------------------------------------------------
-- 3. players — team-sport squads
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL,
    team_id UUID NOT NULL,
    name TEXT NOT NULL,
    position TEXT,
    jersey_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'players'
          AND c.conname = 'fk_players_tournament_id'
    ) THEN
        ALTER TABLE public.players
            ADD CONSTRAINT fk_players_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'players'
          AND c.conname = 'fk_players_team_id'
    ) THEN
        ALTER TABLE public.players
            ADD CONSTRAINT fk_players_team_id
            FOREIGN KEY (team_id)
            REFERENCES public.teams (id)
            ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_players_team_id
    ON public.players (team_id);
CREATE INDEX IF NOT EXISTS idx_players_tournament_id
    ON public.players (tournament_id);

-- --------------------------------------------------------------------------
-- 4. match_events: player_id / assist_player_id FKs to players.
--    NOTE: match_events.player_id already exists as UUID (schema.sql); the
--    ADD COLUMN is a guarded no-op, the FK is what this section adds.
-- --------------------------------------------------------------------------
ALTER TABLE public.match_events ADD COLUMN IF NOT EXISTS player_id UUID;
ALTER TABLE public.match_events ADD COLUMN IF NOT EXISTS assist_player_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'match_events'
          AND c.conname = 'fk_match_events_player_id'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT fk_match_events_player_id
            FOREIGN KEY (player_id)
            REFERENCES public.players (id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'match_events'
          AND c.conname = 'fk_match_events_assist_player_id'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT fk_match_events_assist_player_id
            FOREIGN KEY (assist_player_id)
            REFERENCES public.players (id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_match_events_player_id
    ON public.match_events (player_id);
CREATE INDEX IF NOT EXISTS idx_match_events_assist_player_id
    ON public.match_events (assist_player_id);

-- --------------------------------------------------------------------------
-- 5. Fixtures / teams parity columns used by app code.
-- --------------------------------------------------------------------------
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS home_xg DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS away_xg DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS home_clean_sheet BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS away_clean_sheet BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS home_goalkeeper_id UUID;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS away_goalkeeper_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fk_fixtures_home_goalkeeper_id'
    ) THEN
        ALTER TABLE public.fixtures
            ADD CONSTRAINT fk_fixtures_home_goalkeeper_id
            FOREIGN KEY (home_goalkeeper_id)
            REFERENCES public.players (id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fk_fixtures_away_goalkeeper_id'
    ) THEN
        ALTER TABLE public.fixtures
            ADD CONSTRAINT fk_fixtures_away_goalkeeper_id
            FOREIGN KEY (away_goalkeeper_id)
            REFERENCES public.players (id)
            ON DELETE SET NULL;
    END IF;
END
$$;

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS group_name TEXT;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- --------------------------------------------------------------------------
-- 6. Widen CHECK constraints (drop-by-name if present, re-add superset).
-- --------------------------------------------------------------------------

-- 6a. fixtures.status: + 'paused', + 'extra_time' (7 values total).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fixtures_status_check'
    ) THEN
        ALTER TABLE public.fixtures DROP CONSTRAINT fixtures_status_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'fixtures'
          AND c.conname = 'fixtures_status_check'
    ) THEN
        ALTER TABLE public.fixtures
            ADD CONSTRAINT fixtures_status_check
            CHECK (status IN ('scheduled', 'in_progress', 'half_time', 'paused',
                              'extra_time', 'full_time', 'cancelled'));
    END IF;
END
$$;

-- 6b. match_events.event_type: superset (football vocab + injury/water_break
--     actually written by the UI + generic multi-sport scoring tokens).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'match_events'
          AND c.conname = 'match_events_event_type_check'
    ) THEN
        ALTER TABLE public.match_events DROP CONSTRAINT match_events_event_type_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'match_events'
          AND c.conname = 'match_events_event_type_check'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT match_events_event_type_check
            CHECK (event_type IN (
                'goal', 'point', 'set_win', 'round_win', 'wicket', 'attempt',
                'time_record', 'distance_record', 'foul', 'false_start',
                'red_card', 'yellow_card', 'corner', 'free_kick',
                'substitution', 'injury', 'water_break', 'disqualification',
                'half_time_whistle', 'full_time_whistle', 'kick_off'
            ));
    END IF;
END
$$;

-- 6c. teams.category: keep Male/Female, add mixed/open.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'teams'
          AND c.conname = 'teams_category_check'
    ) THEN
        ALTER TABLE public.teams DROP CONSTRAINT teams_category_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'teams'
          AND c.conname = 'teams_category_check'
    ) THEN
        ALTER TABLE public.teams
            ADD CONSTRAINT teams_category_check
            CHECK (category IN ('Male', 'Female', 'mixed', 'open'));
    END IF;
END
$$;

-- 6d. teams.team_type: generous multi-sport list.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'teams'
          AND c.conname = 'teams_team_type_check'
    ) THEN
        ALTER TABLE public.teams DROP CONSTRAINT teams_team_type_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'teams'
          AND c.conname = 'teams_team_type_check'
    ) THEN
        ALTER TABLE public.teams
            ADD CONSTRAINT teams_team_type_check
            CHECK (team_type IN ('Football', 'Futsal', 'Basketball', 'Cricket',
                                 'Tennis', 'Badminton', 'Table Tennis', 'Other'));
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 7. RLS: public SELECT + admin writes (via public.is_admin()) on new tables.
-- --------------------------------------------------------------------------
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixture_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- athletes
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'athletes'
          AND policyname = 'Anyone can view athletes'
    ) THEN
        CREATE POLICY "Anyone can view athletes"
            ON public.athletes FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'athletes'
          AND policyname = 'Admins can insert athletes'
    ) THEN
        CREATE POLICY "Admins can insert athletes"
            ON public.athletes FOR INSERT WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'athletes'
          AND policyname = 'Admins can update athletes'
    ) THEN
        CREATE POLICY "Admins can update athletes"
            ON public.athletes FOR UPDATE USING (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'athletes'
          AND policyname = 'Admins can delete athletes'
    ) THEN
        CREATE POLICY "Admins can delete athletes"
            ON public.athletes FOR DELETE USING (public.is_admin());
    END IF;

    -- fixture_entries
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixture_entries'
          AND policyname = 'Anyone can view fixture entries'
    ) THEN
        CREATE POLICY "Anyone can view fixture entries"
            ON public.fixture_entries FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixture_entries'
          AND policyname = 'Admins can insert fixture entries'
    ) THEN
        CREATE POLICY "Admins can insert fixture entries"
            ON public.fixture_entries FOR INSERT WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixture_entries'
          AND policyname = 'Admins can update fixture entries'
    ) THEN
        CREATE POLICY "Admins can update fixture entries"
            ON public.fixture_entries FOR UPDATE USING (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixture_entries'
          AND policyname = 'Admins can delete fixture entries'
    ) THEN
        CREATE POLICY "Admins can delete fixture entries"
            ON public.fixture_entries FOR DELETE USING (public.is_admin());
    END IF;

    -- players
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'players'
          AND policyname = 'Anyone can view players'
    ) THEN
        CREATE POLICY "Anyone can view players"
            ON public.players FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'players'
          AND policyname = 'Admins can insert players'
    ) THEN
        CREATE POLICY "Admins can insert players"
            ON public.players FOR INSERT WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'players'
          AND policyname = 'Admins can update players'
    ) THEN
        CREATE POLICY "Admins can update players"
            ON public.players FOR UPDATE USING (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'players'
          AND policyname = 'Admins can delete players'
    ) THEN
        CREATE POLICY "Admins can delete players"
            ON public.players FOR DELETE USING (public.is_admin());
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 8. Realtime: publication membership + REPLICA IDENTITY FULL.
--    Each ADD TABLE is wrapped so re-runs (duplicate_object) and environments
--    without the publication (undefined_object) are both no-ops.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fixtures;
EXCEPTION
    WHEN duplicate_object OR undefined_object THEN NULL;
END
$$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.match_events;
EXCEPTION
    WHEN duplicate_object OR undefined_object THEN NULL;
END
$$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fixture_entries;
EXCEPTION
    WHEN duplicate_object OR undefined_object THEN NULL;
END
$$;

ALTER TABLE public.fixtures REPLICA IDENTITY FULL;
ALTER TABLE public.match_events REPLICA IDENTITY FULL;
ALTER TABLE public.fixture_entries REPLICA IDENTITY FULL;

-- --------------------------------------------------------------------------
-- 9. Storage: `logos` bucket + policies (public read; admin write).
-- --------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
SELECT 'logos', 'logos', TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'logos');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Public read logos'
    ) THEN
        CREATE POLICY "Public read logos"
            ON storage.objects FOR SELECT USING (bucket_id = 'logos');
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can insert logos'
    ) THEN
        DROP POLICY "Admins can insert logos" ON storage.objects;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'App admins can insert logos'
    ) THEN
        CREATE POLICY "App admins can insert logos"
            ON storage.objects FOR INSERT WITH CHECK (
                bucket_id = 'logos'
                AND EXISTS (
                    SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
                ));
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can update logos'
    ) THEN
        DROP POLICY "Admins can update logos" ON storage.objects;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'App admins can update logos'
    ) THEN
        CREATE POLICY "App admins can update logos"
            ON storage.objects FOR UPDATE USING (
                bucket_id = 'logos'
                AND EXISTS (
                    SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
                ));
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can delete logos'
    ) THEN
        DROP POLICY "Admins can delete logos" ON storage.objects;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'App admins can delete logos'
    ) THEN
        CREATE POLICY "App admins can delete logos"
            ON storage.objects FOR DELETE USING (
                bucket_id = 'logos'
                AND EXISTS (
                    SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
                ));
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 10. Seed helper: CSV teams.roster → players rows.
--     One INSERT...SELECT: splits on commas, trims, skips empties, and only
--     touches teams that have a non-empty roster, a tournament link, and no
--     players yet — so re-runs insert nothing new.
-- --------------------------------------------------------------------------
INSERT INTO public.players (tournament_id, team_id, name)
SELECT t.tournament_id,
       t.id,
       btrim(roster_name)
FROM public.teams t
CROSS JOIN LATERAL regexp_split_to_table(t.roster, ',') AS roster_name
WHERE t.roster IS NOT NULL
  AND btrim(t.roster) <> ''
  AND t.tournament_id IS NOT NULL
  AND btrim(roster_name) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.team_id = t.id);

-- ============================================================================
-- PART 06 — 06_roles_invites_rpcs.sql
-- ============================================================================

-- ============================================================================
-- Migration 06 — Roles split, invites, scoped stat/score RPCs (Phase 4)
-- ============================================================================
-- Purpose:
--   * Widen user_roles.role from ('admin','user') to
--     ('app_admin','tournament_admin','user'); migrate 'admin' rows.
--   * Helpers: is_app_admin(), is_tournament_admin(uuid); redefine is_admin()
--     as (app_admin OR any tournament membership) for backward compat.
--   * tournament_members (duties TEXT[], '*' = full manager) + RLS.
--   * tournament_invites (unlimited-use tokens) + RLS + public
--     get_invite_info(token) SECURITY DEFINER reader for /invite/[token].
--   * accept_tournament_invite(token) SECURITY DEFINER accept flow.
--   * Atomic duty-checked record_stat() / record_score() RPCs.
--   * ADD (never replace) "Tournament members can ..." write policies on
--     scoped tables; fixtures rows with NULL tournament_id stay
--     app_admin-only (safe default).
--
-- Idempotency: re-runnable. Tables use CREATE TABLE IF NOT EXISTS; the
--   legacy role CHECK is dropped by catalog lookup (its inline definition
--   has an auto-generated name, so we match pg_constraint rows on
--   user_roles whose definition mentions `role` but not `app_admin`);
--   policies are created inside DO blocks guarded by pg_policies; policies
--   for Phase-3/5 tables (athletes, fixture_entries, players,
--   tournament_posts) are additionally guarded by to_regclass /
--   information_schema column checks so this file applies cleanly whether
--   or not those tables exist yet.
--
-- Depends on: supabase/schema.sql (user_roles, teams, fixtures,
--   match_events, is_admin), supabase/schema_updates.sql (fixtures.stats,
--   tournament_settings), 02_tournaments_core.sql (tournaments,
--   tournament_id scoping), 03_sports_catalog.sql (sports.stat_vocab).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Roles split: ('admin','user') -> ('app_admin','tournament_admin','user')
-- --------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop any legacy CHECK on user_roles.role that does not yet know the
    -- new role values. The original CHECK was declared inline (no explicit
    -- name), so resolve it via the catalog instead of hardcoding.
    FOR r IN
        SELECT c.conname AS conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'user_roles'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%role%'
          AND pg_get_constraintdef(c.oid) NOT LIKE '%app_admin%'
    LOOP
        EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', r.conname);
    END LOOP;

    -- Migrate legacy rows BEFORE re-adding the CHECK (old CHECK rejects
    -- 'app_admin', new CHECK rejects 'admin' — so drop -> update -> add).
    UPDATE public.user_roles SET role = 'app_admin' WHERE role = 'admin';

    -- Re-add the widened CHECK (skip if already present on re-runs).
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'user_roles'
          AND c.conname = 'user_roles_role_check'
    ) THEN
        ALTER TABLE public.user_roles
            ADD CONSTRAINT user_roles_role_check
            CHECK (role IN ('app_admin', 'tournament_admin', 'user'));
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so they work inside RLS policies)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    role_val TEXT;
BEGIN
    SELECT ur.role INTO role_val
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid();
    RETURN COALESCE(role_val, '') = 'app_admin';
END;
$$;

-- tournament_members is created just below (section 2 table); plpgsql
-- bodies are validated at execution time in any case.
CREATE TABLE IF NOT EXISTS public.tournament_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    duties TEXT[] NOT NULL DEFAULT '{*}',
    granted_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tournament_members_tournament_user UNIQUE (tournament_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_tournament_admin(tournament_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF tournament_uuid IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.tournament_members m
        WHERE m.tournament_id = tournament_uuid
          AND m.user_id = auth.uid()
    );
END;
$$;

-- Backward compat: legacy is_admin() now means "app admin OR member of any
-- tournament". CREATE OR REPLACE preserves the OID so existing policies
-- referencing is_admin() keep working.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF public.is_app_admin() THEN
        RETURN TRUE;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.tournament_members m
        WHERE m.user_id = auth.uid()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_app_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_admin(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. tournament_members + RLS
--    SELECT: members see their own rows; app_admin sees all.
--    INSERT/UPDATE/DELETE: app_admin only (invite accept flow uses the
--    SECURITY DEFINER function in section 4, bypassing RLS).
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tournament_members_tournament_id
    ON public.tournament_members (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_members_user_id
    ON public.tournament_members (user_id);

ALTER TABLE public.tournament_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'Users can view their own memberships'
    ) THEN
        CREATE POLICY "Users can view their own memberships"
            ON public.tournament_members FOR SELECT
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can view all memberships'
    ) THEN
        CREATE POLICY "App admins can view all memberships"
            ON public.tournament_members FOR SELECT
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can insert memberships'
    ) THEN
        CREATE POLICY "App admins can insert memberships"
            ON public.tournament_members FOR INSERT
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can update memberships'
    ) THEN
        CREATE POLICY "App admins can update memberships"
            ON public.tournament_members FOR UPDATE
            USING (public.is_app_admin())
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can delete memberships'
    ) THEN
        CREATE POLICY "App admins can delete memberships"
            ON public.tournament_members FOR DELETE
            USING (public.is_app_admin());
    END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_members TO authenticated;

-- --------------------------------------------------------------------------
-- 3. tournament_invites + RLS + public get_invite_info(token)
--    SELECT: app_admin + full ('*') managers of that tournament; plus a
--    public valid-only policy (not revoked AND not expired) so the invite
--    link resolves. RLS cannot column-filter, so the public /invite/[token]
--    page MUST use get_invite_info() below (SECURITY DEFINER, returns only
--    tournament name/slug/duties/expires_at/valid) instead of selecting the
--    table directly (which would also expose created_by / token metadata).
--    INSERT/UPDATE/DELETE: app_admin or '*' manager of that tournament.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    duties TEXT[] NOT NULL DEFAULT '{*}',
    created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_invites_tournament_id
    ON public.tournament_invites (tournament_id);

ALTER TABLE public.tournament_invites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can view invites'
    ) THEN
        CREATE POLICY "App admins can view invites"
            ON public.tournament_invites FOR SELECT
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can view invites'
    ) THEN
        CREATE POLICY "Tournament managers can view invites"
            ON public.tournament_invites FOR SELECT
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;

    -- SECURITY (hardening): never publish valid invites. The invite link
    -- resolves through get_invite_info(); a public SELECT policy would only
    -- leak live tokens to anon.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Public can view valid invites'
    ) THEN
        DROP POLICY "Public can view valid invites" ON public.tournament_invites;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can create invites'
    ) THEN
        CREATE POLICY "App admins can create invites"
            ON public.tournament_invites FOR INSERT
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can create invites'
    ) THEN
        CREATE POLICY "Tournament managers can create invites"
            ON public.tournament_invites FOR INSERT
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can update invites'
    ) THEN
        CREATE POLICY "App admins can update invites"
            ON public.tournament_invites FOR UPDATE
            USING (public.is_app_admin())
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can update invites'
    ) THEN
        -- Revoke path: app_admin or '*' manager of the invite's tournament.
        CREATE POLICY "Tournament managers can update invites"
            ON public.tournament_invites FOR UPDATE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can delete invites'
    ) THEN
        CREATE POLICY "App admins can delete invites"
            ON public.tournament_invites FOR DELETE
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can delete invites'
    ) THEN
        CREATE POLICY "Tournament managers can delete invites"
            ON public.tournament_invites FOR DELETE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;
END
$$;

-- SECURITY (hardening): invites are secrets. RLS filters rows, not columns, so
-- a public SELECT policy plus this grant would publish every live token to
-- anyone holding the anon key, and accept_tournament_invite() would then join
-- them to the tournament with the invite's duties (often '*'). The invite page
-- resolves links through get_invite_info() (SECURITY DEFINER), which needs no
-- table grant, and managers read invites through list_tournament_invites().
REVOKE SELECT ON public.tournament_invites FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_invites TO authenticated;

-- Public invite-page reader: exposes only the safe subset, never
-- created_by. Callable by anon + authenticated.
CREATE OR REPLACE FUNCTION public.get_invite_info(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_inv public.tournament_invites%ROWTYPE;
    v_name TEXT;
    v_slug TEXT;
BEGIN
    SELECT * INTO v_inv
    FROM public.tournament_invites i
    WHERE i.token = p_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', FALSE);
    END IF;

    SELECT t.name, t.slug INTO v_name, v_slug
    FROM public.tournaments t
    WHERE t.id = v_inv.tournament_id;

    RETURN jsonb_build_object(
        'valid', (v_inv.revoked = FALSE AND v_inv.expires_at > NOW()),
        'tournament_id', v_inv.tournament_id,
        'tournament_name', v_name,
        'tournament_slug', v_slug,
        'duties', to_jsonb(COALESCE(v_inv.duties, '{*}')),
        'expires_at', v_inv.expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_info(TEXT) TO anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. accept_tournament_invite(p_token text) -> json
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_tournament_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv public.tournament_invites%ROWTYPE;
    v_slug TEXT;
    v_uid UUID;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT * INTO v_inv
    FROM public.tournament_invites i
    WHERE i.token = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite not found';
    END IF;
    IF v_inv.revoked THEN
        RAISE EXCEPTION 'Invite has been revoked';
    END IF;
    IF v_inv.expires_at <= NOW() THEN
        RAISE EXCEPTION 'Invite has expired';
    END IF;

    INSERT INTO public.tournament_members (tournament_id, user_id, duties, granted_by)
    VALUES (v_inv.tournament_id, v_uid, COALESCE(v_inv.duties, '{*}'), v_inv.created_by)
    ON CONFLICT (tournament_id, user_id) DO NOTHING;

    -- Promote to tournament_admin only from 'user'; never demote app_admin
    -- (and leave existing tournament_admin rows untouched). Inserts a row
    -- when the user has no user_roles row yet.
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'tournament_admin')
    ON CONFLICT (user_id) DO UPDATE
        SET role = 'tournament_admin'
        WHERE public.user_roles.role = 'user';

    SELECT t.slug INTO v_slug
    FROM public.tournaments t
    WHERE t.id = v_inv.tournament_id;

    RETURN jsonb_build_object(
        'tournament_id', v_inv.tournament_id,
        'tournament_slug', v_slug,
        'duties', to_jsonb(COALESCE(v_inv.duties, '{*}'))
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_tournament_invite(TEXT) TO authenticated;

-- --------------------------------------------------------------------------
-- 5. record_stat(p_fixture_id uuid, p_side text, p_stat_key text) -> int
--    Atomic duty-checked increment of stats->side->key by 1.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_stat(p_fixture_id UUID, p_side TEXT, p_stat_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
    v_sport_id UUID;
    v_vocab JSONB;
    v_allowed BOOLEAN := FALSE;
    v_new INTEGER;
    c_legacy TEXT[] := ARRAY[
        'passes', 'shots', 'shots_on_target', 'shots_off_target',
        'fouls', 'corners', 'freekicks', 'offsides',
        'yellow_cards', 'red_cards', 'gk_saves', 'interceptions'
    ];
BEGIN
    IF p_side NOT IN ('home', 'away') THEN
        RAISE EXCEPTION 'Invalid side %: must be ''home'' or ''away''', p_side;
    END IF;
    IF p_stat_key IS NULL OR p_stat_key = '' THEN
        RAISE EXCEPTION 'Stat key must not be empty';
    END IF;

    SELECT f.tournament_id, f.sport_id
      INTO v_tournament_id, v_sport_id
    FROM public.fixtures f
    WHERE f.id = p_fixture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    -- Caller must be app_admin, or a member of the fixture's tournament
    -- whose duties contain '*' or the exact stat key. Fixtures with NULL
    -- tournament_id fall through to app_admin-only (safe default).
    IF NOT public.is_app_admin() THEN
        IF v_tournament_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM public.tournament_members m
            WHERE m.tournament_id = v_tournament_id
              AND m.user_id = auth.uid()
              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY[p_stat_key])
        ) THEN
            RAISE EXCEPTION 'Not authorized to record stats for this fixture';
        END IF;
    END IF;

    -- Validate the stat key against the sport's stat_vocab (array of plain
    -- keys or objects carrying key/stat/name). When the fixture has no
    -- sport, the sport row is gone, or the vocab is empty, fall back to
    -- the 12 legacy football keys.
    IF v_sport_id IS NULL THEN
        v_allowed := p_stat_key = ANY (c_legacy);
    ELSE
        SELECT s.stat_vocab INTO v_vocab
        FROM public.sports s
        WHERE s.id = v_sport_id;

        IF v_vocab IS NULL
           OR (jsonb_typeof(v_vocab) = 'array' AND jsonb_array_length(v_vocab) = 0)
           OR (jsonb_typeof(v_vocab) <> 'array') THEN
            v_allowed := p_stat_key = ANY (c_legacy);
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(v_vocab) e
                WHERE e = to_jsonb(p_stat_key)
                   OR (jsonb_typeof(e) = 'object' AND e ->> 'key' = p_stat_key)
                   OR (jsonb_typeof(e) = 'object' AND e ->> 'stat' = p_stat_key)
                   OR (jsonb_typeof(e) = 'object' AND e ->> 'name' = p_stat_key)
            ) INTO v_allowed;
        END IF;
    END IF;

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Unknown stat key % for this fixture''s sport', p_stat_key;
    END IF;

    -- Single-statement atomic increment (no read-modify-write race):
    -- ensure the side object exists, then bump the key.
    UPDATE public.fixtures
    SET stats = jsonb_set(
            jsonb_set(
                COALESCE(stats, '{}'::jsonb),
                ARRAY[p_side],
                COALESCE(stats -> p_side, '{}'::jsonb),
                TRUE
            ),
            ARRAY[p_side, p_stat_key],
            to_jsonb(COALESCE((stats -> p_side ->> p_stat_key)::INT, 0) + 1),
            TRUE
        ),
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING (stats -> p_side ->> p_stat_key)::INT INTO v_new;

    RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stat(UUID, TEXT, TEXT) TO authenticated;

-- --------------------------------------------------------------------------
-- 6. record_score(p_fixture_id uuid, p_home int, p_away int) -> fixtures row
--    Same membership check, but requires '*' or the 'score' duty.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_score(p_fixture_id UUID, p_home INT, p_away INT)
RETURNS public.fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
    v_row public.fixtures%ROWTYPE;
BEGIN
    SELECT f.tournament_id INTO v_tournament_id
    FROM public.fixtures f
    WHERE f.id = p_fixture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    IF p_home IS NULL OR p_home < 0 OR p_away IS NULL OR p_away < 0 THEN
        RAISE EXCEPTION 'Scores must be non-negative integers';
    END IF;

    IF NOT public.is_app_admin() THEN
        IF v_tournament_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM public.tournament_members m
            WHERE m.tournament_id = v_tournament_id
              AND m.user_id = auth.uid()
              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['score'])
        ) THEN
            RAISE EXCEPTION 'Not authorized to record the score for this fixture';
        END IF;
    END IF;

    UPDATE public.fixtures
    SET home_score = p_home,
        away_score = p_away,
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_score(UUID, INT, INT) TO authenticated;

-- --------------------------------------------------------------------------
-- 7. Scoped write policies (ADD, never replace existing Admins policies).
--    Pattern everywhere: is_app_admin() OR is_tournament_admin(<row's
--    tournament>). Parent-linked tables resolve the tournament via scalar
--    subquery. Fixtures with NULL tournament_id stay app_admin-only.
-- --------------------------------------------------------------------------

-- teams (direct tournament_id) ---------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teams'
          AND policyname = 'Tournament members can insert teams'
    ) THEN
        CREATE POLICY "Tournament members can insert teams"
            ON public.teams FOR INSERT
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teams'
          AND policyname = 'Tournament members can update teams'
    ) THEN
        CREATE POLICY "Tournament members can update teams"
            ON public.teams FOR UPDATE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            )
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teams'
          AND policyname = 'Tournament members can delete teams'
    ) THEN
        CREATE POLICY "Tournament members can delete teams"
            ON public.teams FOR DELETE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;
END
$$;

-- fixtures (direct tournament_id; NULL stays app_admin-only) ----------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixtures'
          AND policyname = 'Tournament members can insert fixtures'
    ) THEN
        CREATE POLICY "Tournament members can insert fixtures"
            ON public.fixtures FOR INSERT
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixtures'
          AND policyname = 'Tournament members can update fixtures'
    ) THEN
        CREATE POLICY "Tournament members can update fixtures"
            ON public.fixtures FOR UPDATE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            )
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixtures'
          AND policyname = 'Tournament members can delete fixtures'
    ) THEN
        CREATE POLICY "Tournament members can delete fixtures"
            ON public.fixtures FOR DELETE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;
END
$$;

-- match_events (direct tournament_id OR parent fixture's tournament) --------
DO $$
DECLARE
    has_tournament BOOLEAN;
    has_fixture BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'match_events'
          AND column_name = 'tournament_id'
    ) INTO has_tournament;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'match_events'
          AND column_name = 'fixture_id'
    ) INTO has_fixture;

    IF NOT has_fixture AND NOT has_tournament THEN
        RAISE NOTICE 'match_events has neither fixture_id nor tournament_id; skipping member policies';
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'match_events'
              AND policyname = 'Tournament members can insert match events'
        ) THEN
            IF has_tournament AND has_fixture THEN
                CREATE POLICY "Tournament members can insert match events"
                    ON public.match_events FOR INSERT
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSIF has_fixture THEN
                CREATE POLICY "Tournament members can insert match events"
                    ON public.match_events FOR INSERT
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSE
                CREATE POLICY "Tournament members can insert match events"
                    ON public.match_events FOR INSERT
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    );
            END IF;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'match_events'
              AND policyname = 'Tournament members can update match events'
        ) THEN
            IF has_tournament AND has_fixture THEN
                CREATE POLICY "Tournament members can update match events"
                    ON public.match_events FOR UPDATE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    )
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSIF has_fixture THEN
                CREATE POLICY "Tournament members can update match events"
                    ON public.match_events FOR UPDATE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    )
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSE
                CREATE POLICY "Tournament members can update match events"
                    ON public.match_events FOR UPDATE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    )
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    );
            END IF;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'match_events'
              AND policyname = 'Tournament members can delete match events'
        ) THEN
            IF has_tournament AND has_fixture THEN
                CREATE POLICY "Tournament members can delete match events"
                    ON public.match_events FOR DELETE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSIF has_fixture THEN
                CREATE POLICY "Tournament members can delete match events"
                    ON public.match_events FOR DELETE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSE
                CREATE POLICY "Tournament members can delete match events"
                    ON public.match_events FOR DELETE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    );
            END IF;
        END IF;
    END IF;
END
$$;

-- athletes (Phase 3 table; direct tournament_id) -----------------------------
DO $$
BEGIN
    IF to_regclass('public.athletes') IS NULL THEN
        RAISE NOTICE 'public.athletes does not exist yet; skipping member policies (Phase 3 migration adds them)';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'athletes'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.athletes has no tournament_id column; skipping member policies';
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'athletes'
              AND policyname = 'Tournament members can insert athletes'
        ) THEN
            CREATE POLICY "Tournament members can insert athletes"
                ON public.athletes FOR INSERT
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'athletes'
              AND policyname = 'Tournament members can update athletes'
        ) THEN
            CREATE POLICY "Tournament members can update athletes"
                ON public.athletes FOR UPDATE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'athletes'
              AND policyname = 'Tournament members can delete athletes'
        ) THEN
            CREATE POLICY "Tournament members can delete athletes"
                ON public.athletes FOR DELETE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;
    END IF;
END
$$;

-- fixture_entries (Phase 3 table; via parent fixture -> tournament_id) --------
DO $$
DECLARE
    has_direct BOOLEAN;
    has_fixture BOOLEAN;
BEGIN
    IF to_regclass('public.fixture_entries') IS NULL THEN
        RAISE NOTICE 'public.fixture_entries does not exist yet; skipping member policies (Phase 3 migration adds them)';
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'fixture_entries'
              AND column_name = 'tournament_id'
        ) INTO has_direct;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'fixture_entries'
              AND column_name = 'fixture_id'
        ) INTO has_fixture;

        IF NOT has_direct AND NOT has_fixture THEN
            RAISE NOTICE 'public.fixture_entries has neither tournament_id nor fixture_id; skipping member policies';
        ELSE
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'fixture_entries'
                  AND policyname = 'Tournament members can insert fixture entries'
            ) THEN
                IF has_direct AND has_fixture THEN
                    CREATE POLICY "Tournament members can insert fixture entries"
                        ON public.fixture_entries FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSIF has_fixture THEN
                    CREATE POLICY "Tournament members can insert fixture entries"
                        ON public.fixture_entries FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can insert fixture entries"
                        ON public.fixture_entries FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'fixture_entries'
                  AND policyname = 'Tournament members can update fixture entries'
            ) THEN
                IF has_direct AND has_fixture THEN
                    CREATE POLICY "Tournament members can update fixture entries"
                        ON public.fixture_entries FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSIF has_fixture THEN
                    CREATE POLICY "Tournament members can update fixture entries"
                        ON public.fixture_entries FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can update fixture entries"
                        ON public.fixture_entries FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'fixture_entries'
                  AND policyname = 'Tournament members can delete fixture entries'
            ) THEN
                IF has_direct AND has_fixture THEN
                    CREATE POLICY "Tournament members can delete fixture entries"
                        ON public.fixture_entries FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSIF has_fixture THEN
                    CREATE POLICY "Tournament members can delete fixture entries"
                        ON public.fixture_entries FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can delete fixture entries"
                        ON public.fixture_entries FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;
        END IF;
    END IF;
END
$$;

-- players (Phase 3 table; via parent team -> tournament_id) ------------------
DO $$
DECLARE
    has_team BOOLEAN;
    has_direct BOOLEAN;
BEGIN
    IF to_regclass('public.players') IS NULL THEN
        RAISE NOTICE 'public.players does not exist yet; skipping member policies (Phase 3 migration adds them)';
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'players'
              AND column_name = 'team_id'
        ) INTO has_team;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'players'
              AND column_name = 'tournament_id'
        ) INTO has_direct;

        IF NOT has_team AND NOT has_direct THEN
            RAISE NOTICE 'public.players has neither team_id nor tournament_id; skipping member policies';
        ELSE
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'players'
                  AND policyname = 'Tournament members can insert players'
            ) THEN
                IF has_team AND has_direct THEN
                    CREATE POLICY "Tournament members can insert players"
                        ON public.players FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSIF has_team THEN
                    CREATE POLICY "Tournament members can insert players"
                        ON public.players FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can insert players"
                        ON public.players FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'players'
                  AND policyname = 'Tournament members can update players'
            ) THEN
                IF has_team AND has_direct THEN
                    CREATE POLICY "Tournament members can update players"
                        ON public.players FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSIF has_team THEN
                    CREATE POLICY "Tournament members can update players"
                        ON public.players FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can update players"
                        ON public.players FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'players'
                  AND policyname = 'Tournament members can delete players'
            ) THEN
                IF has_team AND has_direct THEN
                    CREATE POLICY "Tournament members can delete players"
                        ON public.players FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSIF has_team THEN
                    CREATE POLICY "Tournament members can delete players"
                        ON public.players FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can delete players"
                        ON public.players FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;
        END IF;
    END IF;
END
$$;

-- tournament_posts (Phase 5 table; only if it exists) -------------------------
DO $$
BEGIN
    IF to_regclass('public.tournament_posts') IS NULL THEN
        RAISE NOTICE 'public.tournament_posts does not exist yet; skipping member policies (Phase 5 migration adds them)';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tournament_posts'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.tournament_posts has no tournament_id column; skipping member policies';
    ELSE
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can insert tournament posts'
        ) THEN
            DROP POLICY "Tournament members can insert tournament posts" ON public.tournament_posts;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can insert tournament posts'
        ) THEN
            CREATE POLICY "Tournament members can insert tournament posts"
                ON public.tournament_posts FOR INSERT
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
                );
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can update tournament posts'
        ) THEN
            DROP POLICY "Tournament members can update tournament posts" ON public.tournament_posts;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can update tournament posts'
        ) THEN
            CREATE POLICY "Tournament members can update tournament posts"
                ON public.tournament_posts FOR UPDATE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
                );
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can delete tournament posts'
        ) THEN
            DROP POLICY "Tournament members can delete tournament posts" ON public.tournament_posts;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can delete tournament posts'
        ) THEN
            CREATE POLICY "Tournament members can delete tournament posts"
                ON public.tournament_posts FOR DELETE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
                );
        END IF;
    END IF;
END
$$;

-- tournament_settings (per-tournament; legacy NULL rows stay app_admin-only) --
DO $$
BEGIN
    IF to_regclass('public.tournament_settings') IS NULL THEN
        RAISE NOTICE 'public.tournament_settings does not exist; skipping member policies';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tournament_settings'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.tournament_settings has no tournament_id column; skipping member policies';
    ELSE
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can insert tournament settings'
        ) THEN
            DROP POLICY "Tournament members can insert tournament settings" ON public.tournament_settings;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can insert tournament settings'
        ) THEN
            CREATE POLICY "Tournament members can insert tournament settings"
                ON public.tournament_settings FOR INSERT
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
                );
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can update tournament settings'
        ) THEN
            DROP POLICY "Tournament members can update tournament settings" ON public.tournament_settings;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can update tournament settings'
        ) THEN
            CREATE POLICY "Tournament members can update tournament settings"
                ON public.tournament_settings FOR UPDATE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
                );
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can delete tournament settings'
        ) THEN
            DROP POLICY "Tournament members can delete tournament settings" ON public.tournament_settings;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can delete tournament settings'
        ) THEN
            CREATE POLICY "Tournament members can delete tournament settings"
                ON public.tournament_settings FOR DELETE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
                );
        END IF;
    END IF;
END
$$;

-- ============================================================================
-- PART 07 — 07_tighten_legacy_policies.sql
-- ============================================================================

-- 07: tighten legacy unscoped write policies.
-- 06_roles redefined is_admin() as app_admin OR any tournament member, which
-- widened the legacy "Admins can ..." policies on teams/fixtures/match_events/
-- tournament_settings to all tournament members, including rows outside their
-- tournament (or with NULL tournament_id). This migration replaces those with
-- app_admin-only policies; member-scoped policies from 06 remain in force.
-- Idempotent: every DROP guarded by pg_policies lookup.

DO $$ BEGIN
  -- teams
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='Admins can insert teams') THEN
    DROP POLICY "Admins can insert teams" ON public.teams;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='Admins can update teams') THEN
    DROP POLICY "Admins can update teams" ON public.teams;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='Admins can delete teams') THEN
    DROP POLICY "Admins can delete teams" ON public.teams;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='App admins can insert teams') THEN
    CREATE POLICY "App admins can insert teams" ON public.teams FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='App admins can update teams') THEN
    CREATE POLICY "App admins can update teams" ON public.teams FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='App admins can delete teams') THEN
    CREATE POLICY "App admins can delete teams" ON public.teams FOR DELETE USING (public.is_app_admin());
  END IF;

  -- fixtures
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='Admins can insert fixtures') THEN
    DROP POLICY "Admins can insert fixtures" ON public.fixtures;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='Admins can update fixtures') THEN
    DROP POLICY "Admins can update fixtures" ON public.fixtures;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='Admins can delete fixtures') THEN
    DROP POLICY "Admins can delete fixtures" ON public.fixtures;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='App admins can insert fixtures') THEN
    CREATE POLICY "App admins can insert fixtures" ON public.fixtures FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='App admins can update fixtures') THEN
    CREATE POLICY "App admins can update fixtures" ON public.fixtures FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='App admins can delete fixtures') THEN
    CREATE POLICY "App admins can delete fixtures" ON public.fixtures FOR DELETE USING (public.is_app_admin());
  END IF;

  -- match_events
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='Admins can insert match events') THEN
    DROP POLICY "Admins can insert match events" ON public.match_events;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='Admins can update match events') THEN
    DROP POLICY "Admins can update match events" ON public.match_events;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='Admins can delete match events') THEN
    DROP POLICY "Admins can delete match events" ON public.match_events;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='App admins can insert match events') THEN
    CREATE POLICY "App admins can insert match events" ON public.match_events FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='App admins can update match events') THEN
    CREATE POLICY "App admins can update match events" ON public.match_events FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='App admins can delete match events') THEN
    CREATE POLICY "App admins can delete match events" ON public.match_events FOR DELETE USING (public.is_app_admin());
  END IF;

  -- tournament_settings (legacy global policies from schema_updates.sql)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='Admins can insert tournament settings') THEN
    DROP POLICY "Admins can insert tournament settings" ON public.tournament_settings;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='Admins can update tournament settings') THEN
    DROP POLICY "Admins can update tournament settings" ON public.tournament_settings;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='Admins can delete tournament settings') THEN
    DROP POLICY "Admins can delete tournament settings" ON public.tournament_settings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='App admins can insert tournament settings') THEN
    CREATE POLICY "App admins can insert tournament settings" ON public.tournament_settings FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='App admins can update tournament settings') THEN
    CREATE POLICY "App admins can update tournament settings" ON public.tournament_settings FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='App admins can delete tournament settings') THEN
    CREATE POLICY "App admins can delete tournament settings" ON public.tournament_settings FOR DELETE USING (public.is_app_admin());
  END IF;
END $$;

-- ============================================================================
-- PART 08 — 08_tournament_posts.sql
-- ============================================================================

-- ============================================================================
-- Migration 08 — tournament_posts (Phase 5: blog / news surface)
-- ============================================================================
-- Purpose:
--   * Create the `tournament_posts` table the Batch 4/5 work depends on
--     (admin CRUD + public news list/detail + homepage carousel). Migration 06
--     already contains the member-scoped write policies for this table but
--     skipped them because the table did not exist yet (`to_regclass` guard);
--     the policies are re-created here so a single run of 08 is sufficient.
--   * RLS: public may read published posts; app_admin reads/writes everything;
--     tournament members may read all posts of their tournament and write when
--     their duties include '*' or 'posts'.
--   * Indexes for the public list (`tournament_id, published_at DESC`) and for
--     slug lookups.
--
-- Idempotency: re-runnable. CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
--   EXISTS, and every policy inside a pg_policies guard.
--
-- Depends on: supabase/schema.sql (auth.users), 02_tournaments_core.sql
--   (tournaments), 06_roles_invites_rpcs.sql (is_app_admin,
--   is_tournament_admin, is_admin).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.tournament_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    excerpt TEXT,
    body TEXT,
    image_url TEXT,
    category TEXT NOT NULL DEFAULT 'News',
    author_id UUID,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tournament_posts_slug_check
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- FK to tournaments (guarded; re-runnable).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_posts'
          AND c.conname = 'fk_tournament_posts_tournament_id'
    ) THEN
        ALTER TABLE public.tournament_posts
            ADD CONSTRAINT fk_tournament_posts_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_posts'
          AND c.conname = 'fk_tournament_posts_author_id'
    ) THEN
        ALTER TABLE public.tournament_posts
            ADD CONSTRAINT fk_tournament_posts_author_id
            FOREIGN KEY (author_id)
            REFERENCES auth.users (id)
            ON DELETE SET NULL;
    END IF;

    -- One slug per tournament (URLs are /news/<slug>).
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_posts'
          AND c.conname = 'uq_tournament_posts_tournament_slug'
    ) THEN
        ALTER TABLE public.tournament_posts
            ADD CONSTRAINT uq_tournament_posts_tournament_slug
            UNIQUE (tournament_id, slug);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_tournament_posts_tournament_published
    ON public.tournament_posts (tournament_id, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_tournament_posts_slug
    ON public.tournament_posts (slug);

CREATE INDEX IF NOT EXISTS idx_tournament_posts_published_at
    ON public.tournament_posts (published_at DESC NULLS LAST)
    WHERE published IS TRUE;

ALTER TABLE public.tournament_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Anyone can view published tournament posts'
    ) THEN
        CREATE POLICY "Anyone can view published tournament posts"
            ON public.tournament_posts FOR SELECT
            USING (published IS TRUE AND published_at IS NOT NULL AND published_at <= NOW());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can manage tournament posts'
    ) THEN
        CREATE POLICY "App admins can manage tournament posts"
            ON public.tournament_posts FOR SELECT
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can view tournament posts'
    ) THEN
        CREATE POLICY "Tournament members can view tournament posts"
            ON public.tournament_posts FOR SELECT
            USING (public.is_tournament_admin(tournament_id));
    END IF;
END
$$;
-- Write policies: app_admin everywhere; members scoped to their tournament
-- with the '*' or 'posts' duty.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can insert tournament posts'
    ) THEN
        CREATE POLICY "App admins can insert tournament posts"
            ON public.tournament_posts FOR INSERT
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can update tournament posts'
    ) THEN
        CREATE POLICY "App admins can update tournament posts"
            ON public.tournament_posts FOR UPDATE
            USING (public.is_app_admin())
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can delete tournament posts'
    ) THEN
        CREATE POLICY "App admins can delete tournament posts"
            ON public.tournament_posts FOR DELETE
            USING (public.is_app_admin());
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can insert tournament posts'
    ) THEN
        DROP POLICY "Tournament members can insert tournament posts" ON public.tournament_posts;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can insert tournament posts'
    ) THEN
        CREATE POLICY "Tournament members can insert tournament posts"
            ON public.tournament_posts FOR INSERT
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.tournament_members m
                        WHERE m.tournament_id = tournament_posts.tournament_id
                          AND m.user_id = auth.uid()
                          AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                    ))
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can update tournament posts'
    ) THEN
        DROP POLICY "Tournament members can update tournament posts" ON public.tournament_posts;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can update tournament posts'
    ) THEN
        CREATE POLICY "Tournament members can update tournament posts"
            ON public.tournament_posts FOR UPDATE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.tournament_members m
                        WHERE m.tournament_id = tournament_posts.tournament_id
                          AND m.user_id = auth.uid()
                          AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                    ))
            )
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.tournament_members m
                        WHERE m.tournament_id = tournament_posts.tournament_id
                          AND m.user_id = auth.uid()
                          AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                    ))
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can delete tournament posts'
    ) THEN
        DROP POLICY "Tournament members can delete tournament posts" ON public.tournament_posts;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can delete tournament posts'
    ) THEN
        CREATE POLICY "Tournament members can delete tournament posts"
            ON public.tournament_posts FOR DELETE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.tournament_members m
                        WHERE m.tournament_id = tournament_posts.tournament_id
                          AND m.user_id = auth.uid()
                          AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                    ))
            );
    END IF;
END
$$;

-- Keep updated_at fresh without app changes.
CREATE OR REPLACE FUNCTION public.touch_tournament_posts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_tournament_posts_updated_at'
    ) THEN
        CREATE TRIGGER trg_tournament_posts_updated_at
            BEFORE UPDATE ON public.tournament_posts
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_tournament_posts_updated_at();
    END IF;
END
$$;

-- ============================================================================
-- PART 09 — 09_harden_policies_and_admin_rpcs.sql
-- ============================================================================

-- ============================================================================
-- Migration 09 — Tighten widened policies, scale indexes, admin RPCs
-- ============================================================================
-- Why this exists:
--   06_roles_invites_rpcs.sql redefined `is_admin()` to mean "app_admin OR
--   member of any tournament" so legacy policies (written when only one admin
--   role existed) started granting tournament members write access to
--   *global* tables. 07_tighten_legacy_policies.sql fixed teams, fixtures,
--   match_events and tournament_settings but not the remaining ones. This
--   migration finishes that work and adds the small set of RPCs the admin UI
--   needs (user administration, invite creation/revocation, member listing).
--
-- Sections:
--   1. Drop legacy `is_admin()`-based policies that are now over-broad and
--      re-create them as app_admin-only (scoped member policies from 06 stay).
--   2. Let tournament members see the other members of their own tournaments.
--   3. Composite/partial indexes for the hot public read paths.
--   4. SECURITY DEFINER RPCs: list_app_users(), set_user_role(),
--      list_tournament_members(), create_tournament_invite(),
--      revoke_tournament_invite().
--
-- Idempotency: fully re-runnable (catalog-guarded drops/creates, IF NOT
--   EXISTS indexes, CREATE OR REPLACE functions).
--
-- Depends on: schema.sql, 02_tournaments_core.sql, 03_sports_catalog.sql,
--   05_athletes_entries_players.sql, 06_roles_invites_rpcs.sql.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------------
-- 1. Replace over-broad legacy write policies with app_admin-only policies
-- --------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('user_roles',        'Admins can view all roles'),
            ('tournaments',       'Admins can insert tournaments'),
            ('tournaments',       'Admins can update tournaments'),
            ('tournaments',       'Admins can delete tournaments'),
            ('sports',            'Admins can insert sports'),
            ('sports',            'Admins can update sports'),
            ('sports',            'Admins can delete sports'),
            ('sport_divisions',   'Admins can insert sport divisions'),
            ('sport_divisions',   'Admins can update sport divisions'),
            ('sport_divisions',   'Admins can delete sport divisions'),
            ('tournament_sports', 'Admins can insert tournament sports'),
            ('tournament_sports', 'Admins can update tournament sports'),
            ('tournament_sports', 'Admins can delete tournament sports'),
            ('athletes',          'Admins can insert athletes'),
            ('athletes',          'Admins can update athletes'),
            ('athletes',          'Admins can delete athletes'),
            ('players',           'Admins can insert players'),
            ('players',           'Admins can update players'),
            ('players',           'Admins can delete players'),
            ('fixture_entries',   'Admins can insert fixture entries'),
            ('fixture_entries',   'Admins can update fixture entries'),
            ('fixture_entries',   'Admins can delete fixture entries')
        ) AS legacy(tbl, pol)
    LOOP
        IF to_regclass('public.' || r.tbl) IS NULL THEN
            CONTINUE;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = r.tbl
              AND policyname = r.pol
        ) THEN
            EXECUTE format('DROP POLICY %I ON public.%I', r.pol, r.tbl);
        END IF;
    END LOOP;
END
$$;
DO $$
DECLARE
    r RECORD;
    v_name TEXT;
    v_stmt TEXT;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('user_roles',        'SELECT'),
            ('user_roles',        'INSERT'),
            ('user_roles',        'UPDATE'),
            ('user_roles',        'DELETE'),
            ('tournaments',       'INSERT'),
            ('tournaments',       'UPDATE'),
            ('tournaments',       'DELETE'),
            ('sports',            'INSERT'),
            ('sports',            'UPDATE'),
            ('sports',            'DELETE'),
            ('sport_divisions',   'INSERT'),
            ('sport_divisions',   'UPDATE'),
            ('sport_divisions',   'DELETE'),
            ('tournament_sports', 'INSERT'),
            ('tournament_sports', 'UPDATE'),
            ('tournament_sports', 'DELETE'),
            ('athletes',          'INSERT'),
            ('athletes',          'UPDATE'),
            ('athletes',          'DELETE'),
            ('players',           'INSERT'),
            ('players',           'UPDATE'),
            ('players',           'DELETE'),
            ('fixture_entries',   'INSERT'),
            ('fixture_entries',   'UPDATE'),
            ('fixture_entries',   'DELETE')
        ) AS scoped(tbl, act)
    LOOP
        IF to_regclass('public.' || r.tbl) IS NULL THEN
            CONTINUE;
        END IF;

        IF r.act = 'SELECT' THEN
            v_name := 'App admins can view all ' || replace(r.tbl, '_', ' ');
        ELSE
            v_name := 'App admins can ' || lower(r.act) || ' ' || replace(r.tbl, '_', ' ');
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = r.tbl
              AND policyname = v_name
        ) THEN
            v_stmt := CASE r.act
                WHEN 'INSERT' THEN
                    format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.is_app_admin())', v_name, r.tbl)
                WHEN 'UPDATE' THEN
                    format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.is_app_admin()) WITH CHECK (public.is_app_admin())', v_name, r.tbl)
                ELSE
                    format('CREATE POLICY %I ON public.%I FOR %s USING (public.is_app_admin())', v_name, r.tbl, r.act)
            END;
            EXECUTE v_stmt;
        END IF;
    END LOOP;
END
$$;
-- --------------------------------------------------------------------------
-- 2. Tournament members can see their co-members (needed by the admin
--    tournament detail screen). Rows stay scoped to tournaments they are in.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'Tournament members can view tournament memberships'
    ) THEN
        CREATE POLICY "Tournament members can view tournament memberships"
            ON public.tournament_members FOR SELECT
            USING (public.is_tournament_admin(tournament_id));
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 3. Scale indexes for the hot public read paths.
--    The public hub filters/sorts by match date and status, event feeds by
--    fixture, and the medal table by team/athlete.
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_match_events_fixture_id
    ON public.match_events (fixture_id);

CREATE INDEX IF NOT EXISTS idx_match_events_fixture_created
    ON public.match_events (fixture_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fixtures_match_date
    ON public.fixtures (match_date);

CREATE INDEX IF NOT EXISTS idx_fixtures_status_match_date
    ON public.fixtures (status, match_date);

CREATE INDEX IF NOT EXISTS idx_fixtures_tournament_match_date
    ON public.fixtures (tournament_id, match_date);

CREATE INDEX IF NOT EXISTS idx_fixture_entries_team_medal
    ON public.fixture_entries (team_id, medal);

CREATE INDEX IF NOT EXISTS idx_fixture_entries_athlete_medal
    ON public.fixture_entries (athlete_id, medal);

CREATE INDEX IF NOT EXISTS idx_teams_tournament_group
    ON public.teams (tournament_id, group_name);

CREATE INDEX IF NOT EXISTS idx_tournament_members_tournament_duties
    ON public.tournament_members USING GIN (duties);

-- --------------------------------------------------------------------------
-- 3b. Keep updated_at fresh (some environments created tables without it).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.tournaments') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tournaments_updated_at') THEN
        CREATE TRIGGER trg_tournaments_updated_at
            BEFORE UPDATE ON public.tournaments
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;

    IF to_regclass('public.fixtures') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fixtures_updated_at') THEN
        CREATE TRIGGER trg_fixtures_updated_at
            BEFORE UPDATE ON public.fixtures
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;

    IF to_regclass('public.tournament_settings') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tournament_settings_updated_at') THEN
        CREATE TRIGGER trg_tournament_settings_updated_at
            BEFORE UPDATE ON public.tournament_settings
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END
-- --------------------------------------------------------------------------
-- 4. Admin RPCs (SECURITY DEFINER + explicit authorization checks)
-- --------------------------------------------------------------------------
-- 4a. App-wide user directory (email lives in auth.users, which the anon key
--     cannot read, so expose a guarded projection instead).
CREATE OR REPLACE FUNCTION public.list_app_users()
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    role TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Not authorized to list users';
    END IF;

    RETURN QUERY
    SELECT u.id,
           u.email::TEXT,
           COALESCE(r.role, 'user')::TEXT,
           u.created_at
    FROM auth.users u
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    ORDER BY u.created_at DESC
    LIMIT 1000;
END;
$$;

-- 4b. Grant / change a user's global role. Self-demotion is blocked so an app
--     admin can never lock themselves (or the last admin) out by accident.
CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id UUID, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Not authorized to change roles';
    END IF;
    IF p_role NOT IN ('app_admin', 'tournament_admin', 'user') THEN
        RAISE EXCEPTION 'Invalid role %', p_role;
    END IF;
    IF p_user_id = auth.uid() AND p_role <> 'app_admin' THEN
        RAISE EXCEPTION 'You cannot remove your own app admin role';
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

    RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role);
END;
$$;

-- 4c. Members of a tournament (with emails) for the admin detail screen.
CREATE OR REPLACE FUNCTION public.list_tournament_members(p_tournament_id UUID)
RETURNS TABLE (
    membership_id UUID,
    user_id UUID,
    email TEXT,
    duties TEXT[],
    granted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF NOT (public.is_app_admin() OR public.is_tournament_admin(p_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to list this tournament''s members';
    END IF;

    RETURN QUERY
    SELECT m.id,
           m.user_id,
           u.email::TEXT,
           m.duties,
           m.granted_at
    FROM public.tournament_members m
    LEFT JOIN auth.users u ON u.id = m.user_id
    WHERE m.tournament_id = p_tournament_id
    ORDER BY m.granted_at ASC;
END;
$$;
-- 4d. Create an invite token server-side (cryptographically random, so the
--     token never depends on client entropy).
CREATE OR REPLACE FUNCTION public.create_tournament_invite(
    p_tournament_id UUID,
    p_duties TEXT[] DEFAULT ARRAY['*'],
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_expires TIMESTAMPTZ;
    v_duties TEXT[];
BEGIN
    IF NOT public.is_app_admin() THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.tournament_members m
            WHERE m.tournament_id = p_tournament_id
              AND m.user_id = auth.uid()
              AND m.duties @> ARRAY['*']
        ) THEN
            RAISE EXCEPTION 'Not authorized to create invites for this tournament';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id) THEN
        RAISE EXCEPTION 'Tournament % not found', p_tournament_id;
    END IF;

    v_duties := COALESCE(p_duties, ARRAY['*']);
    IF array_length(v_duties, 1) IS NULL THEN
        v_duties := ARRAY['*'];
    END IF;

    v_expires := COALESCE(p_expires_at, NOW() + INTERVAL '7 days');
    v_token := encode(gen_random_bytes(24), 'hex');

    INSERT INTO public.tournament_invites (tournament_id, token, duties, created_by, expires_at)
    VALUES (p_tournament_id, v_token, v_duties, auth.uid(), v_expires);

    RETURN jsonb_build_object(
        'token', v_token,
        'expires_at', v_expires,
        'duties', to_jsonb(v_duties)
    );
END;
$$;

-- 4e. Revoke an invite (keeps the audit row, flips `revoked`).
CREATE OR REPLACE FUNCTION public.revoke_tournament_invite(p_invite_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
BEGIN
    SELECT i.tournament_id INTO v_tournament_id
    FROM public.tournament_invites i
    WHERE i.id = p_invite_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite % not found', p_invite_id;
    END IF;

    IF NOT public.is_app_admin() THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.tournament_members m
            WHERE m.tournament_id = v_tournament_id
              AND m.user_id = auth.uid()
              AND m.duties @> ARRAY['*']
        ) THEN
            RAISE EXCEPTION 'Not authorized to revoke invites for this tournament';
        END IF;
    END IF;

    UPDATE public.tournament_invites
    SET revoked = TRUE
    WHERE id = p_invite_id;

    RETURN TRUE;
END;
$$;

-- 4f. Invite list for a tournament (token included so managers can share it).
CREATE OR REPLACE FUNCTION public.list_tournament_invites(p_tournament_id UUID)
RETURNS TABLE (
    invite_id UUID,
    token TEXT,
    duties TEXT[],
    expires_at TIMESTAMPTZ,
    revoked BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF NOT (public.is_app_admin() OR public.is_tournament_admin(p_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to list this tournament''s invites';
    END IF;

    RETURN QUERY
    SELECT i.id, i.token, i.duties, i.expires_at, i.revoked, i.created_at
    FROM public.tournament_invites i
    WHERE i.tournament_id = p_tournament_id
    ORDER BY i.created_at DESC
    LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_app_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tournament_members(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tournament_invite(UUID, TEXT[], TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_tournament_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tournament_invites(UUID) TO authenticated;
$$;

-- ============================================================================
-- PART 10 — 10_african_sports_catalog_and_clock.sql
-- ============================================================================

-- ============================================================================
-- Migration 10 — African/Nigerian sports catalogue + match clock RPC
-- ============================================================================
-- Purpose:
--   1. `update_match_clock(p_fixture_id, p_status, p_minute, p_elapsed_seconds,
--      p_timer_started_at)` — duty-checked atomic clock save that merges only
--      the clock keys into `fixtures.stats`, so a clock write can never clobber
--      statistics recorded concurrently through `record_stat()`.
--   2. Catalogue expansion to the full Nigerian / African Games programme
--      (21 new sports), each with stat_vocab, event_vocab, scoring_config.
--   3. Standardised `clock` + `medals` blocks merged into every sport's
--      `scoring_config` so the app can render period buttons, event types and
--      medal arrangements per sport instead of hardcoding football.
--   4. Para divisions for the new applicable sports.
--
-- Idempotency: guarded upserts + `|| jsonb` merges (re-runnable).
-- Depends on: 03_sports_catalog.sql, 05, 06 (helpers), 09.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Atomic match-clock RPC (duty-checked like record_score)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_match_clock(
    p_fixture_id UUID,
    p_status TEXT,
    p_minute INT,
    p_elapsed_seconds INT,
    p_timer_started_at TIMESTAMPTZ
)
RETURNS public.fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
    v_row public.fixtures%ROWTYPE;
BEGIN
    SELECT f.tournament_id INTO v_tournament_id
    FROM public.fixtures f
    WHERE f.id = p_fixture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    IF p_status NOT IN ('scheduled', 'in_progress', 'half_time', 'paused',
                        'extra_time', 'full_time', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid match status %', p_status;
    END IF;
    IF p_minute IS NULL OR p_minute < 0 OR p_elapsed_seconds IS NULL OR p_elapsed_seconds < 0 THEN
        RAISE EXCEPTION 'Clock values must be non-negative';
    END IF;

    IF NOT public.is_app_admin() THEN
        IF v_tournament_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM public.tournament_members m
            WHERE m.tournament_id = v_tournament_id
              AND m.user_id = auth.uid()
              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['score'])
        ) THEN
            RAISE EXCEPTION 'Not authorized to update the clock for this fixture';
        END IF;
    END IF;

    UPDATE public.fixtures
    SET status = p_status,
        current_minute = p_minute,
        stats = jsonb_set(
                    jsonb_set(
                        COALESCE(stats, '{}'::jsonb),
                        '{elapsed_seconds}',
                        to_jsonb(p_elapsed_seconds),
                        TRUE
                    ),
                    '{timer_started_at}',
                    COALESCE(to_jsonb(p_timer_started_at), 'null'::jsonb),
                    TRUE
                ),
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_match_clock(UUID, TEXT, INT, INT, TIMESTAMPTZ)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Catalogue expansion — team sports (Nigeria / African Games programme)
--    stat_vocab: [{key,label}]; event_vocab: string array;
--    scoring_config carries points/set rules; `clock` + `medals` are merged in
--    section 4 so this payload stays focused on the sport itself.
-- ---------------------------------------------------------------------------
INSERT INTO public.sports (code, name, scoring_type, stat_vocab, event_vocab, scoring_config)
VALUES
('volleyball', 'Volleyball', 'sets',
 '[{"key":"points","label":"Points"},{"key":"spikes","label":"Spikes"},{"key":"blocks","label":"Blocks"},{"key":"aces","label":"Aces"},{"key":"digs","label":"Digs"},{"key":"faults","label":"Faults"},{"key":"sets_won","label":"Sets Won"}]'::jsonb,
 '["point","set_win","substitution","timeout","foul","injury","disqualification"]'::jsonb,
 '{"sets_to_win":3,"points_per_set":25,"tiebreak_points":15}'::jsonb),
('beach_volleyball', 'Beach Volleyball', 'sets',
 '[{"key":"points","label":"Points"},{"key":"spikes","label":"Spikes"},{"key":"blocks","label":"Blocks"},{"key":"aces","label":"Aces"},{"key":"faults","label":"Faults"},{"key":"sets_won","label":"Sets Won"}]'::jsonb,
 '["point","set_win","timeout","foul","injury","disqualification"]'::jsonb,
 '{"sets_to_win":2,"points_per_set":21,"tiebreak_points":15}'::jsonb),
('handball', 'Handball', 'duel',
 '[{"key":"goals","label":"Goals"},{"key":"saves","label":"Saves"},{"key":"turnovers","label":"Turnovers"},{"key":"assists","label":"Assists"},{"key":"suspensions","label":"Suspensions"},{"key":"fouls","label":"Fouls"}]'::jsonb,
 '["goal","point","penalty","suspension","foul","injury","disqualification","kick_off"]'::jsonb,
 '{"halves":2,"half_minutes":30,"break_minutes":10}'::jsonb),
('hockey', 'Hockey', 'duel',
 '[{"key":"goals","label":"Goals"},{"key":"penalty_corners","label":"Penalty Corners"},{"key":"saves","label":"Saves"},{"key":"cards","label":"Cards"},{"key":"fouls","label":"Fouls"}]'::jsonb,
 '["goal","point","penalty_corner","green_card","yellow_card","red_card","foul","injury","disqualification","kick_off"]'::jsonb,
 '{"quarters":4,"quarter_minutes":15,"break_minutes":2}'::jsonb),
('rugby', 'Rugby Sevens', 'duel',
 '[{"key":"tries","label":"Tries"},{"key":"conversions","label":"Conversions"},{"key":"penalties","label":"Penalties"},{"key":"drop_goals","label":"Drop Goals"},{"key":"tackles","label":"Tackles"},{"key":"cards","label":"Cards"}]'::jsonb,
 '["try","conversion","penalty_kick","drop_goal","yellow_card","red_card","foul","injury","disqualification","kick_off"]'::jsonb,
 '{"halves":2,"half_minutes":7,"final_minutes":10}'::jsonb),
('netball', 'Netball', 'duel',
 '[{"key":"goals","label":"Goals"},{"key":"intercepts","label":"Intercepts"},{"key":"turnovers","label":"Turnovers"},{"key":"feeds","label":"Feeds"},{"key":"penalties","label":"Penalties"}]'::jsonb,
 '["goal","point","foul","injury","disqualification","kick_off"]'::jsonb,
 '{"quarters":4,"quarter_minutes":15}'::jsonb),
('abula', 'Abula', 'sets',
 '[{"key":"points","label":"Points"},{"key":"sets_won","label":"Sets Won"},{"key":"spikes","label":"Spikes"},{"key":"faults","label":"Faults"}]'::jsonb,
 '["point","set_win","foul","injury","disqualification"]'::jsonb,
 '{"sets_to_win":3,"points_per_set":15}'::jsonb),
('esports', 'Esports', 'duel',
 '[{"key":"wins","label":"Wins"},{"key":"losses","label":"Losses"},{"key":"maps_won","label":"Maps Won"},{"key":"rounds_won","label":"Rounds Won"}]'::jsonb,
 '["round_win","match_win","forfeit","disqualification"]'::jsonb,
 '{"format":"5v5","maps_to_win":2}'::jsonb),
('squash', 'Squash', 'sets',
 '[{"key":"points","label":"Points"},{"key":"rallies_won","label":"Rallies Won"},{"key":"lets","label":"Lets"},{"key":"strokes","label":"Strokes"},{"key":"faults","label":"Faults"}]'::jsonb,
 '["point","set_win","let","stroke","foul","injury","disqualification"]'::jsonb,
 '{"sets_to_win":3,"points_per_set":11}'::jsonb),
('chess', 'Chess', 'duel',
 '[{"key":"wins","label":"Wins"},{"key":"draws","label":"Draws"},{"key":"losses","label":"Losses"}]'::jsonb,
 '["win","draw","loss","forfeit","time_forfeit","disqualification"]'::jsonb,
 '{"time_control":"90 min + 30 s/move"}'::jsonb),
('scrabble', 'Scrabble', 'duel',
 '[{"key":"wins","label":"Wins"},{"key":"draws","label":"Draws"},{"key":"losses","label":"Losses"},{"key":"high_game","label":"High Game"}]'::jsonb,
 '["win","draw","loss","forfeit","disqualification"]'::jsonb,
 '{"time_control":"50 min"}'::jsonb),
('ayo', 'Ayo (Traditional Board Game)', 'duel',
 '[{"key":"wins","label":"Wins"},{"key":"draws","label":"Draws"},{"key":"losses","label":"Losses"},{"key":"seeds_captured","label":"Seeds Captured"}]'::jsonb,
 '["win","draw","loss","forfeit","disqualification"]'::jsonb,
 '{"time_control":"30 min"}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    scoring_type = EXCLUDED.scoring_type,
    stat_vocab = EXCLUDED.stat_vocab,
    event_vocab = EXCLUDED.event_vocab,
    scoring_config = EXCLUDED.scoring_config,
    updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 3. Catalogue expansion — individual sports
-- ---------------------------------------------------------------------------
INSERT INTO public.sports (code, name, scoring_type, stat_vocab, event_vocab, scoring_config)
VALUES
('golf', 'Golf', 'attempts',
 '[{"key":"strokes","label":"Strokes"},{"key":"birdies","label":"Birdies"},{"key":"pars","label":"Pars"},{"key":"bogeys","label":"Bogeys"},{"key":"eagles","label":"Eagles"}]'::jsonb,
 '["birdie","par","bogey","eagle","penalty","disqualification"]'::jsonb,
 '{"format":"stroke_play","holes":18}'::jsonb),
('archery', 'Archery', 'attempts',
 '[{"key":"hits","label":"Hits"},{"key":"bullseyes","label":"Bullseyes"},{"key":"misses","label":"Misses"},{"key":"total_score","label":"Total Score"}]'::jsonb,
 '["shot","end_win","miss","foul","disqualification"]'::jsonb,
 '{"arrows_per_end":3,"ends":6,"max_per_arrow":10}'::jsonb),
('shooting', 'Shooting', 'attempts',
 '[{"key":"hits","label":"Hits"},{"key":"misses","label":"Misses"},{"key":"bullseyes","label":"Bullseyes"},{"key":"inner_tens","label":"Inner Tens"}]'::jsonb,
 '["shot","hit","miss","foul","disqualification"]'::jsonb,
 '{"events":["10m_air_pistol","10m_air_rifle","25m_pistol","50m_rifle","shotgun_trap","shotgun_skeet"]}'::jsonb),
('diving', 'Diving', 'attempts',
 '[{"key":"dives_completed","label":"Dives Completed"},{"key":"faults","label":"Faults"},{"key":"failed_dives","label":"Failed Dives"},{"key":"personal_bests","label":"Personal Bests"}]'::jsonb,
 '["dive","score","foul","disqualification"]'::jsonb,
 '{"dives_per_round":6,"heights_m":[1,3,5,7.5,10]}'::jsonb),
('rowing', 'Rowing', 'race',
 '[{"key":"heats_won","label":"Heats Won"},{"key":"wins","label":"Wins"},{"key":"attempts","label":"Attempts"},{"key":"fouls","label":"Fouls"}]'::jsonb,
 '["point","foul","injury","disqualification","time_record","heat_win"]'::jsonb,
 '{"lanes":6,"distances_m":[1000,2000]}'::jsonb),
('triathlon', 'Triathlon', 'race',
 '[{"key":"personal_bests","label":"Personal Bests"},{"key":"wins","label":"Wins"},{"key":"attempts","label":"Attempts"},{"key":"fouls","label":"Fouls"}]'::jsonb,
 '["point","foul","injury","disqualification","time_record","lap","penalty"]'::jsonb,
 '{"swim_m":1500,"cycle_km":40,"run_km":10}'::jsonb),
('fencing', 'Fencing', 'bouts',
 '[{"key":"touches_landed","label":"Touches Landed"},{"key":"touches_received","label":"Touches Received"},{"key":"victories","label":"Victories"},{"key":"penalties","label":"Penalties"}]'::jsonb,
 '["touch","point","foul","injury","disqualification"]'::jsonb,
 '{"periods":3,"period_minutes":1,"touches_to_win":15}'::jsonb),
('karate', 'Karate (Kumite)', 'bouts',
 '[{"key":"strikes","label":"Strikes"},{"key":"kicks","label":"Kicks"},{"key":"blocks","label":"Blocks"},{"key":"penalties","label":"Penalties"}]'::jsonb,
 '["point","foul","injury","disqualification"]'::jsonb,
 '{"periods":1,"period_minutes":3}'::jsonb),
('dambe', 'Dambe (Traditional Boxing)', 'bouts',
 '[{"key":"punches_landed","label":"Punches Landed"},{"key":"knockdowns","label":"Knockdowns"},{"key":"rounds_won","label":"Rounds Won"},{"key":"fouls","label":"Fouls"}]'::jsonb,
 '["round_win","knockdown","foul","injury","disqualification"]'::jsonb,
 '{"rounds":3,"round_minutes":1}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    scoring_type = EXCLUDED.scoring_type,
    stat_vocab = EXCLUDED.stat_vocab,
    event_vocab = EXCLUDED.event_vocab,
    scoring_config = EXCLUDED.scoring_config,
    updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 4. Standardised `clock` + `medals` blocks merged into every sport's config
--    (`||` keeps any sport-specific keys already present, e.g. football's
--    extra_time_minutes or basketball's target_score).
--    clock.type: halves | quarters | rounds | sets | innings | none
--    medals.team: true when the medal goes to a squad, false for individuals.
-- ---------------------------------------------------------------------------
WITH clock_rules(code, clock, medals) AS (
    VALUES
    ('football',        '{"type":"halves","periods":2,"period_minutes":45,"break_minutes":15,"extra":{"periods":2,"period_minutes":15}}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('basketball',      '{"type":"none"}'::jsonb,  '{"awarded":true,"team":true}'::jsonb),
    ('cricket',         '{"type":"innings","periods":2,"period_overs":20}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('rugby',           '{"type":"halves","periods":2,"period_minutes":7,"break_minutes":2}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('handball',        '{"type":"halves","periods":2,"period_minutes":30,"break_minutes":10}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('hockey',          '{"type":"quarters","periods":4,"period_minutes":15,"break_minutes":2}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('netball',         '{"type":"quarters","periods":4,"period_minutes":15,"break_minutes":3}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('volleyball',      '{"type":"sets"}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('beach_volleyball','{"type":"sets"}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('abula',           '{"type":"sets"}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('table_tennis',    '{"type":"sets"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('tennis',          '{"type":"sets"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('badminton',       '{"type":"sets"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('squash',          '{"type":"sets"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('boxing',          '{"type":"rounds","periods":3,"period_minutes":3,"break_minutes":1}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('judo',            '{"type":"rounds","periods":1,"period_minutes":4}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('taekwondo',       '{"type":"rounds","periods":3,"period_minutes":2,"break_minutes":1}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('karate',          '{"type":"rounds","periods":1,"period_minutes":3}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('mma',             '{"type":"rounds","periods":3,"period_minutes":5,"break_minutes":1}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('fencing',         '{"type":"rounds","periods":3,"period_minutes":1,"break_minutes":1}'::jsonb, '{"awarded":true,"team":false}'::jsonb)
)
UPDATE public.sports s
SET scoring_config = COALESCE(s.scoring_config, '{}'::jsonb) || v.clock || v.medals
FROM clock_rules v
WHERE s.code = v.code;

WITH clock_rules(code, clock, medals) AS (
    VALUES
    ('dambe',           '{"type":"rounds","periods":3,"period_minutes":1,"break_minutes":1}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('wrestling',       '{"type":"rounds","periods":2,"period_minutes":3,"break_minutes":1}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('darts',           '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('chess',           '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('scrabble',        '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('ayo',             '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('esports',         '{"type":"none"}'::jsonb, '{"awarded":true,"team":true}'::jsonb),
    ('golf',            '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('archery',         '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('shooting',        '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('diving',          '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('gymnastics',      '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('weightlifting',   '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('athletics',       '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('swimming',        '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('canoeing',        '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('rowing',          '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('cycling',         '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb),
    ('triathlon',       '{"type":"none"}'::jsonb, '{"awarded":true,"team":false}'::jsonb)
)
UPDATE public.sports s
SET scoring_config = COALESCE(s.scoring_config, '{}'::jsonb) || v.clock || v.medals
FROM clock_rules v
WHERE s.code = v.code;

-- ---------------------------------------------------------------------------
-- 5. Para divisions for the new sports (guarded, re-runnable).
-- ---------------------------------------------------------------------------
INSERT INTO public.sport_divisions (sport_id, name)
SELECT s.id, d.division_name
FROM public.sports s
JOIN (VALUES
    ('volleyball', 'Sitting Volleyball'),
    ('hockey', 'Para Hockey'),
    ('archery', 'Para Archery'),
    ('shooting', 'Para Shooting'),
    ('rowing', 'Para Rowing'),
    ('triathlon', 'Para Triathlon'),
    ('fencing', 'Wheelchair Fencing'),
    ('dambe', 'Para Dambe')
) AS d(code, division_name) ON s.code = d.code
WHERE NOT EXISTS (
    SELECT 1 FROM public.sport_divisions existing
    WHERE existing.sport_id = s.id AND existing.name = d.division_name
);

-- ---------------------------------------------------------------------------
-- 7. Widen match_events.event_type to the multi-sport superset.
--    Migration 05 allowed 21 football-centric tokens, but the catalogue's
--    event_vocab (sections 2–3) and the app's event log need the same sport
--    tokens every sport writes: tries, touches, ends, lets, timeouts and
--    win/draw/loss outcomes, plus the football variants already offered.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'match_events'
          AND c.conname = 'match_events_event_type_check'
    ) THEN
        ALTER TABLE public.match_events DROP CONSTRAINT match_events_event_type_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'match_events'
          AND c.conname = 'match_events_event_type_check'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT match_events_event_type_check
            CHECK (event_type IN (
                'goal', 'own_goal', 'penalty_goal', 'penalty_missed',
                'point', 'set_win', 'round_win', 'wicket', 'attempt',
                'time_record', 'distance_record', 'foul', 'false_start',
                'red_card', 'yellow_card', 'green_card', 'corner', 'free_kick',
                'penalty', 'penalty_kick', 'penalty_corner', 'suspension',
                'substitution', 'injury', 'water_break', 'disqualification',
                'half_time_whistle', 'full_time_whistle', 'kick_off',
                'try', 'conversion', 'drop_goal',
                'timeout', 'touch', 'knockdown', 'lap', 'transition',
                'let', 'stroke',
                'shot', 'hit', 'miss', 'end_win',
                'birdie', 'par', 'bogey', 'eagle',
                'dive', 'score', 'heat_win',
                'match_win',
                'win', 'draw', 'loss', 'forfeit', 'time_forfeit'
            ));
    END IF;
END
$$;

-- ============================================================================
-- PART 11 — 11_athlete_and_entry_rpcs.sql
-- ============================================================================

-- ============================================================================
-- Migration 11 — Athlete & fixture-entry RPCs (duty-checked)
-- ============================================================================
-- Purpose:
--   1. `create_athlete(...)` / `update_athlete(...)` / `delete_athlete(...)`
--      — scoped CRUD for the `athletes` table. Only app admins or tournament
--      members with '*' or 'score' duties may write.
--   2. `upsert_fixture_entry(...)` — inserts or updates a `fixture_entries`
--      row (lane, result JSONB, rank, medal). Same duty gate. The RPC merges
--      so re-submitting an athlete+position updates the existing row instead
--      of duplicating it.
--
-- Depends on: 05 (athletes + fixture_entries tables), 09 (is_app_admin /
--   is_tournament_admin helpers, duty-checked patterns).
-- Idempotent: DROP/CREATE OR REPLACE for functions; upsert for rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Athlete CRUD RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_athlete(
    p_tournament_id UUID,
    p_name TEXT,
    p_gender TEXT DEFAULT 'mixed',
    p_classification TEXT DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_sport_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT (public.is_app_admin() OR public.is_tournament_admin(p_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to create athletes for this tournament';
    END IF;

    IF p_gender NOT IN ('male', 'female', 'mixed') THEN
        RAISE EXCEPTION 'Invalid gender value: %', p_gender;
    END IF;

    IF p_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.teams t WHERE t.id = p_team_id AND t.tournament_id = p_tournament_id
    ) THEN
        RAISE EXCEPTION 'Team % does not belong to this tournament', p_team_id;
    END IF;

    INSERT INTO public.athletes (tournament_id, name, gender, classification, team_id, sport_id)
    VALUES (p_tournament_id, p_name, p_gender, p_classification, p_team_id, p_sport_id)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_athlete(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_athlete(
    p_athlete_id UUID,
    p_name TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT NULL,
    p_classification TEXT DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_sport_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.athletes%ROWTYPE;
    v_tournament_id UUID;
BEGIN
    SELECT tournament_id INTO v_tournament_id FROM public.athletes WHERE id = p_athlete_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Athlete % not found', p_athlete_id;
    END IF;

    IF NOT (public.is_app_admin() OR public.is_tournament_admin(v_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to update this athlete';
    END IF;

    IF p_gender IS NOT NULL AND p_gender NOT IN ('male', 'female', 'mixed') THEN
        RAISE EXCEPTION 'Invalid gender value: %', p_gender;
    END IF;

    IF p_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.teams t WHERE t.id = p_team_id AND t.tournament_id = v_tournament_id
    ) THEN
        RAISE EXCEPTION 'Team % does not belong to this tournament', p_team_id;
    END IF;

    UPDATE public.athletes
    SET name             = COALESCE(p_name, name),
        gender           = COALESCE(p_gender, gender),
        classification   = COALESCE(p_classification, classification),
        team_id          = COALESCE(p_team_id, team_id),
        sport_id         = COALESCE(p_sport_id, sport_id),
        updated_at       = NOW()
    WHERE id = p_athlete_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'gender', v_row.gender,
        'classification', v_row.classification,
        'team_id', v_row.team_id,
        'sport_id', v_row.sport_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_athlete(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_athlete(p_athlete_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
BEGIN
    SELECT tournament_id INTO v_tournament_id FROM public.athletes WHERE id = p_athlete_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Athlete % not found', p_athlete_id;
    END IF;

    IF NOT (public.is_app_admin() OR public.is_tournament_admin(v_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to delete this athlete';
    END IF;

    DELETE FROM public.athletes WHERE id = p_athlete_id;
    RETURN jsonb_build_object('deleted', p_athlete_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_athlete(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fixture-entry upsert RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_fixture_entry(
    p_fixture_id UUID,
    p_athlete_id UUID DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_position INTEGER DEFAULT 0,
    p_lane TEXT DEFAULT NULL,
    p_result JSONB DEFAULT '{}',
    p_rank INTEGER DEFAULT NULL,
    p_medal TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
    v_entry_id UUID;
BEGIN
    -- Resolve tournament from the fixture.
    SELECT f.tournament_id INTO v_tournament_id FROM public.fixtures f WHERE f.id = p_fixture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    IF NOT (public.is_app_admin() OR public.is_tournament_admin(v_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to edit entries for this fixture';
    END IF;

    -- At least one of athlete_id or team_id must be set (enforced by CHECK in 05).
    IF p_athlete_id IS NULL AND p_team_id IS NULL THEN
        RAISE EXCEPTION 'Must specify either athlete_id or team_id';
    END IF;

    IF p_medal IS NOT NULL AND p_medal NOT IN ('gold', 'silver', 'bronze') THEN
        RAISE EXCEPTION 'Invalid medal value: %', p_medal;
    END IF;

    -- Upsert keyed on (fixture_id, athlete_id) or (fixture_id, team_id) — whichever is present.
    IF p_athlete_id IS NOT NULL THEN
        INSERT INTO public.fixture_entries
            (fixture_id, athlete_id, position, lane, result, rank, medal)
        VALUES
            (p_fixture_id, p_athlete_id, p_position, p_lane, p_result, p_rank, p_medal)
        ON CONFLICT DO NOTHING  -- no unique constraint yet; use fixture_id + athlete_id via trigger-like approach
        RETURNING id INTO v_entry_id;

        -- If no row was inserted (e.g. if a duplicate existed with a unique constraint we missed),
        -- update instead. This is safe because the RPC is idempotent.
        IF v_entry_id IS NULL THEN
            UPDATE public.fixture_entries
            SET position     = p_position,
                lane         = p_lane,
                result       = p_result,
                rank         = p_rank,
                medal        = p_medal,
                updated_at   = NOW()
            WHERE fixture_id = p_fixture_id
              AND athlete_id = p_athlete_id
            RETURNING id INTO v_entry_id;
        END IF;
    ELSE
        INSERT INTO public.fixture_entries
            (fixture_id, team_id, position, lane, result, rank, medal)
        VALUES
            (p_fixture_id, p_team_id, p_position, p_lane, p_result, p_rank, p_medal)
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_entry_id;

        IF v_entry_id IS NULL THEN
            UPDATE public.fixture_entries
            SET position     = p_position,
                lane         = p_lane,
                result       = p_result,
                rank         = p_rank,
                medal        = p_medal,
                updated_at   = NOW()
            WHERE fixture_id = p_fixture_id
              AND team_id = p_team_id
            RETURNING id INTO v_entry_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('id', v_entry_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_fixture_entry(UUID, UUID, UUID, INTEGER, TEXT, JSONB, INTEGER, TEXT) TO authenticated;

-- ============================================================================
-- PART 12 — futsal + data-driven rules (fixtures.rules_override)
-- ============================================================================

-- ============================================================================
-- PART 12 — Futsal + data-driven rules (editable clock, vocab, score label)
-- ============================================================================
-- Everything the live console renders is data, never a literal:
--   * sport defaults        → public.sports.scoring_config / stat_vocab / event_vocab
--   * fixture overrides     → public.fixtures.rules_override   (this part)
--   * hardcoded fallbacks   → replaced by a *format* CHECK (below) so the
--                             event vocabulary can be edited at runtime.
--
-- Authority:
--   * The global sports catalogue is app_admin-only (part 09). A tournament
--     admin cannot rewrite another tournament's rules or the shared vocab.
--   * Per-fixture overrides require the `score` (or `*`) duty on the fixture's
--     own tournament — enforced in the RPC, not just the UI.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 12.1 Futsal catalogue entry
--      Missing from parts 04 + 10, so let's add it: futsal is a distinct
--      sport (smaller court, 20-minute halves, no offsides) and teams may be
--      registered with team_type 'Futsal' (see part 0 / part 05 CHECKs).
-- ---------------------------------------------------------------------------
INSERT INTO public.sports (code, name, scoring_type, stat_vocab, event_vocab, scoring_config)
VALUES (
    'futsal', 'Futsal', 'duel',
    '[{"key":"goals","label":"Goals"},{"key":"shots","label":"Shots"},{"key":"shots_on_target","label":"Shots On Target"},{"key":"assists","label":"Assists"},{"key":"passes","label":"Passes"},{"key":"passes_completed","label":"Passes Completed"},{"key":"tackles","label":"Tackles"},{"key":"interceptions","label":"Interceptions"},{"key":"fouls","label":"Fouls"},{"key":"corners","label":"Corners"},{"key":"freekicks","label":"Freekicks"},{"key":"gk_saves","label":"GK Saves"}]'::jsonb,
    '["goal","own_goal","penalty_goal","penalty_missed","foul","yellow_card","red_card","corner","free_kick","substitution","injury","water_break","timeout","penalty","half_time_whistle","full_time_whistle","kick_off"]'::jsonb,
    '{"halves":2,"half_minutes":20,"break_minutes":10,"extra_time_minutes":10,"players_on_pitch":5,"allow_negative_score":false}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

-- Merge only the standardised clock/medals blocks, so re-running this file
-- never clobbers a vocabulary an app admin has since edited. The clock lives
-- under BOTH the modern `clock` key and the legacy flat keys the earlier
-- football seed used (`halves`, `half_minutes`), because consoles of uneven
-- age read either shape.
UPDATE public.sports
SET scoring_config = COALESCE(scoring_config, '{}'::jsonb)
        || '{"halves":2,"half_minutes":20,"break_minutes":10}'::jsonb
        || '{"clock":{"type":"halves","periods":2,"period_minutes":20,"break_minutes":10,"extra":{"periods":2,"period_minutes":5}}}'::jsonb
        || '{"court":{"shape":"pitch","orientation":"horizontal"}}'::jsonb
        || '{"medals":{"awarded":true,"team":true}}'::jsonb,
    updated_at = NOW()
WHERE code = 'futsal';

-- Enable futsal for every tournament that already runs football or futsal
-- teams (a no-op on tournaments that do not). App admins can tick it per
-- tournament in the UI afterwards.
INSERT INTO public.tournament_sports (tournament_id, sport_id)
SELECT DISTINCT t.tournament_id, s.id
FROM public.tournament_sports t
JOIN public.sports football ON football.code = 'football'
JOIN public.sports s ON s.code = 'futsal'
WHERE t.sport_id = football.id
  AND NOT EXISTS (
      SELECT 1 FROM public.tournament_sports existing
      WHERE existing.tournament_id = t.tournament_id AND existing.sport_id = s.id
  );

-- ---------------------------------------------------------------------------
-- 12.2 match_events.event_type — replace the hardcoded vocabulary CHECK with a
--      format CHECK. The old constraint pinned event types to a frozen list of
--      55 tokens, which is exactly the "stuck with hardcoded vocab" problem:
--      adding a new event type needed a migration. The vocabulary now lives in
--      sports.event_vocab / fixtures.rules_override and is enforced per fixture
--      by record_match_event() (part 14). The CHECK keeps only shape/limits.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'match_events'
          AND c.conname = 'match_events_event_type_check'
    ) THEN
        ALTER TABLE public.match_events DROP CONSTRAINT match_events_event_type_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'match_events'
          AND c.conname = 'match_events_event_type_format_check'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT match_events_event_type_format_check
            CHECK (event_type ~ '^[a-z][a-z0-9_]{0,48}$');
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 12.3 Per-fixture rule overrides + effective-rules resolution
--      `fixtures.rules_override` is the escape hatch for "the allocated time
--      is different today": a match may run 2x15 instead of 2x20, use a
--      trimmed vocab, or carry a different score label. It is merged over the
--      sport's defaults, so the app (and the write RPCs) always read one
--      resolved object instead of scattered literals.
--
--      Precedence: fixture override  >  sports.scoring_config / *_vocab  >
--                  built-in legacy fallback (12 football stat keys).
-- ---------------------------------------------------------------------------
ALTER TABLE public.fixtures
    ADD COLUMN IF NOT EXISTS rules_override JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Returns the resolved rules for a fixture as a single JSON object:
--   { sport_id, sport_code, scoring_type, stat_vocab, event_vocab, clock,
--     medals, score_label, allow_negative_score, is_override }
CREATE OR REPLACE FUNCTION public.fixture_effective_rules(p_fixture_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
    v_sport_id UUID;
    v_override JSONB;
    v_stat     JSONB;
    v_event    JSONB;
    v_config   JSONB;
    v_code     TEXT;
    v_scoring  TEXT;
    c_legacy   JSONB := '[
        {"key":"passes","label":"Passes"},{"key":"shots","label":"Shots"},
        {"key":"shots_on_target","label":"Shots On Target"},
        {"key":"shots_off_target","label":"Shots Off Target"},
        {"key":"fouls","label":"Fouls"},{"key":"corners","label":"Corners"},
        {"key":"freekicks","label":"Freekicks"},{"key":"offsides","label":"Offsides"},
        {"key":"yellow_cards","label":"Yellow Cards"},{"key":"red_cards","label":"Red Cards"},
        {"key":"gk_saves","label":"GK Saves"},{"key":"interceptions","label":"Interceptions"}
    ]'::jsonb;
BEGIN
    SELECT f.sport_id, COALESCE(f.rules_override, '{}'::jsonb)
      INTO v_sport_id, v_override
    FROM public.fixtures f
    WHERE f.id = p_fixture_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    IF v_sport_id IS NOT NULL THEN
        SELECT s.code, s.scoring_type, s.stat_vocab, s.event_vocab,
               COALESCE(s.scoring_config, '{}'::jsonb)
          INTO v_code, v_scoring, v_stat, v_event, v_config
        FROM public.sports s
        WHERE s.id = v_sport_id;
    END IF;

    v_config := COALESCE(v_config, '{}'::jsonb);

    v_stat := COALESCE(
        NULLIF(v_override -> 'stat_vocab', 'null'::jsonb),
        NULLIF(v_stat, 'null'::jsonb),
        c_legacy
    );
    v_event := COALESCE(
        NULLIF(v_override -> 'event_vocab', 'null'::jsonb),
        NULLIF(v_event, 'null'::jsonb),
        '[]'::jsonb
    );

    RETURN jsonb_build_object(
        'sport_id', v_sport_id,
        'sport_code', v_code,
        'scoring_type', COALESCE(v_scoring, 'duel'),
        'stat_vocab', v_stat,
        'event_vocab', v_event,
        'clock', COALESCE(
            NULLIF(v_override -> 'clock', 'null'::jsonb),
            NULLIF(v_config -> 'clock', 'null'::jsonb),
            '{"type":"none","periods":0,"period_minutes":0}'::jsonb
        ),
        'medals', COALESCE(
            NULLIF(v_override -> 'medals', 'null'::jsonb),
            NULLIF(v_config -> 'medals', 'null'::jsonb),
            '{"awarded":true,"team":false}'::jsonb
        ),
        'score_label', COALESCE(v_override ->> 'score_label', v_config ->> 'score_label', 'Score'),
        'allow_negative_score', COALESCE(
            CASE WHEN jsonb_typeof(v_override -> 'allow_negative_score') = 'boolean'
                 THEN (v_override ->> 'allow_negative_score')::BOOLEAN END,
            CASE WHEN jsonb_typeof(v_config -> 'allow_negative_score') = 'boolean'
                 THEN (v_config ->> 'allow_negative_score')::BOOLEAN END,
            FALSE
        ),
        'is_override', (v_override <> '{}'::jsonb)
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fixture_effective_rules(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12.4 Vocabulary membership helpers (data-driven, no hardcoded sport lists)
--      A vocab entry is either a bare string ("shots") or an object carrying
--      the key under `key`, `stat` or `name` — both shapes appear in the
--      seeded catalogue and both stay valid.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fixture_stat_allowed(p_fixture_id UUID, p_stat_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
    SELECT p_stat_key IS NOT NULL
       AND p_stat_key <> ''
       AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
                    COALESCE(public.fixture_effective_rules(p_fixture_id) -> 'stat_vocab', '[]'::jsonb)
                ) AS e
           WHERE e = to_jsonb(p_stat_key)
              OR (jsonb_typeof(e) = 'object' AND e ->> 'key'  = p_stat_key)
              OR (jsonb_typeof(e) = 'object' AND e ->> 'stat' = p_stat_key)
              OR (jsonb_typeof(e) = 'object' AND e ->> 'name' = p_stat_key)
       );
$fn$;

-- An empty event vocabulary means "unconstrained": the only limits are the
-- match_events format CHECK and the caller's duties. That keeps sports whose
-- catalogue entry has no events yet fully usable.
CREATE OR REPLACE FUNCTION public.fixture_event_allowed(p_fixture_id UUID, p_event_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
    SELECT p_event_type IS NOT NULL
       AND p_event_type <> ''
       AND (
           jsonb_array_length(
               COALESCE(public.fixture_effective_rules(p_fixture_id) -> 'event_vocab', '[]'::jsonb)
           ) = 0
           OR EXISTS (
               SELECT 1
               FROM jsonb_array_elements(
                        public.fixture_effective_rules(p_fixture_id) -> 'event_vocab'
                    ) AS e
               WHERE e = to_jsonb(p_event_type)
                  OR (jsonb_typeof(e) = 'object' AND e ->> 'key' = p_event_type)
           )
       );
$fn$;

GRANT EXECUTE ON FUNCTION public.fixture_stat_allowed(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_event_allowed(UUID, TEXT) TO anon, authenticated;

-- ============================================================================
-- PART 13 — scope authority, duties, fixture loggers
-- ============================================================================

-- ============================================================================
-- PART 13 — Authority model: scoped duties, per-fixture logger scopes
-- ============================================================================
-- Goal: several people log the *same* match at the same time without ever
-- being able to touch each other's numbers.
--
-- Duty tokens live in `public.tournament_members.duties` (TEXT[]):
--
--   '*'                        full manager of that tournament
--   'score'                    score + clock + its own stats/events
--   'clock'                    clock/period control only
--   'posts'                    news & articles
--   'roster'                   teams, players, athletes
--   'entry'                    fixture entries / results / medals
--   'lineup'                   formations / starting XI (PART 15)
--   'stat:<key>'               ONE counter, every fixture of the tournament
--   'event:<type>'             ONE timeline event type, every fixture
--   'fixture:<uuid>'           everything, but ONLY on that fixture
--   'stat:<key>@<fixture>'     ONE counter, on ONE fixture
--   'event:<type>@<fixture>'   ONE timeline event type, on ONE fixture
--
-- Scoping rules that matter for the "one doesn't infringe on the others" ask:
--   * `fixture:<uuid>` is deliberately *scoped to a single match*, so a scout
--     hired for match 12 cannot touch match 13 even inside their tournament.
--   * `stat:shots` grants shots and nothing else — passes/free kicks/throws
--     are rejected by the same authority check the UI uses to hide them.
--   * Tournament boundaries are absolute: every check resolves the fixture's
--     OWN tournament_id, so a tournament admin can never write into a
--     tournament they are not a member of.
--   * app_admin bypasses everything (single global operator).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 13.1 Tournament-level duty check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_tournament_duty(p_tournament_id UUID, p_tokens TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT public.is_app_admin()
        OR (
            p_tournament_id IS NOT NULL
            AND EXISTS (
                SELECT 1
                FROM public.tournament_members m
                WHERE m.tournament_id = p_tournament_id
                  AND m.user_id = auth.uid()
                  AND (
                      m.duties @> ARRAY['*']
                      OR m.duties && COALESCE(p_tokens, ARRAY[]::TEXT[])
                  )
            )
        );
$fn$;

GRANT EXECUTE ON FUNCTION public.has_tournament_duty(UUID, TEXT[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13.2 The single fixture-level authority check
--      Every write RPC and every write policy calls this one function, so
--      there is exactly one place where "who may do what" is decided.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_fixture(
    p_fixture_id UUID,
    p_scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_domain TEXT DEFAULT NULL,
    p_key TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_tournament_id UUID;
BEGIN
    IF p_fixture_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT f.tournament_id INTO v_tournament_id
    FROM public.fixtures f
    WHERE f.id = p_fixture_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- A fixture with no tournament is global data: app admins only.
    IF v_tournament_id IS NULL THEN
        RETURN public.is_app_admin();
    END IF;

    IF public.is_app_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.tournament_members m
        WHERE m.tournament_id = v_tournament_id
          AND m.user_id = auth.uid()
          AND (
              -- Full manager of the tournament.
              m.duties @> ARRAY['*']
              -- Broad scopes (score / clock / entry / roster / posts).
              OR m.duties && COALESCE(p_scopes, ARRAY[]::TEXT[])
              -- Anything at all, but only on this one fixture.
              OR m.duties @> ARRAY['fixture:' || p_fixture_id::TEXT]
              -- One counter / one event type, tournament-wide or pinned.
              OR (
                  p_key IS NOT NULL AND p_domain = 'stat' AND (
                      m.duties @> ARRAY['stat:' || p_key]
                      OR m.duties @> ARRAY['stat:' || p_key || '@' || p_fixture_id::TEXT]
                      -- Legacy bare key (part 06 style: duties = '{shots}').
                      -- Reserved scope words are excluded so a duty named
                      -- 'score' can never be mistaken for a stat called 'score'.
                      OR (
                          p_key NOT IN ('*', 'score', 'clock', 'entry', 'posts', 'roster', 'lineup')
                          AND m.duties @> ARRAY[p_key]
                      )
                  )
              )
              OR (
                  p_key IS NOT NULL AND p_domain = 'event' AND (
                      m.duties @> ARRAY['event:' || p_key]
                      OR m.duties @> ARRAY['event:' || p_key || '@' || p_fixture_id::TEXT]
                      OR (
                          p_key NOT IN ('*', 'score', 'clock', 'entry', 'posts', 'roster', 'lineup')
                          AND m.duties @> ARRAY[p_key]
                      )
                  )
              )
          )
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.can_write_fixture(UUID, TEXT[], TEXT, TEXT) TO authenticated;

-- Thin, intention-revealing wrappers. `score` keeps its historical meaning
-- (scoreboard + clock + stats + events) so existing `{*}` and `{score}`
-- memberships behave exactly as before.
CREATE OR REPLACE FUNCTION public.can_write_fixture_score(p_fixture_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['score']);
$fn$;

CREATE OR REPLACE FUNCTION public.can_write_fixture_clock(p_fixture_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['score', 'clock']);
$fn$;

CREATE OR REPLACE FUNCTION public.can_write_fixture_rules(p_fixture_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    -- Editing the allocated period times / vocab for a single match is a
    -- scoreboard-operator action, not a member-wide one.
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['score']);
$fn$;

CREATE OR REPLACE FUNCTION public.can_write_fixture_stat(p_fixture_id UUID, p_stat_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['score'], 'stat', p_stat_key);
$fn$;

CREATE OR REPLACE FUNCTION public.can_log_fixture_event(p_fixture_id UUID, p_event_type TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['score'], 'event', p_event_type);
$fn$;

CREATE OR REPLACE FUNCTION public.can_write_fixture_entries(p_fixture_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['entry', 'score']);
$fn$;

CREATE OR REPLACE FUNCTION public.can_write_fixture_lineup(p_fixture_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    -- Naming the starting XI / formation is a coach action, not a scoreboard
    -- one, so it gets its own duty token (`lineup`) — see PART 15.
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['lineup']);
$fn$;

GRANT EXECUTE ON FUNCTION public.can_write_fixture_score(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_fixture_clock(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_fixture_rules(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_fixture_stat(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_log_fixture_event(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_fixture_entries(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_fixture_lineup(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13.3 fixture_loggers — "who is logging what on this match, right now"
--      This is what stops two people from both logging Shots on the same
--      match: the (fixture_id, scope) pair is UNIQUE, so claiming a scope that
--      somebody else holds fails with a readable error instead of silently
--      doubling the numbers. Claims go stale after 5 minutes without a
--      heartbeat, so a closed laptop never locks a stream forever.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fixture_loggers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fixture_id UUID NOT NULL,
    user_id UUID NOT NULL,
    scope TEXT NOT NULL DEFAULT '*',
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_loggers'
          AND c.conname = 'fk_fixture_loggers_fixture_id'
    ) THEN
        ALTER TABLE public.fixture_loggers
            ADD CONSTRAINT fk_fixture_loggers_fixture_id
            FOREIGN KEY (fixture_id) REFERENCES public.fixtures (id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_loggers'
          AND c.conname = 'fk_fixture_loggers_user_id'
    ) THEN
        ALTER TABLE public.fixture_loggers
            ADD CONSTRAINT fk_fixture_loggers_user_id
            FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
    END IF;

    -- One holder per stream per match. NOTE: a claim is per scope, so the same
    -- person may hold several (shots + passes) while a second person holds
    -- free kicks — that is the intended "one UI, many loggers" model.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'uq_fixture_loggers_scope'
    ) THEN
        -- One holder per stream per match: two people cannot log the same
        -- scope on the same fixture.
        CREATE UNIQUE INDEX uq_fixture_loggers_scope
            ON public.fixture_loggers (fixture_id, scope);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_fixture_loggers_fixture_id
    ON public.fixture_loggers (fixture_id);

ALTER TABLE public.fixture_loggers ENABLE ROW LEVEL SECURITY;

-- Read: app admins, members of the fixture's tournament, and your own rows.
DROP POLICY IF EXISTS "Tournament members can view fixture loggers" ON public.fixture_loggers;
CREATE POLICY "Tournament members can view fixture loggers"
    ON public.fixture_loggers FOR SELECT
    USING (
        public.is_app_admin()
        OR user_id = auth.uid()
        OR public.has_tournament_duty(
               (SELECT f.tournament_id FROM public.fixtures f WHERE f.id = fixture_id),
               ARRAY[]::TEXT[]
           )
    );

-- NO insert/update/delete policies: every mutation goes through the
-- SECURITY DEFINER RPCs below, which check `can_write_fixture` first. A
-- tournament member therefore cannot fabricate or steal a claim over REST.

-- Realtime so every operator sees claims appear/disappear live.
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fixture_loggers;
EXCEPTION
    WHEN duplicate_object OR undefined_object THEN NULL;
END
$$;

ALTER TABLE public.fixture_loggers REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- 13.4 Attribution + de-duplication of recorded rows
--      "Who logged this?" must be answerable, and the same result must not be
--      insertable twice. Part 11's upsert_fixture_entry could not actually
--      update (there was no unique key and no updated_at column), so a
--      re-submitted result silently created a duplicate row — which would also
--      double-count medals. Both are fixed here.
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_events    ADD COLUMN IF NOT EXISTS logged_by UUID;
ALTER TABLE public.fixture_entries ADD COLUMN IF NOT EXISTS recorded_by UUID;
ALTER TABLE public.fixture_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'match_events'
          AND c.conname = 'fk_match_events_logged_by'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT fk_match_events_logged_by
            FOREIGN KEY (logged_by) REFERENCES auth.users (id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_entries'
          AND c.conname = 'fk_fixture_entries_recorded_by'
    ) THEN
        ALTER TABLE public.fixture_entries
            ADD CONSTRAINT fk_fixture_entries_recorded_by
            FOREIGN KEY (recorded_by) REFERENCES auth.users (id) ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_match_events_logged_by
    ON public.match_events (logged_by);

-- Collapse pre-existing duplicates (keep the most recent submission) so the
-- unique indexes below can be created on an already-populated database.
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
               PARTITION BY fixture_id, athlete_id
               ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM public.fixture_entries
    WHERE athlete_id IS NOT NULL
)
DELETE FROM public.fixture_entries fe
USING ranked r
WHERE fe.id = r.id AND r.rn > 1;

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
               PARTITION BY fixture_id, team_id
               ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM public.fixture_entries
    WHERE athlete_id IS NULL AND team_id IS NOT NULL
)
DELETE FROM public.fixture_entries fe
USING ranked r
WHERE fe.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_entries_fixture_athlete
    ON public.fixture_entries (fixture_id, athlete_id)
    WHERE athlete_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_entries_fixture_team
    ON public.fixture_entries (fixture_id, team_id)
    WHERE athlete_id IS NULL AND team_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 13.5 Replace the membership-wide write policies with duty-scoped ones
--      Part 06 granted every tournament member write access to every scoped
--      table. That made "scout with the shots duty" impossible: the moment you
--      are a member you could also edit squads, fixtures and the timeline.
--      Postgres ORs permissive policies, so these must be DROPPED and
--      recreated — adding a narrower policy alongside would have no effect.
--
--      Old role        →  new requirement (unchanged for '*' members)
--      teams/players   →  '*' or 'roster'
--      athletes        →  '*' or 'roster'
--      fixtures        →  '*' or 'score' or 'roster'
--      match_events    →  app_admin, or can_log_fixture_event(type)
--      fixture_entries →  app_admin, or can_write_fixture_entries()
--      stats/score/clock → the RPCs in part 14 (never a table policy)
-- ---------------------------------------------------------------------------

-- match_events -------------------------------------------------------------
DROP POLICY IF EXISTS "Tournament members can insert match events" ON public.match_events;
CREATE POLICY "Tournament members can insert match events"
    ON public.match_events FOR INSERT
    WITH CHECK (
        public.is_app_admin()
        OR public.can_log_fixture_event(fixture_id, event_type)
    );

DROP POLICY IF EXISTS "Tournament members can update match events" ON public.match_events;
CREATE POLICY "Tournament members can update match events"
    ON public.match_events FOR UPDATE
    USING (
        public.is_app_admin()
        OR public.can_log_fixture_event(fixture_id, event_type)
    )
    WITH CHECK (
        public.is_app_admin()
        OR public.can_log_fixture_event(fixture_id, event_type)
    );

DROP POLICY IF EXISTS "Tournament members can delete match events" ON public.match_events;
CREATE POLICY "Tournament members can delete match events"
    ON public.match_events FOR DELETE
    USING (
        public.is_app_admin()
        OR public.can_log_fixture_event(fixture_id, event_type)
    );

-- fixture_entries ----------------------------------------------------------
DROP POLICY IF EXISTS "Tournament members can insert fixture entries" ON public.fixture_entries;
CREATE POLICY "Tournament members can insert fixture entries"
    ON public.fixture_entries FOR INSERT
    WITH CHECK (
        public.is_app_admin()
        OR public.can_write_fixture_entries(fixture_id)
    );

DROP POLICY IF EXISTS "Tournament members can update fixture entries" ON public.fixture_entries;
CREATE POLICY "Tournament members can update fixture entries"
    ON public.fixture_entries FOR UPDATE
    USING (
        public.is_app_admin()
        OR public.can_write_fixture_entries(fixture_id)
    )
    WITH CHECK (
        public.is_app_admin()
        OR public.can_write_fixture_entries(fixture_id)
    );

DROP POLICY IF EXISTS "Tournament members can delete fixture entries" ON public.fixture_entries;
CREATE POLICY "Tournament members can delete fixture entries"
    ON public.fixture_entries FOR DELETE
    USING (
        public.is_app_admin()
        OR public.can_write_fixture_entries(fixture_id)
    );

-- teams --------------------------------------------------------------------
DROP POLICY IF EXISTS "Tournament members can insert teams" ON public.teams;
CREATE POLICY "Tournament members can insert teams"
    ON public.teams FOR INSERT
    WITH CHECK (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

DROP POLICY IF EXISTS "Tournament members can update teams" ON public.teams;
CREATE POLICY "Tournament members can update teams"
    ON public.teams FOR UPDATE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

DROP POLICY IF EXISTS "Tournament members can delete teams" ON public.teams;
CREATE POLICY "Tournament members can delete teams"
    ON public.teams FOR DELETE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

-- players ------------------------------------------------------------------
DROP POLICY IF EXISTS "Tournament members can insert players" ON public.players;
CREATE POLICY "Tournament members can insert players"
    ON public.players FOR INSERT
    WITH CHECK (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

DROP POLICY IF EXISTS "Tournament members can update players" ON public.players;
CREATE POLICY "Tournament members can update players"
    ON public.players FOR UPDATE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

DROP POLICY IF EXISTS "Tournament members can delete players" ON public.players;
CREATE POLICY "Tournament members can delete players"
    ON public.players FOR DELETE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

-- athletes -----------------------------------------------------------------
DROP POLICY IF EXISTS "Tournament members can insert athletes" ON public.athletes;
CREATE POLICY "Tournament members can insert athletes"
    ON public.athletes FOR INSERT
    WITH CHECK (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

DROP POLICY IF EXISTS "Tournament members can update athletes" ON public.athletes;
CREATE POLICY "Tournament members can update athletes"
    ON public.athletes FOR UPDATE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

DROP POLICY IF EXISTS "Tournament members can delete athletes" ON public.athletes;
CREATE POLICY "Tournament members can delete athletes"
    ON public.athletes FOR DELETE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['roster'])
    );

-- fixtures -----------------------------------------------------------------
DROP POLICY IF EXISTS "Tournament members can insert fixtures" ON public.fixtures;
CREATE POLICY "Tournament members can insert fixtures"
    ON public.fixtures FOR INSERT
    WITH CHECK (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['score', 'roster'])
    );

DROP POLICY IF EXISTS "Tournament members can update fixtures" ON public.fixtures;
CREATE POLICY "Tournament members can update fixtures"
    ON public.fixtures FOR UPDATE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['score', 'roster'])
    );

DROP POLICY IF EXISTS "Tournament members can delete fixtures" ON public.fixtures;
CREATE POLICY "Tournament members can delete fixtures"
    ON public.fixtures FOR DELETE
    USING (
        public.is_app_admin()
        OR public.has_tournament_duty(tournament_id, ARRAY['score', 'roster'])
    );

-- ---------------------------------------------------------------------------
-- 13.6 Legacy membership backfill
--      `duties` is NOT NULL DEFAULT '{*}' and invites default to '{*}', so an
--      empty array means "unspecified" — under part 06 that member had full
--      write access. Granting '{*}' preserves exactly today's effective access
--      and avoids silently locking staff out mid-tournament the moment 13.5
--      lands. Narrow these deliberately in the tournament admin UI afterwards.
-- ---------------------------------------------------------------------------
UPDATE public.tournament_members
SET duties = ARRAY['*']
WHERE duties IS NULL OR cardinality(duties) = 0;

-- ============================================================================
-- PART 14 — recorder RPCs (every live-console write path)
-- ============================================================================

-- ============================================================================
-- PART 14 — Recorder RPCs (everything the live console writes through)
-- ============================================================================
-- One rule: the browser never writes tables directly. Every tap goes through a
-- SECURITY DEFINER function that (a) checks the caller's scope with the part 13
-- authority functions, (b) validates the key/type against the fixture's own
-- effective vocabulary, and (c) updates exactly one slice of data with a single
-- statement, so two operators tapping different streams can never clobber each
-- other.
--
-- RPC                        writes                          scope required
-- --------------------------------------------------------------------------
-- claim_fixture_scope        fixture_loggers row             scope-specific
-- heartbeat_fixture_scope    fixture_loggers.last_seen_at    owns the claim
-- release_fixture_scope      deletes the claim               owns the claim
-- record_stat                stats->side->key  (+1)          stat:<key>
-- set_fixture_stat           stats->side->key  (=value)      stat:<key>
-- record_score               home_score/away_score           score
-- record_score_delta         home_score/away_score (+N)      score
-- update_match_clock         status/minute/clock keys        clock or score
-- record_match_event         one match_events row            event:<type>
-- delete_match_event         one match_events row            event:<type>
-- upsert_fixture_entry       one fixture_entries row         entry or score
-- set_fixture_rules          fixtures.rules_override         score
-- clear_fixture_rules        fixtures.rules_override = {}    score
-- upsert_sport_vocab         sports.* (global catalogue)     app_admin only
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 14.1 Scope strings
--      A claim scope is: '*' | 'score' | 'clock' | 'entry' | 'lineup' |
--      'stat:<key>' | 'event:<type>'. Reserved scope words are never treated as
--      stat keys.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fixture_scope_authorized(p_fixture_id UUID, p_scope TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_kind  TEXT;
    v_key   TEXT;
    v_tid   UUID;
BEGIN
    IF p_scope IS NULL OR p_scope = '' THEN
        RETURN FALSE;
    END IF;

    SELECT f.tournament_id INTO v_tid FROM public.fixtures f WHERE f.id = p_fixture_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    v_kind := split_part(p_scope, ':', 1);
    v_key  := NULLIF(split_part(p_scope, ':', 2), '');

    IF p_scope = '*' THEN
        -- Running the whole match is a chief-scorer action.
        RETURN public.is_app_admin() OR public.has_tournament_duty(v_tid, ARRAY['*']);
    ELSIF v_kind = 'stat' AND v_key IS NOT NULL THEN
        RETURN public.can_write_fixture_stat(p_fixture_id, v_key);
    ELSIF v_kind = 'event' AND v_key IS NOT NULL THEN
        RETURN public.can_log_fixture_event(p_fixture_id, v_key);
    ELSIF p_scope = 'score' THEN
        RETURN public.can_write_fixture_score(p_fixture_id);
    ELSIF p_scope = 'clock' THEN
        RETURN public.can_write_fixture_clock(p_fixture_id);
    ELSIF p_scope = 'entry' THEN
        RETURN public.can_write_fixture_entries(p_fixture_id);
    ELSIF p_scope = 'lineup' THEN
        RETURN public.can_write_fixture_lineup(p_fixture_id);
    END IF;

    RETURN FALSE;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fixture_scope_authorized(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.2 Claim / heartbeat / release / list
--      The (fixture_id, scope) unique index is the concurrency guard: a second
--      person claiming "stat:shots" on the same match gets a readable error
--      instead of both of them bumping the same counter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_fixture_scope(
    p_fixture_id UUID,
    p_scope TEXT,
    p_stale_after_minutes INT DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_holder UUID;
    v_id     UUID;
BEGIN
    IF NOT public.fixture_scope_authorized(p_fixture_id, p_scope) THEN
        RAISE EXCEPTION 'Not authorized to log "%" on this fixture', p_scope
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Drop claims whose owner stopped heart-beating (closed laptop / lost net).
    DELETE FROM public.fixture_loggers l
    WHERE l.fixture_id = p_fixture_id
      AND l.scope = p_scope
      AND l.last_seen_at < NOW()
          - make_interval(mins => GREATEST(COALESCE(p_stale_after_minutes, 5), 1));

    SELECT l.user_id INTO v_holder
    FROM public.fixture_loggers l
    WHERE l.fixture_id = p_fixture_id AND l.scope = p_scope;

    IF FOUND AND v_holder <> auth.uid() THEN
        RAISE EXCEPTION 'Somebody is already logging "%" on this match', p_scope
            USING ERRCODE = 'unique_violation';
    END IF;

    INSERT INTO public.fixture_loggers (fixture_id, user_id, scope)
    VALUES (p_fixture_id, auth.uid(), p_scope)
    ON CONFLICT (fixture_id, scope) DO UPDATE
        SET last_seen_at = NOW()
        WHERE public.fixture_loggers.user_id = auth.uid()
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'id', v_id,
        'fixture_id', p_fixture_id,
        'scope', p_scope,
        'user_id', auth.uid()
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.claim_fixture_scope(UUID, TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.heartbeat_fixture_scope(p_fixture_id UUID, p_scope TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_count INT;
BEGIN
    UPDATE public.fixture_loggers
    SET last_seen_at = NOW()
    WHERE fixture_id = p_fixture_id
      AND scope = p_scope
      AND user_id = auth.uid();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.heartbeat_fixture_scope(UUID, TEXT) TO authenticated;

-- Owners release their own claim; an app admin may clear anybody's.
CREATE OR REPLACE FUNCTION public.release_fixture_scope(
    p_fixture_id UUID,
    p_scope TEXT,
    p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_count INT;
BEGIN
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Only an app admin can release somebody else''s claim'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    DELETE FROM public.fixture_loggers
    WHERE fixture_id = p_fixture_id
      AND scope = p_scope
      AND user_id = COALESCE(p_user_id, auth.uid());
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.release_fixture_scope(UUID, TEXT, UUID) TO authenticated;

-- The roster of who is logging what, for the console's "coverage" strip.
CREATE OR REPLACE FUNCTION public.list_fixture_loggers(p_fixture_id UUID)
RETURNS TABLE (
    scope TEXT,
    user_id UUID,
    email TEXT,
    claimed_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    is_stale BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT l.scope,
           l.user_id,
           u.email::TEXT,
           l.claimed_at,
           l.last_seen_at,
           (l.last_seen_at < NOW() - INTERVAL '5 minutes') AS is_stale
    FROM public.fixture_loggers l
    LEFT JOIN auth.users u ON u.id = l.user_id
    WHERE l.fixture_id = p_fixture_id
      AND (
          public.is_app_admin()
          OR l.user_id = auth.uid()
          OR public.has_tournament_duty(
                 (SELECT f.tournament_id FROM public.fixtures f WHERE f.id = p_fixture_id),
                 ARRAY[]::TEXT[]
             )
      )
    ORDER BY l.scope;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_fixture_loggers(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.3 Stat counters
--      A vocabulary entry may declare how it is entered, so the same RPC layer
--      serves "+1 taps" (shots, passes) and "judged values" (gymnastics
--      execution score, athletics time):
--          {"key":"shots","label":"Shots"}                       → counter
--          {"key":"execution_score","input":"value"}              → value
--      Default is counter, so every existing catalogue entry is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fixture_stat_input(p_fixture_id UUID, p_stat_key TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
    SELECT COALESCE(
        (
            SELECT CASE
                       WHEN jsonb_typeof(e) = 'object'
                            AND COALESCE(e ->> 'input', e ->> 'value_type', '')
                                IN ('value', 'score', 'number', 'decimal', 'time', 'duration')
                           THEN 'value'
                       ELSE 'counter'
                   END
            FROM jsonb_array_elements(
                     COALESCE(public.fixture_effective_rules(p_fixture_id) -> 'stat_vocab', '[]'::jsonb)
                 ) AS e
            WHERE e = to_jsonb(p_stat_key)
               OR (jsonb_typeof(e) = 'object' AND e ->> 'key'  = p_stat_key)
               OR (jsonb_typeof(e) = 'object' AND e ->> 'stat' = p_stat_key)
               OR (jsonb_typeof(e) = 'object' AND e ->> 'name' = p_stat_key)
            LIMIT 1
        ),
        'counter'
    );
$fn$;

GRANT EXECUTE ON FUNCTION public.fixture_stat_input(UUID, TEXT) TO anon, authenticated;

-- Atomic duty-checked +1. Replaces part 06's version so that the sport
-- vocabulary and the caller's duty are resolved by the shared helpers (one
-- authority path) instead of an inline copy of the rules.
CREATE OR REPLACE FUNCTION public.record_stat(p_fixture_id UUID, p_side TEXT, p_stat_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_new INTEGER;
BEGIN
    IF p_side NOT IN ('home', 'away') THEN
        RAISE EXCEPTION 'Invalid side %: must be ''home'' or ''away''', p_side;
    END IF;
    IF p_stat_key IS NULL OR p_stat_key = '' THEN
        RAISE EXCEPTION 'Stat key must not be empty';
    END IF;

    IF NOT public.can_write_fixture_stat(p_fixture_id, p_stat_key) THEN
        RAISE EXCEPTION 'Not authorized to record "%" for this fixture', p_stat_key
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.fixture_stat_allowed(p_fixture_id, p_stat_key) THEN
        RAISE EXCEPTION 'Unknown stat key "%" for this fixture''s sport', p_stat_key;
    END IF;

    IF public.fixture_stat_input(p_fixture_id, p_stat_key) = 'value' THEN
        RAISE EXCEPTION 'Stat "%" records a value; use set_fixture_stat() instead', p_stat_key;
    END IF;

    -- Single statement, so concurrent taps on the same key cannot lose an
    -- update. A stored non-numeric value is treated as 0 rather than erroring
    -- (part 06 used a bare ::INT cast, which raised 22P02 instead).
    UPDATE public.fixtures
    SET stats = jsonb_set(
            jsonb_set(
                COALESCE(stats, '{}'::jsonb),
                ARRAY[p_side],
                COALESCE(stats -> p_side, '{}'::jsonb),
                TRUE
            ),
            ARRAY[p_side, p_stat_key],
            to_jsonb(
                CASE
                    WHEN jsonb_typeof(stats -> p_side -> p_stat_key) = 'number'
                        THEN (stats -> p_side ->> p_stat_key)::NUMERIC + 1
                    ELSE 1
                END
            ),
            TRUE
        ),
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING floor((stats -> p_side ->> p_stat_key)::NUMERIC)::INTEGER INTO v_new;

    RETURN v_new;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_stat(UUID, TEXT, TEXT) TO authenticated;

-- Atomic duty-checked assignment, for judged/measured stats.
CREATE OR REPLACE FUNCTION public.set_fixture_stat(
    p_fixture_id UUID,
    p_side TEXT,
    p_stat_key TEXT,
    p_value NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_new NUMERIC;
BEGIN
    IF p_side NOT IN ('home', 'away') THEN
        RAISE EXCEPTION 'Invalid side %: must be ''home'' or ''away''', p_side;
    END IF;
    IF p_stat_key IS NULL OR p_stat_key = '' THEN
        RAISE EXCEPTION 'Stat key must not be empty';
    END IF;
    IF p_value IS NULL THEN
        RAISE EXCEPTION 'Value must not be NULL';
    END IF;

    IF NOT public.can_write_fixture_stat(p_fixture_id, p_stat_key) THEN
        RAISE EXCEPTION 'Not authorized to record "%" for this fixture', p_stat_key
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.fixture_stat_allowed(p_fixture_id, p_stat_key) THEN
        RAISE EXCEPTION 'Unknown stat key "%" for this fixture''s sport', p_stat_key;
    END IF;

    UPDATE public.fixtures
    SET stats = jsonb_set(
            jsonb_set(
                COALESCE(stats, '{}'::jsonb),
                ARRAY[p_side],
                COALESCE(stats -> p_side, '{}'::jsonb),
                TRUE
            ),
            ARRAY[p_side, p_stat_key],
            to_jsonb(p_value),
            TRUE
        ),
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING (stats -> p_side ->> p_stat_key)::NUMERIC INTO v_new;

    RETURN v_new;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_fixture_stat(UUID, TEXT, TEXT, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.4 Scoreboard
--      Replaces part 06's record_score so the score duty and the
--      `allow_negative_score` rule (a handball/basketball/penalty-shootout
--      thing) come from one place. Signature is unchanged, so the existing
--      `/admin/match/[id]` call keeps working.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_score(p_fixture_id UUID, p_home INT, p_away INT)
RETURNS public.fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_row public.fixtures%ROWTYPE;
    v_allow_negative BOOLEAN;
BEGIN
    IF NOT public.can_write_fixture_score(p_fixture_id) THEN
        RAISE EXCEPTION 'Not authorized to record the score for this fixture'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_home IS NULL OR p_away IS NULL THEN
        RAISE EXCEPTION 'Scores must not be NULL';
    END IF;

    v_allow_negative := COALESCE(
        (public.fixture_effective_rules(p_fixture_id) ->> 'allow_negative_score')::BOOLEAN,
        FALSE
    );

    IF NOT v_allow_negative AND (p_home < 0 OR p_away < 0) THEN
        RAISE EXCEPTION 'Scores must be non-negative for this sport';
    END IF;

    UPDATE public.fixtures
    SET home_score = p_home,
        away_score = p_away,
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_score(UUID, INT, INT) TO authenticated;

-- +N / -N on one side, for sports scored continuously (basketball points,
-- rugby tries+conversion, handball fast breaks). Single statement, so two
-- scorers cannot lose an update.
CREATE OR REPLACE FUNCTION public.record_score_delta(p_fixture_id UUID, p_side TEXT, p_delta INT)
RETURNS public.fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_row public.fixtures%ROWTYPE;
    v_allow_negative BOOLEAN;
BEGIN
    IF p_side NOT IN ('home', 'away') THEN
        RAISE EXCEPTION 'Invalid side %: must be ''home'' or ''away''', p_side;
    END IF;
    IF p_delta IS NULL OR p_delta = 0 THEN
        RAISE EXCEPTION 'Delta must be a non-zero integer';
    END IF;
    IF NOT public.can_write_fixture_score(p_fixture_id) THEN
        RAISE EXCEPTION 'Not authorized to record the score for this fixture'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_allow_negative := COALESCE(
        (public.fixture_effective_rules(p_fixture_id) ->> 'allow_negative_score')::BOOLEAN,
        FALSE
    );

    UPDATE public.fixtures
    SET home_score = CASE
                        WHEN p_side = 'home' THEN
                            CASE WHEN v_allow_negative THEN COALESCE(home_score, 0) + p_delta
                                 ELSE GREATEST(COALESCE(home_score, 0) + p_delta, 0) END
                        ELSE home_score
                     END,
        away_score = CASE
                        WHEN p_side = 'away' THEN
                            CASE WHEN v_allow_negative THEN COALESCE(away_score, 0) + p_delta
                                 ELSE GREATEST(COALESCE(away_score, 0) + p_delta, 0) END
                        ELSE away_score
                     END,
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_score_delta(UUID, TEXT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.5 Clock
--      Replaces part 10's version: identical signature and identical
--      jsonb_set merging (so a clock save still cannot clobber statistics
--      recorded at the same instant), but the duty check now flows through
--      can_write_fixture_clock(), which also accepts a dedicated 'clock' scope.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_match_clock(
    p_fixture_id UUID,
    p_status TEXT,
    p_minute INT,
    p_elapsed_seconds INT,
    p_timer_started_at TIMESTAMPTZ
)
RETURNS public.fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_row public.fixtures%ROWTYPE;
BEGIN
    IF NOT public.can_write_fixture_clock(p_fixture_id) THEN
        RAISE EXCEPTION 'Not authorized to update the clock for this fixture'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_status IS NOT NULL AND p_status NOT IN
        ('scheduled', 'in_progress', 'half_time', 'paused', 'extra_time', 'full_time', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid match status: %', p_status;
    END IF;

    UPDATE public.fixtures
    SET status = COALESCE(p_status, status),
        current_minute = COALESCE(p_minute, current_minute),
        stats = jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            COALESCE(stats, '{}'::jsonb),
                            '{elapsed_seconds}',
                            to_jsonb(COALESCE(p_elapsed_seconds, 0)),
                            TRUE
                        ),
                        '{timer_started_at}',
                        COALESCE(to_jsonb(p_timer_started_at), 'null'::jsonb),
                        TRUE
                    ),
                    '{clock_saved_at}',
                    to_jsonb(NOW()),
                    TRUE
                ),
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.update_match_clock(UUID, TEXT, INT, INT, TIMESTAMPTZ) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.6 Timeline events
--      match_events had no duty gate at all: any tournament member could insert
--      a goal or a red card. It also had no attribution. Both are fixed by
--      routing every write through this RPC, which validates the event type
--      against the fixture's own vocabulary and stamps `logged_by`.
--
--      `athlete_id` is added for individual sports (gymnastics, athletics,
--      swimming): a timeline event there belongs to a person, not to a squad
--      player. It is nullable and independent of player_id / team_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_events ADD COLUMN IF NOT EXISTS athlete_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'match_events'
          AND c.conname = 'fk_match_events_athlete_id'
    ) THEN
        ALTER TABLE public.match_events
            ADD CONSTRAINT fk_match_events_athlete_id
            FOREIGN KEY (athlete_id) REFERENCES public.athletes (id) ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_match_events_athlete_id
    ON public.match_events (athlete_id);

CREATE OR REPLACE FUNCTION public.record_match_event(
    p_fixture_id UUID,
    p_event_type TEXT,
    p_team_id UUID DEFAULT NULL,
    p_player_id UUID DEFAULT NULL,
    p_player_name TEXT DEFAULT NULL,
    p_assist_player_id UUID DEFAULT NULL,
    p_minute INT DEFAULT 0,
    p_details TEXT DEFAULT NULL,
    p_athlete_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_id UUID;
    v_row public.match_events%ROWTYPE;
BEGIN
    IF p_event_type IS NULL OR p_event_type !~ '^[a-z][a-z0-9_]{0,48}$' THEN
        RAISE EXCEPTION 'Invalid event type "%": use lower_snake_case', p_event_type;
    END IF;

    IF p_minute IS NULL OR p_minute < 0 OR p_minute > 999 THEN
        RAISE EXCEPTION 'Minute must be between 0 and 999';
    END IF;

    IF NOT public.can_log_fixture_event(p_fixture_id, p_event_type) THEN
        RAISE EXCEPTION 'Not authorized to log "%" for this fixture', p_event_type
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.fixture_event_allowed(p_fixture_id, p_event_type) THEN
        RAISE EXCEPTION 'Event type "%" is not part of this fixture''s vocabulary', p_event_type;
    END IF;

    INSERT INTO public.match_events (
        fixture_id, tournament_id, event_type, team_id, player_id, player_name,
        assist_player_id, athlete_id, minute, details, logged_by
    )
    VALUES (
        p_fixture_id,
        (SELECT f.tournament_id FROM public.fixtures f WHERE f.id = p_fixture_id),
        p_event_type, p_team_id, p_player_id, NULLIF(trim(COALESCE(p_player_name, '')), ''),
        p_assist_player_id, p_athlete_id, p_minute,
        NULLIF(trim(COALESCE(p_details, '')), ''),
        auth.uid()
    )
    RETURNING * INTO v_row;

    v_id := v_row.id;

    RETURN jsonb_build_object(
        'id', v_id,
        'fixture_id', v_row.fixture_id,
        'event_type', v_row.event_type,
        'team_id', v_row.team_id,
        'player_id', v_row.player_id,
        'player_name', v_row.player_name,
        'athlete_id', v_row.athlete_id,
        'minute', v_row.minute,
        'details', v_row.details,
        'logged_by', v_row.logged_by,
        'created_at', v_row.created_at
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_match_event(UUID, TEXT, UUID, UUID, TEXT, UUID, INT, TEXT, UUID)
    TO authenticated;

-- Delete one timeline entry. Allowed for app admins, the person who logged it
-- (undo my own mistake), or anybody who may log that event type.
CREATE OR REPLACE FUNCTION public.delete_match_event(p_event_id UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_row public.match_events%ROWTYPE;
    v_count INT;
BEGIN
    SELECT * INTO v_row FROM public.match_events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF NOT (
        public.is_app_admin()
        OR public.can_log_fixture_event(v_row.fixture_id, v_row.event_type)
        OR (NOT p_force AND v_row.logged_by IS NOT NULL AND v_row.logged_by = auth.uid())
    ) THEN
        RAISE EXCEPTION 'Not authorized to delete this event'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    DELETE FROM public.match_events WHERE id = p_event_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.delete_match_event(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.7 Fixture entries (individual sports: lanes, results, ranks, medals)
--      Part 11's version could not actually update: it used
--      `ON CONFLICT DO NOTHING` with no unique constraint to conflict on, and
--      its fallback UPDATE wrote an `updated_at` column that did not exist. So
--      re-submitting a result inserted a SECOND row — which double-counted
--      medals on /medals. Part 13 added the column and the unique indexes;
--      this replaces the RPC with a real upsert. Signature is unchanged, so
--      existing callers keep working.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_fixture_entry(
    p_fixture_id UUID,
    p_athlete_id UUID DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_position INTEGER DEFAULT 0,
    p_lane TEXT DEFAULT NULL,
    p_result JSONB DEFAULT '{}',
    p_rank INTEGER DEFAULT NULL,
    p_medal TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_entry_id UUID;
    v_row public.fixture_entries%ROWTYPE;
    v_result JSONB := COALESCE(p_result, '{}'::jsonb);
BEGIN
    IF NOT public.can_write_fixture_entries(p_fixture_id) THEN
        RAISE EXCEPTION 'Not authorized to edit entries for this fixture'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_athlete_id IS NULL AND p_team_id IS NULL THEN
        RAISE EXCEPTION 'Must specify either athlete_id or team_id';
    END IF;

    IF p_medal IS NOT NULL AND p_medal NOT IN ('gold', 'silver', 'bronze') THEN
        RAISE EXCEPTION 'Invalid medal value: %', p_medal;
    END IF;

    IF p_rank IS NOT NULL AND p_rank < 0 THEN
        RAISE EXCEPTION 'Rank must not be negative';
    END IF;

    IF jsonb_typeof(v_result) <> 'object' THEN
        RAISE EXCEPTION 'result must be a JSON object';
    END IF;

    IF p_athlete_id IS NOT NULL THEN
        INSERT INTO public.fixture_entries
            (fixture_id, athlete_id, team_id, position, lane, result, rank, medal, recorded_by)
        VALUES
            (p_fixture_id, p_athlete_id, p_team_id, COALESCE(p_position, 0), p_lane,
             v_result, p_rank, p_medal, auth.uid())
        ON CONFLICT (fixture_id, athlete_id) WHERE athlete_id IS NOT NULL
        DO UPDATE SET
            team_id     = EXCLUDED.team_id,
            position    = EXCLUDED.position,
            lane        = EXCLUDED.lane,
            result      = EXCLUDED.result,
            rank        = EXCLUDED.rank,
            medal       = EXCLUDED.medal,
            recorded_by = auth.uid(),
            updated_at  = NOW()
        RETURNING id INTO v_entry_id;
    ELSE
        INSERT INTO public.fixture_entries
            (fixture_id, athlete_id, team_id, position, lane, result, rank, medal, recorded_by)
        VALUES
            (p_fixture_id, NULL, p_team_id, COALESCE(p_position, 0), p_lane,
             v_result, p_rank, p_medal, auth.uid())
        ON CONFLICT (fixture_id, team_id) WHERE athlete_id IS NULL AND team_id IS NOT NULL
        DO UPDATE SET
            position    = EXCLUDED.position,
            lane        = EXCLUDED.lane,
            result      = EXCLUDED.result,
            rank        = EXCLUDED.rank,
            medal       = EXCLUDED.medal,
            recorded_by = auth.uid(),
            updated_at  = NOW()
        RETURNING id INTO v_entry_id;
    END IF;

    SELECT * INTO v_row FROM public.fixture_entries WHERE id = v_entry_id;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'fixture_id', v_row.fixture_id,
        'athlete_id', v_row.athlete_id,
        'team_id', v_row.team_id,
        'position', v_row.position,
        'lane', v_row.lane,
        'result', v_row.result,
        'rank', v_row.rank,
        'medal', v_row.medal,
        'recorded_by', v_row.recorded_by,
        'updated_at', v_row.updated_at
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.upsert_fixture_entry(UUID, UUID, UUID, INTEGER, TEXT, JSONB, INTEGER, TEXT)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.8 Editable rules — "the allocated time is different today"
--      set_fixture_rules() merges validated overrides into
--      fixtures.rules_override. This is how a period length, period count,
--      break, score label or vocabulary is changed for ONE match without
--      touching the global catalogue and without a migration.
--
--      Passing an explicit JSON null for a key REMOVES that override, so a
--      match can be pushed back to the sport defaults again.
--      clear_fixture_rules() drops every override for the fixture.
--
--      Shape validation only accepts known keys with sane values — an
--      accidental {"clock":{"periods":-5}} cannot reach the console.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_fixture_rules(p_fixture_id UUID, p_rules JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_sanitized JSONB := '{}'::jsonb;
    v_current   JSONB;
    v_next      JSONB;
    v_clock     JSONB;
    v_key       TEXT;
    v_vocab     JSONB;
    c_allowed   TEXT[] := ARRAY['clock', 'medals', 'stat_vocab', 'event_vocab',
                                'score_label', 'allow_negative_score', 'court'];
BEGIN
    IF NOT public.can_write_fixture_rules(p_fixture_id) THEN
        RAISE EXCEPTION 'Not authorized to edit the rules for this fixture'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
        RAISE EXCEPTION 'rules must be a JSON object';
    END IF;

    -- Reject unknown keys outright: it means a typo, and silently ignoring it
    -- would look like the edit "worked" while nothing changed.
    FOR v_key IN SELECT jsonb_object_keys(p_rules) LOOP
        IF NOT (v_key = ANY (c_allowed)) THEN
            RAISE EXCEPTION 'Unknown rule "%". Allowed: %', v_key, array_to_string(c_allowed, ', ');
        END IF;
    END LOOP;

    -- clock ------------------------------------------------------------------
    IF p_rules ? 'clock' THEN
        v_clock := p_rules -> 'clock';
        IF jsonb_typeof(v_clock) = 'null' THEN
            v_sanitized := v_sanitized || jsonb_build_object('clock', NULL);
        ELSE
            IF jsonb_typeof(v_clock) <> 'object' THEN
                RAISE EXCEPTION 'clock must be a JSON object';
            END IF;
            IF v_clock ? 'type' AND (v_clock ->> 'type') NOT IN
                ('halves', 'quarters', 'rounds', 'sets', 'innings', 'none') THEN
                RAISE EXCEPTION 'Unsupported clock type: %', v_clock ->> 'type';
            END IF;
            FOR v_key IN SELECT jsonb_object_keys(v_clock) LOOP
                IF NOT (v_key = ANY (ARRAY['type', 'periods', 'period_minutes',
                                           'break_minutes', 'extra', 'period_overs'])) THEN
                    RAISE EXCEPTION 'Unknown clock field "%"', v_key;
                END IF;
                IF v_key <> 'type' AND v_key <> 'extra'
                   AND jsonb_typeof(v_clock -> v_key) <> 'number' THEN
                    RAISE EXCEPTION 'clock.% must be a number', v_key;
                END IF;
                IF v_key IN ('periods', 'period_minutes', 'break_minutes')
                   AND (v_clock ->> v_key)::NUMERIC < 0 THEN
                    RAISE EXCEPTION 'clock.% must not be negative', v_key;
                END IF;
            END LOOP;
            IF v_clock ? 'extra' AND jsonb_typeof(v_clock -> 'extra') <> 'object' THEN
                RAISE EXCEPTION 'clock.extra must be a JSON object';
            END IF;
            v_sanitized := v_sanitized || jsonb_build_object('clock', v_clock);
        END IF;
    END IF;

    -- medals -----------------------------------------------------------------
    IF p_rules ? 'medals' THEN
        IF jsonb_typeof(p_rules -> 'medals') NOT IN ('object', 'null') THEN
            RAISE EXCEPTION 'medals must be a JSON object';
        END IF;
        v_sanitized := v_sanitized || jsonb_build_object('medals', p_rules -> 'medals');
    END IF;

    -- court ------------------------------------------------------------------
    -- The playing-surface shape the lineup canvas renders on (PART 15):
    --   {"shape":"pitch|court|pool|track|none","orientation":"horizontal|vertical"}
    IF p_rules ? 'court' THEN
        v_clock := p_rules -> 'court';
        IF jsonb_typeof(v_clock) = 'null' THEN
            v_sanitized := v_sanitized || jsonb_build_object('court', NULL);
        ELSE
            IF jsonb_typeof(v_clock) <> 'object' THEN
                RAISE EXCEPTION 'court must be a JSON object';
            END IF;
            FOR v_key IN SELECT jsonb_object_keys(v_clock) LOOP
                IF NOT (v_key = ANY (ARRAY['shape', 'orientation'])) THEN
                    RAISE EXCEPTION 'Unknown court field "%"', v_key;
                END IF;
                IF v_key = 'shape' AND (v_clock ->> 'shape') NOT IN
                    ('pitch', 'court', 'pool', 'track', 'none') THEN
                    RAISE EXCEPTION 'Unsupported court shape: %', v_clock ->> 'shape';
                END IF;
                IF v_key = 'orientation' AND (v_clock ->> 'orientation') NOT IN
                    ('horizontal', 'vertical') THEN
                    RAISE EXCEPTION 'Unsupported court orientation: %', v_clock ->> 'orientation';
                END IF;
            END LOOP;
            v_sanitized := v_sanitized || jsonb_build_object('court', v_clock);
        END IF;
    END IF;

    -- vocabularies -----------------------------------------------------------
    FOREACH v_key IN ARRAY ARRAY['stat_vocab', 'event_vocab'] LOOP
        IF p_rules ? v_key THEN
            v_vocab := p_rules -> v_key;
            IF jsonb_typeof(v_vocab) = 'null' THEN
                v_sanitized := v_sanitized || jsonb_build_object(v_key, NULL);
            ELSE
                IF jsonb_typeof(v_vocab) <> 'array' THEN
                    RAISE EXCEPTION '% must be a JSON array', v_key;
                END IF;
                -- Shape rules live in assert_vocab_shape() (part 14.9) so the
                -- catalogue editor and the per-match editor cannot drift apart.
                PERFORM public.assert_vocab_shape(v_vocab, v_key);
                v_sanitized := v_sanitized || jsonb_build_object(v_key, v_vocab);
            END IF;
        END IF;
    END LOOP;

    -- scalars ----------------------------------------------------------------
    IF p_rules ? 'score_label' THEN
        IF jsonb_typeof(p_rules -> 'score_label') NOT IN ('string', 'null') THEN
            RAISE EXCEPTION 'score_label must be a string';
        END IF;
        v_sanitized := v_sanitized || jsonb_build_object('score_label', p_rules -> 'score_label');
    END IF;

    IF p_rules ? 'allow_negative_score' THEN
        IF jsonb_typeof(p_rules -> 'allow_negative_score') NOT IN ('boolean', 'null') THEN
            RAISE EXCEPTION 'allow_negative_score must be a boolean';
        END IF;
        v_sanitized := v_sanitized || jsonb_build_object(
            'allow_negative_score', p_rules -> 'allow_negative_score');
    END IF;

    SELECT COALESCE(f.rules_override, '{}'::jsonb) INTO v_current
    FROM public.fixtures f WHERE f.id = p_fixture_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    v_next := v_current || v_sanitized;

    -- An explicit null means "remove this override".
    FOR v_key IN SELECT jsonb_object_keys(v_next) LOOP
        IF v_next -> v_key = 'null'::jsonb THEN
            v_next := v_next - v_key;
        END IF;
    END LOOP;

    UPDATE public.fixtures
    SET rules_override = v_next,
        updated_at = NOW()
    WHERE id = p_fixture_id;

    RETURN v_next;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_fixture_rules(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_fixture_rules(p_fixture_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    IF NOT public.can_write_fixture_rules(p_fixture_id) THEN
        RAISE EXCEPTION 'Not authorized to edit the rules for this fixture'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.fixtures
    SET rules_override = '{}'::jsonb,
        updated_at = NOW()
    WHERE id = p_fixture_id;

    RETURN '{}'::jsonb;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.clear_fixture_rules(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.9 Global catalogue editing (app_admin only)
--      Vocabularies are data, so an app admin must be able to add a stat or an
--      event type for a sport without a migration. This does NOT leak into
--      tournaments: the gate is `is_app_admin()`, so a tournament admin can
--      never rewrite the catalogue that other tournaments share.
--
--      Note: a sport's stat_vocab / event_vocab / scoring_config are only the
--      DEFAULTS. A single match can override them via set_fixture_rules().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_vocab_shape(p_vocab JSONB, p_label TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
    v_entry JSONB;
BEGIN
    IF p_vocab IS NULL OR jsonb_typeof(p_vocab) <> 'array' THEN
        RAISE EXCEPTION '% must be a JSON array', p_label;
    END IF;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_vocab) LOOP
        IF jsonb_typeof(v_entry) = 'string' THEN
            IF (v_entry #>> '{}') !~ '^[a-z][a-z0-9_]{0,48}$' THEN
                RAISE EXCEPTION 'Invalid % entry "%": use lower_snake_case', p_label,
                    v_entry #>> '{}';
            END IF;
        ELSIF jsonb_typeof(v_entry) = 'object' THEN
            IF COALESCE(v_entry ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,48}$' THEN
                RAISE EXCEPTION 'Invalid % entry key "%": use lower_snake_case', p_label,
                    COALESCE(v_entry ->> 'key', '');
            END IF;
        ELSE
            RAISE EXCEPTION '% entries must be strings or objects', p_label;
        END IF;
    END LOOP;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.assert_vocab_shape(JSONB, TEXT) TO authenticated;

-- Create a sport, or update one by code. Idempotent by design.
CREATE OR REPLACE FUNCTION public.upsert_sport(
    p_code TEXT,
    p_name TEXT,
    p_scoring_type TEXT DEFAULT 'duel',
    p_stat_vocab JSONB DEFAULT NULL,
    p_event_vocab JSONB DEFAULT NULL,
    p_scoring_config JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_row public.sports%ROWTYPE;
BEGIN
    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Only an app admin can edit the sports catalogue'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_code IS NULL OR p_code !~ '^[a-z][a-z0-9_]{0,48}$' THEN
        RAISE EXCEPTION 'Invalid sport code "%": use lower_snake_case', p_code;
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'Sport name is required';
    END IF;

    IF p_scoring_type NOT IN ('duel', 'sets', 'bouts', 'race', 'attempts') THEN
        RAISE EXCEPTION 'Invalid scoring_type "%"', p_scoring_type;
    END IF;

    IF p_stat_vocab IS NOT NULL THEN
        PERFORM public.assert_vocab_shape(p_stat_vocab, 'stat_vocab');
    END IF;
    IF p_event_vocab IS NOT NULL THEN
        PERFORM public.assert_vocab_shape(p_event_vocab, 'event_vocab');
    END IF;
    IF p_scoring_config IS NOT NULL AND jsonb_typeof(p_scoring_config) <> 'object' THEN
        RAISE EXCEPTION 'scoring_config must be a JSON object';
    END IF;

    INSERT INTO public.sports (code, name, scoring_type, stat_vocab, event_vocab, scoring_config)
    VALUES (
        p_code, btrim(p_name), p_scoring_type,
        COALESCE(p_stat_vocab, '[]'::jsonb),
        COALESCE(p_event_vocab, '[]'::jsonb),
        COALESCE(p_scoring_config, '{}'::jsonb)
    )
    ON CONFLICT (code) DO UPDATE SET
        name           = EXCLUDED.name,
        scoring_type   = EXCLUDED.scoring_type,
        stat_vocab     = COALESCE(p_stat_vocab, public.sports.stat_vocab),
        event_vocab    = COALESCE(p_event_vocab, public.sports.event_vocab),
        scoring_config = COALESCE(public.sports.scoring_config, '{}'::jsonb)
                         || COALESCE(p_scoring_config, '{}'::jsonb),
        updated_at     = NOW()
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'code', v_row.code,
        'name', v_row.name,
        'scoring_type', v_row.scoring_type,
        'stat_vocab', v_row.stat_vocab,
        'event_vocab', v_row.event_vocab,
        'scoring_config', v_row.scoring_config
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.upsert_sport(TEXT, TEXT, TEXT, JSONB, JSONB, JSONB) TO authenticated;

-- Convenience wrapper for a catalogue editor: patch one sport by id.
CREATE OR REPLACE FUNCTION public.upsert_sport_vocab(
    p_sport_id UUID,
    p_stat_vocab JSONB DEFAULT NULL,
    p_event_vocab JSONB DEFAULT NULL,
    p_scoring_config JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_row public.sports%ROWTYPE;
BEGIN
    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Only an app admin can edit the sports catalogue'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_stat_vocab IS NOT NULL THEN
        PERFORM public.assert_vocab_shape(p_stat_vocab, 'stat_vocab');
    END IF;
    IF p_event_vocab IS NOT NULL THEN
        PERFORM public.assert_vocab_shape(p_event_vocab, 'event_vocab');
    END IF;
    IF p_scoring_config IS NOT NULL AND jsonb_typeof(p_scoring_config) <> 'object' THEN
        RAISE EXCEPTION 'scoring_config must be a JSON object';
    END IF;

    UPDATE public.sports
    SET stat_vocab     = COALESCE(p_stat_vocab, stat_vocab),
        event_vocab    = COALESCE(p_event_vocab, event_vocab),
        scoring_config = COALESCE(scoring_config, '{}'::jsonb)
                         || COALESCE(p_scoring_config, '{}'::jsonb),
        updated_at     = NOW()
    WHERE id = p_sport_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sport % not found', p_sport_id;
    END IF;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'code', v_row.code,
        'stat_vocab', v_row.stat_vocab,
        'event_vocab', v_row.event_vocab,
        'scoring_config', v_row.scoring_config
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.upsert_sport_vocab(UUID, JSONB, JSONB, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14.10 Athlete RPCs — duty gate fix
--      Part 11's versions checked `is_tournament_admin()`, which is true for
--      ANY member regardless of duties. A member invited purely to publish
--      news could therefore create, rename and delete competitors. They now
--      require the 'roster' (or 'score') duty, matching the tournament admin
--      UI, which already hides athlete management from everybody else.
--      Signatures are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_athlete(
    p_tournament_id UUID,
    p_name TEXT,
    p_gender TEXT DEFAULT 'mixed',
    p_classification TEXT DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_sport_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_id UUID;
BEGIN
    IF NOT public.has_tournament_duty(p_tournament_id, ARRAY['roster', 'score']) THEN
        RAISE EXCEPTION 'Not authorized to create athletes for this tournament'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'Athlete name is required';
    END IF;

    IF p_gender NOT IN ('male', 'female', 'mixed') THEN
        RAISE EXCEPTION 'Invalid gender value: %', p_gender;
    END IF;

    IF p_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = p_team_id AND t.tournament_id = p_tournament_id
    ) THEN
        RAISE EXCEPTION 'Team % does not belong to this tournament', p_team_id;
    END IF;

    INSERT INTO public.athletes (tournament_id, name, gender, classification, team_id, sport_id)
    VALUES (p_tournament_id, btrim(p_name), p_gender, p_classification, p_team_id, p_sport_id)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.create_athlete(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_athlete(
    p_athlete_id UUID,
    p_name TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT NULL,
    p_classification TEXT DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_sport_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_row public.athletes%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.athletes WHERE id = p_athlete_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Athlete % not found', p_athlete_id;
    END IF;

    IF NOT public.has_tournament_duty(v_row.tournament_id, ARRAY['roster', 'score']) THEN
        RAISE EXCEPTION 'Not authorized to update this athlete'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_gender IS NOT NULL AND p_gender NOT IN ('male', 'female', 'mixed') THEN
        RAISE EXCEPTION 'Invalid gender value: %', p_gender;
    END IF;

    IF p_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = p_team_id AND t.tournament_id = v_row.tournament_id
    ) THEN
        RAISE EXCEPTION 'Team % does not belong to this tournament', p_team_id;
    END IF;

    UPDATE public.athletes
    SET name           = COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), name),
        gender         = COALESCE(p_gender, gender),
        classification = COALESCE(p_classification, classification),
        team_id        = COALESCE(p_team_id, team_id),
        sport_id       = COALESCE(p_sport_id, sport_id)
    WHERE id = p_athlete_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'gender', v_row.gender,
        'classification', v_row.classification,
        'team_id', v_row.team_id,
        'sport_id', v_row.sport_id
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.update_athlete(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_athlete(p_athlete_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_tournament_id UUID;
BEGIN
    SELECT tournament_id INTO v_tournament_id FROM public.athletes WHERE id = p_athlete_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Athlete % not found', p_athlete_id;
    END IF;

    IF NOT public.has_tournament_duty(v_tournament_id, ARRAY['roster', 'score']) THEN
        RAISE EXCEPTION 'Not authorized to delete this athlete'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    DELETE FROM public.athletes WHERE id = p_athlete_id;
    RETURN jsonb_build_object('deleted', p_athlete_id);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.delete_athlete(UUID) TO authenticated;

-- ============================================================================
-- PART 15 — fixture lineups (drag-editable formations)
-- ============================================================================

-- ============================================================================
-- PART 15 — Fixture lineups (drag-editable formations, per-sport court)
-- ============================================================================
-- A lineup is the answer to "who starts, where, and in what role" for ONE
-- fixture. It is stored per slot so the console can render a formation on the
-- sport's court and let a duty holder drag the tokens around:
--
--   fixture_lineups (fixture_id, team_id, slot, player_id|athlete_id,
--                    role, x, y, is_captain)
--
-- Authority:
--   * Reading a lineup is public — it is matchday data, like the score.
--   * Writing goes ONLY through set_fixture_lineup(), which requires the
--     `lineup` duty (or `*` / a `fixture:<uuid>` pin) via the part 13
--     authority functions. There are no INSERT/UPDATE/DELETE policies, so a
--     forged REST write is impossible.
--   * Coordinates are NUMERIC(4,3) inside a 0..1 unit square, so the same
--     rows render on whatever court shape the sport's
--     `scoring_config.court` declares (seeded in part 12, overridable per
--     fixture through set_fixture_rules()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fixture_lineups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fixture_id UUID NOT NULL,
    team_id UUID NOT NULL,
    player_id UUID,
    athlete_id UUID,
    role TEXT,
    slot INT NOT NULL,
    x NUMERIC(4,3) NOT NULL,
    y NUMERIC(4,3) NOT NULL,
    is_captain BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A unit square: 0..1 on both axes (NUMERIC(4,3) alone would allow 9.999).
    CONSTRAINT fixture_lineups_x_range_check CHECK (x >= 0 AND x <= 1),
    CONSTRAINT fixture_lineups_y_range_check CHECK (y >= 0 AND y <= 1),
    CONSTRAINT fixture_lineups_slot_range_check CHECK (slot >= 1 AND slot <= 99),
    -- A slot always names somebody…
    CONSTRAINT fixture_lineups_subject_check
        CHECK (player_id IS NOT NULL OR athlete_id IS NOT NULL),
    -- …but never both: a squad player XOR an individual competitor.
    CONSTRAINT fixture_lineups_single_subject_check
        CHECK (NOT (player_id IS NOT NULL AND athlete_id IS NOT NULL)),
    CONSTRAINT fixture_lineups_role_length_check CHECK (char_length(role) <= 80)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_lineups'
          AND c.conname = 'fk_fixture_lineups_fixture_id'
    ) THEN
        ALTER TABLE public.fixture_lineups
            ADD CONSTRAINT fk_fixture_lineups_fixture_id
            FOREIGN KEY (fixture_id) REFERENCES public.fixtures (id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_lineups'
          AND c.conname = 'fk_fixture_lineups_team_id'
    ) THEN
        ALTER TABLE public.fixture_lineups
            ADD CONSTRAINT fk_fixture_lineups_team_id
            FOREIGN KEY (team_id) REFERENCES public.teams (id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_lineups'
          AND c.conname = 'fk_fixture_lineups_player_id'
    ) THEN
        ALTER TABLE public.fixture_lineups
            ADD CONSTRAINT fk_fixture_lineups_player_id
            FOREIGN KEY (player_id) REFERENCES public.players (id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_lineups'
          AND c.conname = 'fk_fixture_lineups_athlete_id'
    ) THEN
        ALTER TABLE public.fixture_lineups
            ADD CONSTRAINT fk_fixture_lineups_athlete_id
            FOREIGN KEY (athlete_id) REFERENCES public.athletes (id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'fixture_lineups'
          AND c.conname = 'fk_fixture_lineups_created_by'
    ) THEN
        ALTER TABLE public.fixture_lineups
            ADD CONSTRAINT fk_fixture_lineups_created_by
            FOREIGN KEY (created_by) REFERENCES auth.users (id) ON DELETE SET NULL;
    END IF;
END
$$;
-- One token per slot per team (two players cannot share position 4), and one
-- row per player per fixture (nobody is on the pitch twice).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_lineups_slot
    ON public.fixture_lineups (fixture_id, team_id, slot);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_lineups_fixture_player
    ON public.fixture_lineups (fixture_id, player_id) WHERE player_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_lineups_fixture_athlete
    ON public.fixture_lineups (fixture_id, athlete_id) WHERE athlete_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fixture_lineups_fixture_id
    ON public.fixture_lineups (fixture_id);
CREATE INDEX IF NOT EXISTS idx_fixture_lineups_team_id
    ON public.fixture_lineups (team_id);

ALTER TABLE public.fixture_lineups ENABLE ROW LEVEL SECURITY;

-- Read: public — a lineup is matchday display data, exactly like the score and
-- the timeline the public match page already renders.
DROP POLICY IF EXISTS "Public can view fixture lineups" ON public.fixture_lineups;
CREATE POLICY "Public can view fixture lineups"
    ON public.fixture_lineups FOR SELECT
    USING (TRUE);

-- NO insert/update/delete policies: every mutation goes through the SECURITY
-- DEFINER RPC in 15.2, which checks can_write_fixture_lineup() first.

-- Realtime so the public page sees formation changes the moment they save.
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fixture_lineups;
EXCEPTION
    WHEN duplicate_object OR undefined_object THEN NULL;
END
$$;

ALTER TABLE public.fixture_lineups REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- 15.1 Authority wrapper — the `lineup` duty (or `*` / a fixture pin).
--      Deliberately separate from `score`: naming a starting XI is a coach
--      action, not a scoreboard action, so a scout hired to tap goals cannot
--      quietly rewrite the formation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_fixture_lineup(p_fixture_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT public.can_write_fixture(p_fixture_id, ARRAY['lineup']);
$fn$;

GRANT EXECUTE ON FUNCTION public.can_write_fixture_lineup(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 15.2 The single write path. One call = one slot:
--        p_remove = FALSE  → upsert that slot (validated)
--        p_remove = TRUE   → delete that slot
--      The team must be one of this fixture's own two teams, the player must
--      belong to that team (or the athlete must exist), the subject must be a
--      player XOR an athlete, and the coordinates must stay in the 0..1 unit
--      square the canvas renders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_fixture_lineup(
    p_fixture_id UUID,
    p_team_id UUID,
    p_slot INT,
    p_x NUMERIC,
    p_y NUMERIC,
    p_player_id UUID DEFAULT NULL,
    p_athlete_id UUID DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_is_captain BOOLEAN DEFAULT FALSE,
    p_remove BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_home UUID;
    v_away UUID;
    v_team_players INT;
    v_row public.fixture_lineups%ROWTYPE;
BEGIN
    IF NOT public.can_write_fixture_lineup(p_fixture_id) THEN
        RAISE EXCEPTION 'Not authorized to edit the lineup for this fixture'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT home_team_id, away_team_id INTO v_home, v_away
    FROM public.fixtures WHERE id = p_fixture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    IF p_team_id IS NULL OR p_team_id NOT IN (v_home, v_away) THEN
        RAISE EXCEPTION 'Team % is not playing in this fixture', p_team_id;
    END IF;

    IF p_remove THEN
        DELETE FROM public.fixture_lineups
        WHERE fixture_id = p_fixture_id AND team_id = p_team_id AND slot = p_slot;
        RETURN jsonb_build_object('removed', TRUE, 'slot', p_slot);
    END IF;

    IF p_slot IS NULL OR p_slot < 1 OR p_slot > 99 THEN
        RAISE EXCEPTION 'Slot must be between 1 and 99';
    END IF;

    IF p_x IS NULL OR p_x < 0 OR p_x > 1 OR p_y IS NULL OR p_y < 0 OR p_y > 1 THEN
        RAISE EXCEPTION 'Coordinates must be between 0 and 1';
    END IF;

    IF p_player_id IS NOT NULL AND p_athlete_id IS NOT NULL THEN
        RAISE EXCEPTION 'A lineup slot is either a player or an athlete, not both';
    END IF;

    IF p_player_id IS NULL AND p_athlete_id IS NULL THEN
        RAISE EXCEPTION 'A lineup slot needs a player or an athlete';
    END IF;

    IF p_player_id IS NOT NULL THEN
        SELECT count(*) INTO v_team_players
        FROM public.players
        WHERE id = p_player_id AND team_id = p_team_id;
        IF v_team_players = 0 THEN
            RAISE EXCEPTION 'Player % does not belong to team %', p_player_id, p_team_id;
        END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.athletes WHERE id = p_athlete_id) THEN
        RAISE EXCEPTION 'Athlete % not found', p_athlete_id;
    END IF;

    IF p_role IS NOT NULL AND char_length(btrim(p_role)) > 80 THEN
        RAISE EXCEPTION 'Role must be at most 80 characters';
    END IF;

    INSERT INTO public.fixture_lineups (
        fixture_id, team_id, player_id, athlete_id, role, slot, x, y, is_captain, created_by
    )
    VALUES (
        p_fixture_id, p_team_id, p_player_id, p_athlete_id,
        NULLIF(btrim(COALESCE(p_role, '')), ''), p_slot, p_x, p_y,
        COALESCE(p_is_captain, FALSE), auth.uid()
    )
    ON CONFLICT (fixture_id, team_id, slot) DO UPDATE SET
        player_id  = EXCLUDED.player_id,
        athlete_id = EXCLUDED.athlete_id,
        role       = EXCLUDED.role,
        x          = EXCLUDED.x,
        y          = EXCLUDED.y,
        is_captain = EXCLUDED.is_captain,
        updated_at = NOW()
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'fixture_id', v_row.fixture_id,
        'team_id', v_row.team_id,
        'player_id', v_row.player_id,
        'athlete_id', v_row.athlete_id,
        'role', v_row.role,
        'slot', v_row.slot,
        'x', v_row.x,
        'y', v_row.y,
        'is_captain', v_row.is_captain
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_fixture_lineup(UUID, UUID, INT, NUMERIC, NUMERIC, UUID, UUID, TEXT, BOOLEAN, BOOLEAN)
    TO authenticated;

-- ============================================================================
-- END OF SETUP
-- ============================================================================
-- Quick self-check: function count must be well above zero.
--   SELECT count(*) AS tables
--     FROM pg_tables WHERE schemaname = 'public';
--   SELECT count(*) AS functions
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public';
-- ============================================================================
