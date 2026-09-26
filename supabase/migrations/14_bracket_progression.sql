-- Migration 14: Bracket Progression
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS next_fixture_id UUID REFERENCES public.fixtures(id) ON DELETE SET NULL;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS next_fixture_slot TEXT CHECK (next_fixture_slot IN ('home', 'away'));

CREATE OR REPLACE FUNCTION public.advance_bracket_winner()
RETURNS TRIGGER AS $$
BEGIN
    -- Only act if the match just finished and has a next fixture linked
    IF NEW.status = 'full_time' AND OLD.status != 'full_time' AND NEW.next_fixture_id IS NOT NULL THEN
        IF NEW.home_score > NEW.away_score THEN
            IF NEW.next_fixture_slot = 'home' THEN
                UPDATE public.fixtures SET home_team_id = NEW.home_team_id WHERE id = NEW.next_fixture_id;
            ELSIF NEW.next_fixture_slot = 'away' THEN
                UPDATE public.fixtures SET away_team_id = NEW.home_team_id WHERE id = NEW.next_fixture_id;
            END IF;
        ELSIF NEW.away_score > NEW.home_score THEN
            IF NEW.next_fixture_slot = 'home' THEN
                UPDATE public.fixtures SET home_team_id = NEW.away_team_id WHERE id = NEW.next_fixture_id;
            ELSIF NEW.next_fixture_slot = 'away' THEN
                UPDATE public.fixtures SET away_team_id = NEW.away_team_id WHERE id = NEW.next_fixture_id;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_advance_bracket ON public.fixtures;
CREATE TRIGGER trg_advance_bracket
AFTER UPDATE OF status ON public.fixtures
FOR EACH ROW
EXECUTE FUNCTION public.advance_bracket_winner();
