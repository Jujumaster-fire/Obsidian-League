-- Add new staff columns to teams table
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS medical_staff TEXT;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS tactical_coach VARCHAR(255);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS assistant_coach VARCHAR(255);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS kit_personnel TEXT;

-- Create tournament_settings table
CREATE TABLE IF NOT EXISTS public.tournament_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    format VARCHAR(50) DEFAULT 'league' CHECK (format IN ('knockouts', 'league', 'group_to_knockout')),
    table_arrangement TEXT,
    rules TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.tournament_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view tournament settings" ON public.tournament_settings FOR SELECT USING (true);
CREATE POLICY "Admins can insert tournament settings" ON public.tournament_settings FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update tournament settings" ON public.tournament_settings FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete tournament settings" ON public.tournament_settings FOR DELETE USING (public.is_admin());
