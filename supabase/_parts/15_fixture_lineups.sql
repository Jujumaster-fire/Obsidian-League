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

