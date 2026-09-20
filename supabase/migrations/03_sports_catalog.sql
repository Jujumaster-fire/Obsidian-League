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
