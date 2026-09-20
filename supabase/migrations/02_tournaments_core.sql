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
