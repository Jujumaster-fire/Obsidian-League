-- ============================================================================
-- PART 0 — Base schema (idempotent)
-- ============================================================================
-- The original `schema.sql` + `schema_updates.sql`, merged and made
-- re-runnable: every CREATE is guarded and every policy is dropped by name
-- before it is recreated, so running this file twice is a no-op.
--
-- Later parts (01..14) evolve this base: they widen the CHECK constraints,
-- split the roles, and replace the write policies with duty-scoped ones. That
-- is intentional — the file reads top-to-bottom as the history of the schema,
-- and each part is individually idempotent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- user_roles — global application role (app_admin | tournament_admin | user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50),
    logo_url TEXT,
    coach VARCHAR(255),
    attire_color VARCHAR(100) DEFAULT 'Yet to be decided',
    roster TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Staff columns (schema_updates.sql).
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS medical_staff TEXT;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS tactical_coach VARCHAR(255);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS assistant_coach VARCHAR(255);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS kit_personnel TEXT;

-- Category / type columns (schema_updates.sql). These CHECKs are the narrow
-- originals; part 05 (§6c/§6d) drops and re-adds the wide lists.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Male'
    CHECK (category IN ('Male', 'Female'));
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS team_type VARCHAR(50) DEFAULT 'Football'
    CHECK (team_type IN ('Football', 'Futsal'));

-- ---------------------------------------------------------------------------
-- fixtures (matches)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fixtures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    home_team_id UUID NOT NULL REFERENCES public.teams(id),
    away_team_id UUID NOT NULL REFERENCES public.teams(id),
    match_date TIMESTAMP WITH TIME ZONE NOT NULL,
    venue VARCHAR(255),
    status VARCHAR(50) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'half_time', 'full_time', 'cancelled')),
    home_score INT DEFAULT 0,
    away_score INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- match_events (timeline: goals, cards, corners, subs, whistles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fixture_id UUID NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL
        CHECK (event_type IN ('goal', 'red_card', 'yellow_card', 'corner', 'free_kick',
                              'substitution', 'half_time_whistle', 'full_time_whistle', 'kick_off')),
    team_id UUID REFERENCES public.teams(id),
    player_id UUID,
    player_name VARCHAR(255),
    minute INT NOT NULL,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- tournament_settings (schema_updates.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    format VARCHAR(50) DEFAULT 'league'
        CHECK (format IN ('knockouts', 'league', 'group_to_knockout')),
    table_arrangement TEXT,
    rules TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- is_admin(): legacy global admin check.
-- Part 06 redefines this as "app_admin OR any tournament membership"; part 07
-- narrows the policies that used to lean on it. It stays defined here so the
-- base policies below can reference it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
    role_val VARCHAR;
BEGIN
    SELECT role INTO role_val FROM public.user_roles WHERE user_id = auth.uid();
    RETURN role_val = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- Base policies (dropped by name first so this file stays re-runnable).
-- Write policies here are the legacy global ones; parts 06-09 replace them
-- with app_admin / duty-scoped policies. Reads stay public throughout.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
CREATE POLICY "Users can view their own role" ON public.user_roles
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles
    FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view teams" ON public.teams;
CREATE POLICY "Anyone can view teams" ON public.teams FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert teams" ON public.teams;
CREATE POLICY "Admins can insert teams" ON public.teams
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update teams" ON public.teams;
CREATE POLICY "Admins can update teams" ON public.teams
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete teams" ON public.teams;
CREATE POLICY "Admins can delete teams" ON public.teams
    FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view fixtures" ON public.fixtures;
CREATE POLICY "Anyone can view fixtures" ON public.fixtures FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert fixtures" ON public.fixtures;
CREATE POLICY "Admins can insert fixtures" ON public.fixtures
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update fixtures" ON public.fixtures;
CREATE POLICY "Admins can update fixtures" ON public.fixtures
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete fixtures" ON public.fixtures;
CREATE POLICY "Admins can delete fixtures" ON public.fixtures
    FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view match events" ON public.match_events;
CREATE POLICY "Anyone can view match events" ON public.match_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert match events" ON public.match_events;
CREATE POLICY "Admins can insert match events" ON public.match_events
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update match events" ON public.match_events;
CREATE POLICY "Admins can update match events" ON public.match_events
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete match events" ON public.match_events;
CREATE POLICY "Admins can delete match events" ON public.match_events
    FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view tournament settings" ON public.tournament_settings;
CREATE POLICY "Anyone can view tournament settings" ON public.tournament_settings
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert tournament settings" ON public.tournament_settings;
CREATE POLICY "Admins can insert tournament settings" ON public.tournament_settings
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update tournament settings" ON public.tournament_settings;
CREATE POLICY "Admins can update tournament settings" ON public.tournament_settings
    FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete tournament settings" ON public.tournament_settings;
CREATE POLICY "Admins can delete tournament settings" ON public.tournament_settings
    FOR DELETE USING (public.is_admin());

-- Live-match columns (schema_updates.sql).
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS current_minute INT DEFAULT 0;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT
    '{"home": {"passes": 0, "shots": 0, "fouls": 0, "corners": 0}, "away": {"passes": 0, "shots": 0, "fouls": 0, "corners": 0}}'::jsonb;