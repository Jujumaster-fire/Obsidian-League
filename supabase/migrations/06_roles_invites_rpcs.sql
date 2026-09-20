-- ============================================================================
-- Migration 06 — Roles split, invites, scoped stat/score RPCs (Phase 4)
-- ============================================================================
-- Purpose:
--   * Widen user_roles.role from ('admin','user') to
--     ('app_admin','tournament_admin','user'); migrate 'admin' rows.
--   * Helpers: is_app_admin(), is_tournament_admin(uuid); redefine is_admin()
--     as (app_admin OR any tournament membership) for backward compat.
--   * tournament_members (duties TEXT[], '*' = full manager) + RLS.
--   * tournament_invites (unlimited-use tokens) + RLS + public
--     get_invite_info(token) SECURITY DEFINER reader for /invite/[token].
--   * accept_tournament_invite(token) SECURITY DEFINER accept flow.
--   * Atomic duty-checked record_stat() / record_score() RPCs.
--   * ADD (never replace) "Tournament members can ..." write policies on
--     scoped tables; fixtures rows with NULL tournament_id stay
--     app_admin-only (safe default).
--
-- Idempotency: re-runnable. Tables use CREATE TABLE IF NOT EXISTS; the
--   legacy role CHECK is dropped by catalog lookup (its inline definition
--   has an auto-generated name, so we match pg_constraint rows on
--   user_roles whose definition mentions `role` but not `app_admin`);
--   policies are created inside DO blocks guarded by pg_policies; policies
--   for Phase-3/5 tables (athletes, fixture_entries, players,
--   tournament_posts) are additionally guarded by to_regclass /
--   information_schema column checks so this file applies cleanly whether
--   or not those tables exist yet.
--
-- Depends on: supabase/schema.sql (user_roles, teams, fixtures,
--   match_events, is_admin), supabase/schema_updates.sql (fixtures.stats,
--   tournament_settings), 02_tournaments_core.sql (tournaments,
--   tournament_id scoping), 03_sports_catalog.sql (sports.stat_vocab).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Roles split: ('admin','user') -> ('app_admin','tournament_admin','user')
-- --------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop any legacy CHECK on user_roles.role that does not yet know the
    -- new role values. The original CHECK was declared inline (no explicit
    -- name), so resolve it via the catalog instead of hardcoding.
    FOR r IN
        SELECT c.conname AS conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'user_roles'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%role%'
          AND pg_get_constraintdef(c.oid) NOT LIKE '%app_admin%'
    LOOP
        EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', r.conname);
    END LOOP;

    -- Migrate legacy rows BEFORE re-adding the CHECK (old CHECK rejects
    -- 'app_admin', new CHECK rejects 'admin' — so drop -> update -> add).
    UPDATE public.user_roles SET role = 'app_admin' WHERE role = 'admin';

    -- Re-add the widened CHECK (skip if already present on re-runs).
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'user_roles'
          AND c.conname = 'user_roles_role_check'
    ) THEN
        ALTER TABLE public.user_roles
            ADD CONSTRAINT user_roles_role_check
            CHECK (role IN ('app_admin', 'tournament_admin', 'user'));
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so they work inside RLS policies)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    role_val TEXT;
BEGIN
    SELECT ur.role INTO role_val
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid();
    RETURN COALESCE(role_val, '') = 'app_admin';
END;
$$;

-- tournament_members is created just below (section 2 table); plpgsql
-- bodies are validated at execution time in any case.
CREATE TABLE IF NOT EXISTS public.tournament_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    duties TEXT[] NOT NULL DEFAULT '{*}',
    granted_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tournament_members_tournament_user UNIQUE (tournament_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_tournament_admin(tournament_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF tournament_uuid IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.tournament_members m
        WHERE m.tournament_id = tournament_uuid
          AND m.user_id = auth.uid()
    );
END;
$$;

-- Backward compat: legacy is_admin() now means "app admin OR member of any
-- tournament". CREATE OR REPLACE preserves the OID so existing policies
-- referencing is_admin() keep working.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF public.is_app_admin() THEN
        RETURN TRUE;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.tournament_members m
        WHERE m.user_id = auth.uid()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_app_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_admin(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. tournament_members + RLS
--    SELECT: members see their own rows; app_admin sees all.
--    INSERT/UPDATE/DELETE: app_admin only (invite accept flow uses the
--    SECURITY DEFINER function in section 4, bypassing RLS).
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tournament_members_tournament_id
    ON public.tournament_members (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_members_user_id
    ON public.tournament_members (user_id);

ALTER TABLE public.tournament_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'Users can view their own memberships'
    ) THEN
        CREATE POLICY "Users can view their own memberships"
            ON public.tournament_members FOR SELECT
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can view all memberships'
    ) THEN
        CREATE POLICY "App admins can view all memberships"
            ON public.tournament_members FOR SELECT
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can insert memberships'
    ) THEN
        CREATE POLICY "App admins can insert memberships"
            ON public.tournament_members FOR INSERT
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can update memberships'
    ) THEN
        CREATE POLICY "App admins can update memberships"
            ON public.tournament_members FOR UPDATE
            USING (public.is_app_admin())
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'App admins can delete memberships'
    ) THEN
        CREATE POLICY "App admins can delete memberships"
            ON public.tournament_members FOR DELETE
            USING (public.is_app_admin());
    END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_members TO authenticated;

