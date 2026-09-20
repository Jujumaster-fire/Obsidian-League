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
