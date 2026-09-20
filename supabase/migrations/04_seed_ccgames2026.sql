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
