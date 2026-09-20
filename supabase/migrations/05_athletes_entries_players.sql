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

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can insert logos'
    ) THEN
        CREATE POLICY "Admins can insert logos"
            ON storage.objects FOR INSERT WITH CHECK (
                bucket_id = 'logos' AND public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can update logos'
    ) THEN
        CREATE POLICY "Admins can update logos"
            ON storage.objects FOR UPDATE USING (
                bucket_id = 'logos' AND public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can delete logos'
    ) THEN
        CREATE POLICY "Admins can delete logos"
            ON storage.objects FOR DELETE USING (
                bucket_id = 'logos' AND public.is_admin());
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
