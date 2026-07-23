-- Add new columns to the teams table for coach, attire color, and a simple roster list
ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS coach VARCHAR(255),
ADD COLUMN IF NOT EXISTS attire_color VARCHAR(100) DEFAULT 'Yet to be decided',
ADD COLUMN IF NOT EXISTS roster TEXT; -- We will use a TEXT field to store comma-separated player names for simplicity in this iteration
