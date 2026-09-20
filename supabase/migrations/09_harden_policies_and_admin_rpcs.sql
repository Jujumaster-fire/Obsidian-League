-- ============================================================================
-- Migration 09 — Tighten widened policies, scale indexes, admin RPCs
-- ============================================================================
-- Why this exists:
--   06_roles_invites_rpcs.sql redefined `is_admin()` to mean "app_admin OR
--   member of any tournament" so legacy policies (written when only one admin
--   role existed) started granting tournament members write access to
--   *global* tables. 07_tighten_legacy_policies.sql fixed teams, fixtures,
--   match_events and tournament_settings but not the remaining ones. This
--   migration finishes that work and adds the small set of RPCs the admin UI
--   needs (user administration, invite creation/revocation, member listing).
--
-- Sections:
--   1. Drop legacy `is_admin()`-based policies that are now over-broad and
--      re-create them as app_admin-only (scoped member policies from 06 stay).
--   2. Let tournament members see the other members of their own tournaments.
--   3. Composite/partial indexes for the hot public read paths.
--   4. SECURITY DEFINER RPCs: list_app_users(), set_user_role(),
--      list_tournament_members(), create_tournament_invite(),
--      revoke_tournament_invite().
--
-- Idempotency: fully re-runnable (catalog-guarded drops/creates, IF NOT
--   EXISTS indexes, CREATE OR REPLACE functions).
--
-- Depends on: schema.sql, 02_tournaments_core.sql, 03_sports_catalog.sql,
--   05_athletes_entries_players.sql, 06_roles_invites_rpcs.sql.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------------
-- 1. Replace over-broad legacy write policies with app_admin-only policies
-- --------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('user_roles',        'Admins can view all roles'),
            ('tournaments',       'Admins can insert tournaments'),
            ('tournaments',       'Admins can update tournaments'),
            ('tournaments',       'Admins can delete tournaments'),
            ('sports',            'Admins can insert sports'),
            ('sports',            'Admins can update sports'),
            ('sports',            'Admins can delete sports'),
            ('sport_divisions',   'Admins can insert sport divisions'),
            ('sport_divisions',   'Admins can update sport divisions'),
            ('sport_divisions',   'Admins can delete sport divisions'),
            ('tournament_sports', 'Admins can insert tournament sports'),
            ('tournament_sports', 'Admins can update tournament sports'),
            ('tournament_sports', 'Admins can delete tournament sports'),
            ('athletes',          'Admins can insert athletes'),
            ('athletes',          'Admins can update athletes'),
            ('athletes',          'Admins can delete athletes'),
            ('players',           'Admins can insert players'),
            ('players',           'Admins can update players'),
            ('players',           'Admins can delete players'),
            ('fixture_entries',   'Admins can insert fixture entries'),
            ('fixture_entries',   'Admins can update fixture entries'),
            ('fixture_entries',   'Admins can delete fixture entries')
        ) AS legacy(tbl, pol)
    LOOP
        IF to_regclass('public.' || r.tbl) IS NULL THEN
            CONTINUE;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = r.tbl
              AND policyname = r.pol
        ) THEN
            EXECUTE format('DROP POLICY %I ON public.%I', r.pol, r.tbl);
        END IF;
    END LOOP;