-- --------------------------------------------------------------------------
-- 3. tournament_invites + RLS + public get_invite_info(token)
--    SELECT: app_admin + full ('*') managers of that tournament; plus a
--    public valid-only policy (not revoked AND not expired) so the invite
--    link resolves. RLS cannot column-filter, so the public /invite/[token]
--    page MUST use get_invite_info() below (SECURITY DEFINER, returns only
--    tournament name/slug/duties/expires_at/valid) instead of selecting the
--    table directly (which would also expose created_by / token metadata).
--    INSERT/UPDATE/DELETE: app_admin or '*' manager of that tournament.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    duties TEXT[] NOT NULL DEFAULT '{*}',
    created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_invites_tournament_id
    ON public.tournament_invites (tournament_id);

ALTER TABLE public.tournament_invites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can view invites'
    ) THEN
        CREATE POLICY "App admins can view invites"
            ON public.tournament_invites FOR SELECT
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can view invites'
    ) THEN
        CREATE POLICY "Tournament managers can view invites"
            ON public.tournament_invites FOR SELECT
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Public can view valid invites'
    ) THEN
        CREATE POLICY "Public can view valid invites"
            ON public.tournament_invites FOR SELECT
            USING (revoked = FALSE AND expires_at > NOW());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can create invites'
    ) THEN
        CREATE POLICY "App admins can create invites"
            ON public.tournament_invites FOR INSERT
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can create invites'
    ) THEN
        CREATE POLICY "Tournament managers can create invites"
            ON public.tournament_invites FOR INSERT
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can update invites'
    ) THEN
        CREATE POLICY "App admins can update invites"
            ON public.tournament_invites FOR UPDATE
            USING (public.is_app_admin())
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can update invites'
    ) THEN
        -- Revoke path: app_admin or '*' manager of the invite's tournament.
        CREATE POLICY "Tournament managers can update invites"
            ON public.tournament_invites FOR UPDATE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'App admins can delete invites'
    ) THEN
        CREATE POLICY "App admins can delete invites"
            ON public.tournament_invites FOR DELETE
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Tournament managers can delete invites'
    ) THEN
        CREATE POLICY "Tournament managers can delete invites"
            ON public.tournament_invites FOR DELETE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.tournament_members m
                    WHERE m.tournament_id = tournament_invites.tournament_id
                      AND m.user_id = auth.uid()
                      AND m.duties @> ARRAY['*']
                )
            );
    END IF;
END
$$;

GRANT SELECT ON public.tournament_invites TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_invites TO authenticated;

