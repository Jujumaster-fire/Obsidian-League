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