END
$$;
DO $$
DECLARE
    r RECORD;
    v_name TEXT;
    v_stmt TEXT;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('user_roles',        'SELECT'),
            ('user_roles',        'INSERT'),
            ('user_roles',        'UPDATE'),
            ('user_roles',        'DELETE'),
            ('tournaments',       'INSERT'),
            ('tournaments',       'UPDATE'),
            ('tournaments',       'DELETE'),
            ('sports',            'INSERT'),
            ('sports',            'UPDATE'),
            ('sports',            'DELETE'),
            ('sport_divisions',   'INSERT'),
            ('sport_divisions',   'UPDATE'),
            ('sport_divisions',   'DELETE'),
            ('tournament_sports', 'INSERT'),
            ('tournament_sports', 'UPDATE'),
            ('tournament_sports', 'DELETE'),
            ('athletes',          'INSERT'),
            ('athletes',          'UPDATE'),
            ('athletes',          'DELETE'),
            ('players',           'INSERT'),
            ('players',           'UPDATE'),
            ('players',           'DELETE'),
            ('fixture_entries',   'INSERT'),
            ('fixture_entries',   'UPDATE'),
            ('fixture_entries',   'DELETE')
        ) AS scoped(tbl, act)
    LOOP
        IF to_regclass('public.' || r.tbl) IS NULL THEN
            CONTINUE;
        END IF;

        IF r.act = 'SELECT' THEN
            v_name := 'App admins can view all ' || replace(r.tbl, '_', ' ');
        ELSE
            v_name := 'App admins can ' || lower(r.act) || ' ' || replace(r.tbl, '_', ' ');
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = r.tbl
              AND policyname = v_name
        ) THEN
            v_stmt := CASE r.act
                WHEN 'INSERT' THEN
                    format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.is_app_admin())', v_name, r.tbl)
                WHEN 'UPDATE' THEN
                    format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.is_app_admin()) WITH CHECK (public.is_app_admin())', v_name, r.tbl)
                ELSE
                    format('CREATE POLICY %I ON public.%I FOR %s USING (public.is_app_admin())', v_name, r.tbl, r.act)
            END;
            EXECUTE v_stmt;
        END IF;
    END LOOP;
END
$$;
-- --------------------------------------------------------------------------
-- 2. Tournament members can see their co-members (needed by the admin
--    tournament detail screen). Rows stay scoped to tournaments they are in.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_members'
          AND policyname = 'Tournament members can view tournament memberships'
    ) THEN
        CREATE POLICY "Tournament members can view tournament memberships"
            ON public.tournament_members FOR SELECT
            USING (public.is_tournament_admin(tournament_id));
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 3. Scale indexes for the hot public read paths.
--    The public hub filters/sorts by match date and status, event feeds by
--    fixture, and the medal table by team/athlete.
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_match_events_fixture_id
    ON public.match_events (fixture_id);

CREATE INDEX IF NOT EXISTS idx_match_events_fixture_created
    ON public.match_events (fixture_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fixtures_match_date
    ON public.fixtures (match_date);

CREATE INDEX IF NOT EXISTS idx_fixtures_status_match_date
    ON public.fixtures (status, match_date);

CREATE INDEX IF NOT EXISTS idx_fixtures_tournament_match_date
    ON public.fixtures (tournament_id, match_date);

CREATE INDEX IF NOT EXISTS idx_fixture_entries_team_medal
    ON public.fixture_entries (team_id, medal);

CREATE INDEX IF NOT EXISTS idx_fixture_entries_athlete_medal
    ON public.fixture_entries (athlete_id, medal);

CREATE INDEX IF NOT EXISTS idx_teams_tournament_group
    ON public.teams (tournament_id, group_name);

CREATE INDEX IF NOT EXISTS idx_tournament_members_tournament_duties
    ON public.tournament_members USING GIN (duties);

-- --------------------------------------------------------------------------
-- 3b. Keep updated_at fresh (some environments created tables without it).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.tournaments') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tournaments_updated_at') THEN
        CREATE TRIGGER trg_tournaments_updated_at
            BEFORE UPDATE ON public.tournaments
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;

    IF to_regclass('public.fixtures') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fixtures_updated_at') THEN
        CREATE TRIGGER trg_fixtures_updated_at
            BEFORE UPDATE ON public.fixtures
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;

    IF to_regclass('public.tournament_settings') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tournament_settings_updated_at') THEN
        CREATE TRIGGER trg_tournament_settings_updated_at
            BEFORE UPDATE ON public.tournament_settings
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END
-- --------------------------------------------------------------------------
-- 4. Admin RPCs (SECURITY DEFINER + explicit authorization checks)
-- --------------------------------------------------------------------------
-- 4a. App-wide user directory (email lives in auth.users, which the anon key
--     cannot read, so expose a guarded projection instead).
CREATE OR REPLACE FUNCTION public.list_app_users()
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    role TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Not authorized to list users';
    END IF;

    RETURN QUERY
    SELECT u.id,
           u.email::TEXT,
           COALESCE(r.role, 'user')::TEXT,
           u.created_at
    FROM auth.users u
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    ORDER BY u.created_at DESC
    LIMIT 1000;
END;
$$;