-- Public invite-page reader: exposes only the safe subset, never
-- created_by. Callable by anon + authenticated.
CREATE OR REPLACE FUNCTION public.get_invite_info(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_inv public.tournament_invites%ROWTYPE;
    v_name TEXT;
    v_slug TEXT;
BEGIN
    SELECT * INTO v_inv
    FROM public.tournament_invites i
    WHERE i.token = p_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', FALSE);
    END IF;

    SELECT t.name, t.slug INTO v_name, v_slug
    FROM public.tournaments t
    WHERE t.id = v_inv.tournament_id;

    RETURN jsonb_build_object(
        'valid', (v_inv.revoked = FALSE AND v_inv.expires_at > NOW()),
        'tournament_id', v_inv.tournament_id,
        'tournament_name', v_name,
        'tournament_slug', v_slug,
        'duties', to_jsonb(COALESCE(v_inv.duties, '{*}')),
        'expires_at', v_inv.expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_info(TEXT) TO anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. accept_tournament_invite(p_token text) -> json
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_tournament_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv public.tournament_invites%ROWTYPE;
    v_slug TEXT;
    v_uid UUID;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT * INTO v_inv
    FROM public.tournament_invites i
    WHERE i.token = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite not found';
    END IF;
    IF v_inv.revoked THEN
        RAISE EXCEPTION 'Invite has been revoked';
    END IF;
    IF v_inv.expires_at <= NOW() THEN
        RAISE EXCEPTION 'Invite has expired';
    END IF;

    INSERT INTO public.tournament_members (tournament_id, user_id, duties, granted_by)
    VALUES (v_inv.tournament_id, v_uid, COALESCE(v_inv.duties, '{*}'), v_inv.created_by)
    ON CONFLICT (tournament_id, user_id) DO NOTHING;

    -- Promote to tournament_admin only from 'user'; never demote app_admin
    -- (and leave existing tournament_admin rows untouched). Inserts a row
    -- when the user has no user_roles row yet.
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'tournament_admin')
    ON CONFLICT (user_id) DO UPDATE
        SET role = 'tournament_admin'
        WHERE public.user_roles.role = 'user';

    SELECT t.slug INTO v_slug
    FROM public.tournaments t
    WHERE t.id = v_inv.tournament_id;

    RETURN jsonb_build_object(
        'tournament_id', v_inv.tournament_id,
        'tournament_slug', v_slug,
        'duties', to_jsonb(COALESCE(v_inv.duties, '{*}'))
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_tournament_invite(TEXT) TO authenticated;

-- --------------------------------------------------------------------------
-- 5. record_stat(p_fixture_id uuid, p_side text, p_stat_key text) -> int
--    Atomic duty-checked increment of stats->side->key by 1.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_stat(p_fixture_id UUID, p_side TEXT, p_stat_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
    v_sport_id UUID;
    v_vocab JSONB;
    v_allowed BOOLEAN := FALSE;
    v_new INTEGER;
    c_legacy TEXT[] := ARRAY[
        'passes', 'shots', 'shots_on_target', 'shots_off_target',
        'fouls', 'corners', 'freekicks', 'offsides',
        'yellow_cards', 'red_cards', 'gk_saves', 'interceptions'
    ];
BEGIN
    IF p_side NOT IN ('home', 'away') THEN
        RAISE EXCEPTION 'Invalid side %: must be ''home'' or ''away''', p_side;
    END IF;
    IF p_stat_key IS NULL OR p_stat_key = '' THEN
        RAISE EXCEPTION 'Stat key must not be empty';
    END IF;

    SELECT f.tournament_id, f.sport_id
      INTO v_tournament_id, v_sport_id
    FROM public.fixtures f
    WHERE f.id = p_fixture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fixture % not found', p_fixture_id;
    END IF;

    -- Caller must be app_admin, or a member of the fixture's tournament
    -- whose duties contain '*' or the exact stat key. Fixtures with NULL
    -- tournament_id fall through to app_admin-only (safe default).
    IF NOT public.is_app_admin() THEN
        IF v_tournament_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM public.tournament_members m
            WHERE m.tournament_id = v_tournament_id
              AND m.user_id = auth.uid()
              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY[p_stat_key])
        ) THEN
            RAISE EXCEPTION 'Not authorized to record stats for this fixture';
        END IF;
    END IF;

    -- Validate the stat key against the sport's stat_vocab (array of plain
    -- keys or objects carrying key/stat/name). When the fixture has no
    -- sport, the sport row is gone, or the vocab is empty, fall back to
    -- the 12 legacy football keys.
    IF v_sport_id IS NULL THEN
        v_allowed := p_stat_key = ANY (c_legacy);
    ELSE
        SELECT s.stat_vocab INTO v_vocab
        FROM public.sports s
        WHERE s.id = v_sport_id;

        IF v_vocab IS NULL
           OR (jsonb_typeof(v_vocab) = 'array' AND jsonb_array_length(v_vocab) = 0)
           OR (jsonb_typeof(v_vocab) <> 'array') THEN
            v_allowed := p_stat_key = ANY (c_legacy);
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(v_vocab) e
                WHERE e = to_jsonb(p_stat_key)
                   OR (jsonb_typeof(e) = 'object' AND e ->> 'key' = p_stat_key)
                   OR (jsonb_typeof(e) = 'object' AND e ->> 'stat' = p_stat_key)
                   OR (jsonb_typeof(e) = 'object' AND e ->> 'name' = p_stat_key)
            ) INTO v_allowed;
        END IF;
    END IF;

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Unknown stat key % for this fixture''s sport', p_stat_key;
    END IF;

    -- Single-statement atomic increment (no read-modify-write race):
    -- ensure the side object exists, then bump the key.
    UPDATE public.fixtures
    SET stats = jsonb_set(
            jsonb_set(
                COALESCE(stats, '{}'::jsonb),
                ARRAY[p_side],
                COALESCE(stats -> p_side, '{}'::jsonb),
                TRUE
            ),
            ARRAY[p_side, p_stat_key],
            to_jsonb(COALESCE((stats -> p_side ->> p_stat_key)::INT, 0) + 1),
            TRUE
        ),
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING (stats -> p_side ->> p_stat_key)::INT INTO v_new;

    RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stat(UUID, TEXT, TEXT) TO authenticated;

