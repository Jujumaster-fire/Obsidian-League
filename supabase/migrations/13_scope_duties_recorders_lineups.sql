-- 13: scope authority, duty-checked recorder RPCs and fixture lineups.
--
-- Mirrors PARTs 12-15 of supabase/db-setup.sql. Without this migration the
-- push path produces a database with no `has_tournament_duty()` /
-- `can_write_fixture()` / `record_match_event()` / `claim_fixture_scope()` /
-- `set_fixture_lineup()` / per-match rule surface, so the live console
-- degrades on every fixture.
--
-- Generated from supabase/_parts/12..15: edit those parts, regenerate
-- db-setup.sql, then mirror the change here (same rule as 00_base_schema.sql).
-- Every statement is idempotent, so running it on a database that already
-- has the surface (via db-setup.sql) is a no-op.
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
