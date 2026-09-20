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