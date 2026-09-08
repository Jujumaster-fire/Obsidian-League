-- Create Tournament Settings table
CREATE TABLE IF NOT EXISTS public.tournament_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rules_text TEXT,
    rules_pdf_url TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert a default row so we always have one to update
INSERT INTO public.tournament_settings (rules_text, rules_pdf_url)
SELECT 'Default Rules', ''
WHERE NOT EXISTS (SELECT 1 FROM public.tournament_settings);

-- Enable RLS
ALTER TABLE public.tournament_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view tournament settings" ON public.tournament_settings FOR SELECT USING (true);
CREATE POLICY "Admins can insert tournament settings" ON public.tournament_settings FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update tournament settings" ON public.tournament_settings FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete tournament settings" ON public.tournament_settings FOR DELETE USING (public.is_admin());