-- --------------------------------------------------------------------------
-- 6. record_score(p_fixture_id uuid, p_home int, p_away int) -> fixtures row
--    Same membership check, but requires '*' or the 'score' duty.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_score(p_fixture_id UUID, p_home INT, p_away INT)
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

    IF p_home IS NULL OR p_home < 0 OR p_away IS NULL OR p_away < 0 THEN
        RAISE EXCEPTION 'Scores must be non-negative integers';
    END IF;

    IF NOT public.is_app_admin() THEN
        IF v_tournament_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM public.tournament_members m
            WHERE m.tournament_id = v_tournament_id
              AND m.user_id = auth.uid()
              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['score'])
        ) THEN
            RAISE EXCEPTION 'Not authorized to record the score for this fixture';
        END IF;
    END IF;

    UPDATE public.fixtures
    SET home_score = p_home,
        away_score = p_away,
        updated_at = NOW()
    WHERE id = p_fixture_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_score(UUID, INT, INT) TO authenticated;

-- --------------------------------------------------------------------------
-- 7. Scoped write policies (ADD, never replace existing Admins policies).
--    Pattern everywhere: is_app_admin() OR is_tournament_admin(<row's
--    tournament>). Parent-linked tables resolve the tournament via scalar
--    subquery. Fixtures with NULL tournament_id stay app_admin-only.
-- --------------------------------------------------------------------------

-- teams (direct tournament_id) ---------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teams'
          AND policyname = 'Tournament members can insert teams'
    ) THEN
        CREATE POLICY "Tournament members can insert teams"
            ON public.teams FOR INSERT
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teams'
          AND policyname = 'Tournament members can update teams'
    ) THEN
        CREATE POLICY "Tournament members can update teams"
            ON public.teams FOR UPDATE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            )
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teams'
          AND policyname = 'Tournament members can delete teams'
    ) THEN
        CREATE POLICY "Tournament members can delete teams"
            ON public.teams FOR DELETE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;
END
$$;

-- fixtures (direct tournament_id; NULL stays app_admin-only) ----------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixtures'
          AND policyname = 'Tournament members can insert fixtures'
    ) THEN
        CREATE POLICY "Tournament members can insert fixtures"
            ON public.fixtures FOR INSERT
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixtures'
          AND policyname = 'Tournament members can update fixtures'
    ) THEN
        CREATE POLICY "Tournament members can update fixtures"
            ON public.fixtures FOR UPDATE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            )
            WITH CHECK (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fixtures'
          AND policyname = 'Tournament members can delete fixtures'
    ) THEN
        CREATE POLICY "Tournament members can delete fixtures"
            ON public.fixtures FOR DELETE
            USING (
                public.is_app_admin()
                OR (tournament_id IS NOT NULL
                    AND public.is_tournament_admin(tournament_id))
            );
    END IF;
END
$$;

