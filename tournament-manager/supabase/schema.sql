-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USER ROLES
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure user_id is unique so a user has only one role record
CREATE UNIQUE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

-- TEAMS
CREATE TABLE public.teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50),
    logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- FIXTURES (Matches)
CREATE TABLE public.fixtures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    home_team_id UUID NOT NULL REFERENCES public.teams(id),
    away_team_id UUID NOT NULL REFERENCES public.teams(id),
    match_date TIMESTAMP WITH TIME ZONE NOT NULL,
    venue VARCHAR(255),
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'half_time', 'full_time', 'cancelled')),
    home_score INT DEFAULT 0,
    away_score INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- MATCH EVENTS (Goals, Cards, Corners, Subs, Whistles)
CREATE TABLE public.match_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fixture_id UUID NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('goal', 'red_card', 'yellow_card', 'corner', 'free_kick', 'substitution', 'half_time_whistle', 'full_time_whistle', 'kick_off')),
    team_id UUID REFERENCES public.teams(id), -- Nullable for neutral events like whistles
    player_id UUID, -- If you had a players table, this would reference it. For now, it could be a text field or UUID if added later.
    player_name VARCHAR(255), -- Storing name directly for simplicity in this iteration
    minute INT NOT NULL, -- Match minute (e.g., 45, 90)
    details TEXT, -- Extra info (e.g., "Player A out, Player B in")
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ROW LEVEL SECURITY (RLS) POLICIES --

-- Enable RLS on all public tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;

-- Helper function to check if the current user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
    role_val VARCHAR;
BEGIN
    SELECT role INTO role_val FROM public.user_roles WHERE user_id = auth.uid();
    RETURN role_val = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policies for user_roles (Admins can view all, users can view their own)
CREATE POLICY "Users can view their own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT USING (public.is_admin());

-- Policies for teams (Anyone can read, Admins can write)
CREATE POLICY "Anyone can view teams" ON public.teams FOR SELECT USING (true);
CREATE POLICY "Admins can insert teams" ON public.teams FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update teams" ON public.teams FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete teams" ON public.teams FOR DELETE USING (public.is_admin());

-- Policies for fixtures (Anyone can read, Admins can write)
CREATE POLICY "Anyone can view fixtures" ON public.fixtures FOR SELECT USING (true);
CREATE POLICY "Admins can insert fixtures" ON public.fixtures FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update fixtures" ON public.fixtures FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete fixtures" ON public.fixtures FOR DELETE USING (public.is_admin());

-- Policies for match_events (Anyone can read, Admins can write)
CREATE POLICY "Anyone can view match events" ON public.match_events FOR SELECT USING (true);
CREATE POLICY "Admins can insert match events" ON public.match_events FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update match events" ON public.match_events FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete match events" ON public.match_events FOR DELETE USING (public.is_admin());