-- 4b. Grant / change a user's global role. Self-demotion is blocked so an app
--     admin can never lock themselves (or the last admin) out by accident.
CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id UUID, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Not authorized to change roles';
    END IF;
    IF p_role NOT IN ('app_admin', 'tournament_admin', 'user') THEN
        RAISE EXCEPTION 'Invalid role %', p_role;
    END IF;
    IF p_user_id = auth.uid() AND p_role <> 'app_admin' THEN
        RAISE EXCEPTION 'You cannot remove your own app admin role';
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

    RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role);
END;
$$;

-- 4c. Members of a tournament (with emails) for the admin detail screen.
CREATE OR REPLACE FUNCTION public.list_tournament_members(p_tournament_id UUID)
RETURNS TABLE (
    membership_id UUID,
    user_id UUID,
    email TEXT,
    duties TEXT[],
    granted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF NOT (public.is_app_admin() OR public.is_tournament_admin(p_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to list this tournament''s members';
    END IF;

    RETURN QUERY
    SELECT m.id,
           m.user_id,
           u.email::TEXT,
           m.duties,
           m.granted_at
    FROM public.tournament_members m
    LEFT JOIN auth.users u ON u.id = m.user_id
    WHERE m.tournament_id = p_tournament_id
    ORDER BY m.granted_at ASC;
END;
$$;
-- 4d. Create an invite token server-side (cryptographically random, so the
--     token never depends on client entropy).
CREATE OR REPLACE FUNCTION public.create_tournament_invite(
    p_tournament_id UUID,
    p_duties TEXT[] DEFAULT ARRAY['*'],
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_expires TIMESTAMPTZ;
    v_duties TEXT[];
BEGIN
    IF NOT public.is_app_admin() THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.tournament_members m
            WHERE m.tournament_id = p_tournament_id
              AND m.user_id = auth.uid()
              AND m.duties @> ARRAY['*']
        ) THEN
            RAISE EXCEPTION 'Not authorized to create invites for this tournament';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id) THEN
        RAISE EXCEPTION 'Tournament % not found', p_tournament_id;
    END IF;

    v_duties := COALESCE(p_duties, ARRAY['*']);
    IF array_length(v_duties, 1) IS NULL THEN
        v_duties := ARRAY['*'];
    END IF;

    v_expires := COALESCE(p_expires_at, NOW() + INTERVAL '7 days');
    v_token := encode(gen_random_bytes(24), 'hex');

    INSERT INTO public.tournament_invites (tournament_id, token, duties, created_by, expires_at)
    VALUES (p_tournament_id, v_token, v_duties, auth.uid(), v_expires);

    RETURN jsonb_build_object(
        'token', v_token,
        'expires_at', v_expires,
        'duties', to_jsonb(v_duties)
    );
END;
$$;

-- 4e. Revoke an invite (keeps the audit row, flips `revoked`).
CREATE OR REPLACE FUNCTION public.revoke_tournament_invite(p_invite_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
BEGIN
    SELECT i.tournament_id INTO v_tournament_id
    FROM public.tournament_invites i
    WHERE i.id = p_invite_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite % not found', p_invite_id;
    END IF;

    IF NOT public.is_app_admin() THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.tournament_members m
            WHERE m.tournament_id = v_tournament_id
              AND m.user_id = auth.uid()
              AND m.duties @> ARRAY['*']
        ) THEN
            RAISE EXCEPTION 'Not authorized to revoke invites for this tournament';
        END IF;
    END IF;

    UPDATE public.tournament_invites
    SET revoked = TRUE
    WHERE id = p_invite_id;

    RETURN TRUE;
END;
$$;

-- 4f. Invite list for a tournament (token included so managers can share it).
CREATE OR REPLACE FUNCTION public.list_tournament_invites(p_tournament_id UUID)
RETURNS TABLE (
    invite_id UUID,
    token TEXT,
    duties TEXT[],
    expires_at TIMESTAMPTZ,
    revoked BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    IF NOT (public.is_app_admin() OR public.is_tournament_admin(p_tournament_id)) THEN
        RAISE EXCEPTION 'Not authorized to list this tournament''s invites';
    END IF;

    RETURN QUERY
    SELECT i.id, i.token, i.duties, i.expires_at, i.revoked, i.created_at
    FROM public.tournament_invites i
    WHERE i.tournament_id = p_tournament_id
    ORDER BY i.created_at DESC
    LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_app_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tournament_members(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tournament_invite(UUID, TEXT[], TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_tournament_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tournament_invites(UUID) TO authenticated;
$$;