-- match_events (direct tournament_id OR parent fixture's tournament) --------
DO $$
DECLARE
    has_tournament BOOLEAN;
    has_fixture BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'match_events'
          AND column_name = 'tournament_id'
    ) INTO has_tournament;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'match_events'
          AND column_name = 'fixture_id'
    ) INTO has_fixture;

    IF NOT has_fixture AND NOT has_tournament THEN
        RAISE NOTICE 'match_events has neither fixture_id nor tournament_id; skipping member policies';
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'match_events'
              AND policyname = 'Tournament members can insert match events'
        ) THEN
            IF has_tournament AND has_fixture THEN
                CREATE POLICY "Tournament members can insert match events"
                    ON public.match_events FOR INSERT
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSIF has_fixture THEN
                CREATE POLICY "Tournament members can insert match events"
                    ON public.match_events FOR INSERT
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSE
                CREATE POLICY "Tournament members can insert match events"
                    ON public.match_events FOR INSERT
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    );
            END IF;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'match_events'
              AND policyname = 'Tournament members can update match events'
        ) THEN
            IF has_tournament AND has_fixture THEN
                CREATE POLICY "Tournament members can update match events"
                    ON public.match_events FOR UPDATE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    )
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSIF has_fixture THEN
                CREATE POLICY "Tournament members can update match events"
                    ON public.match_events FOR UPDATE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    )
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSE
                CREATE POLICY "Tournament members can update match events"
                    ON public.match_events FOR UPDATE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    )
                    WITH CHECK (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    );
            END IF;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'match_events'
              AND policyname = 'Tournament members can delete match events'
        ) THEN
            IF has_tournament AND has_fixture THEN
                CREATE POLICY "Tournament members can delete match events"
                    ON public.match_events FOR DELETE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSIF has_fixture THEN
                CREATE POLICY "Tournament members can delete match events"
                    ON public.match_events FOR DELETE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin((
                            SELECT f.tournament_id
                            FROM public.fixtures f
                            WHERE f.id = fixture_id
                        ))
                    );
            ELSE
                CREATE POLICY "Tournament members can delete match events"
                    ON public.match_events FOR DELETE
                    USING (
                        public.is_app_admin()
                        OR public.is_tournament_admin(tournament_id)
                    );
            END IF;
        END IF;
    END IF;
END
$$;

-- athletes (Phase 3 table; direct tournament_id) -----------------------------
DO $$
BEGIN
    IF to_regclass('public.athletes') IS NULL THEN
        RAISE NOTICE 'public.athletes does not exist yet; skipping member policies (Phase 3 migration adds them)';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'athletes'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.athletes has no tournament_id column; skipping member policies';
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'athletes'
              AND policyname = 'Tournament members can insert athletes'
        ) THEN
            CREATE POLICY "Tournament members can insert athletes"
                ON public.athletes FOR INSERT
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'athletes'
              AND policyname = 'Tournament members can update athletes'
        ) THEN
            CREATE POLICY "Tournament members can update athletes"
                ON public.athletes FOR UPDATE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'athletes'
              AND policyname = 'Tournament members can delete athletes'
        ) THEN
            CREATE POLICY "Tournament members can delete athletes"
                ON public.athletes FOR DELETE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;
    END IF;
END
$$;

-- fixture_entries (Phase 3 table; via parent fixture -> tournament_id) --------
DO $$
DECLARE
    has_direct BOOLEAN;
    has_fixture BOOLEAN;
BEGIN
    IF to_regclass('public.fixture_entries') IS NULL THEN
        RAISE NOTICE 'public.fixture_entries does not exist yet; skipping member policies (Phase 3 migration adds them)';
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'fixture_entries'
              AND column_name = 'tournament_id'
        ) INTO has_direct;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'fixture_entries'
              AND column_name = 'fixture_id'
        ) INTO has_fixture;

        IF NOT has_direct AND NOT has_fixture THEN
            RAISE NOTICE 'public.fixture_entries has neither tournament_id nor fixture_id; skipping member policies';
        ELSE
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'fixture_entries'
                  AND policyname = 'Tournament members can insert fixture entries'
            ) THEN
                IF has_direct AND has_fixture THEN
                    CREATE POLICY "Tournament members can insert fixture entries"
                        ON public.fixture_entries FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSIF has_fixture THEN
                    CREATE POLICY "Tournament members can insert fixture entries"
                        ON public.fixture_entries FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can insert fixture entries"
                        ON public.fixture_entries FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'fixture_entries'
                  AND policyname = 'Tournament members can update fixture entries'
            ) THEN
                IF has_direct AND has_fixture THEN
                    CREATE POLICY "Tournament members can update fixture entries"
                        ON public.fixture_entries FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSIF has_fixture THEN
                    CREATE POLICY "Tournament members can update fixture entries"
                        ON public.fixture_entries FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can update fixture entries"
                        ON public.fixture_entries FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'fixture_entries'
                  AND policyname = 'Tournament members can delete fixture entries'
            ) THEN
                IF has_direct AND has_fixture THEN
                    CREATE POLICY "Tournament members can delete fixture entries"
                        ON public.fixture_entries FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSIF has_fixture THEN
                    CREATE POLICY "Tournament members can delete fixture entries"
                        ON public.fixture_entries FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT f.tournament_id
                                FROM public.fixtures f
                                WHERE f.id = fixture_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can delete fixture entries"
                        ON public.fixture_entries FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;
        END IF;
    END IF;
