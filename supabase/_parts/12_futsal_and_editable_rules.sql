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