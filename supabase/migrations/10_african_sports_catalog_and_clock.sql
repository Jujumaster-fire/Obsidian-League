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