END
$$;

-- players (Phase 3 table; via parent team -> tournament_id) ------------------
DO $$
DECLARE
    has_team BOOLEAN;
    has_direct BOOLEAN;
BEGIN
    IF to_regclass('public.players') IS NULL THEN
        RAISE NOTICE 'public.players does not exist yet; skipping member policies (Phase 3 migration adds them)';
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'players'
              AND column_name = 'team_id'
        ) INTO has_team;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'players'
              AND column_name = 'tournament_id'
        ) INTO has_direct;

        IF NOT has_team AND NOT has_direct THEN
            RAISE NOTICE 'public.players has neither team_id nor tournament_id; skipping member policies';
        ELSE
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'players'
                  AND policyname = 'Tournament members can insert players'
            ) THEN
                IF has_team AND has_direct THEN
                    CREATE POLICY "Tournament members can insert players"
                        ON public.players FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSIF has_team THEN
                    CREATE POLICY "Tournament members can insert players"
                        ON public.players FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can insert players"
                        ON public.players FOR INSERT
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'players'
                  AND policyname = 'Tournament members can update players'
            ) THEN
                IF has_team AND has_direct THEN
                    CREATE POLICY "Tournament members can update players"
                        ON public.players FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSIF has_team THEN
                    CREATE POLICY "Tournament members can update players"
                        ON public.players FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can update players"
                        ON public.players FOR UPDATE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        )
                        WITH CHECK (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'players'
                  AND policyname = 'Tournament members can delete players'
            ) THEN
                IF has_team AND has_direct THEN
                    CREATE POLICY "Tournament members can delete players"
                        ON public.players FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSIF has_team THEN
                    CREATE POLICY "Tournament members can delete players"
                        ON public.players FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin((
                                SELECT t.tournament_id
                                FROM public.teams t
                                WHERE t.id = team_id
                            ))
                        );
                ELSE
                    CREATE POLICY "Tournament members can delete players"
                        ON public.players FOR DELETE
                        USING (
                            public.is_app_admin()
                            OR public.is_tournament_admin(tournament_id)
                        );
                END IF;
            END IF;
        END IF;
    END IF;
END
$$;

-- tournament_posts (Phase 5 table; only if it exists) -------------------------
DO $$
BEGIN
    IF to_regclass('public.tournament_posts') IS NULL THEN
        RAISE NOTICE 'public.tournament_posts does not exist yet; skipping member policies (Phase 5 migration adds them)';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tournament_posts'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.tournament_posts has no tournament_id column; skipping member policies';
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can insert tournament posts'
        ) THEN
            CREATE POLICY "Tournament members can insert tournament posts"
                ON public.tournament_posts FOR INSERT
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can update tournament posts'
        ) THEN
            CREATE POLICY "Tournament members can update tournament posts"
                ON public.tournament_posts FOR UPDATE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can delete tournament posts'
        ) THEN
            CREATE POLICY "Tournament members can delete tournament posts"
                ON public.tournament_posts FOR DELETE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;
    END IF;
END
$$;

-- tournament_settings (per-tournament; legacy NULL rows stay app_admin-only) --
DO $$
BEGIN
    IF to_regclass('public.tournament_settings') IS NULL THEN
        RAISE NOTICE 'public.tournament_settings does not exist; skipping member policies';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tournament_settings'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.tournament_settings has no tournament_id column; skipping member policies';
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can insert tournament settings'
        ) THEN
            CREATE POLICY "Tournament members can insert tournament settings"
                ON public.tournament_settings FOR INSERT
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can update tournament settings'
        ) THEN
            CREATE POLICY "Tournament members can update tournament settings"
                ON public.tournament_settings FOR UPDATE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can delete tournament settings'
        ) THEN
            CREATE POLICY "Tournament members can delete tournament settings"
                ON public.tournament_settings FOR DELETE
                USING (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND public.is_tournament_admin(tournament_id))
                );
        END IF;
    END IF;
END
$$;
