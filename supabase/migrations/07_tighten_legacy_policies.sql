-- 07: tighten legacy unscoped write policies.
-- 06_roles redefined is_admin() as app_admin OR any tournament member, which
-- widened the legacy "Admins can ..." policies on teams/fixtures/match_events/
-- tournament_settings to all tournament members, including rows outside their
-- tournament (or with NULL tournament_id). This migration replaces those with
-- app_admin-only policies; member-scoped policies from 06 remain in force.
-- Idempotent: every DROP guarded by pg_policies lookup.

DO $$ BEGIN
  -- teams
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='Admins can insert teams') THEN
    DROP POLICY "Admins can insert teams" ON public.teams;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='Admins can update teams') THEN
    DROP POLICY "Admins can update teams" ON public.teams;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='Admins can delete teams') THEN
    DROP POLICY "Admins can delete teams" ON public.teams;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='App admins can insert teams') THEN
    CREATE POLICY "App admins can insert teams" ON public.teams FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='App admins can update teams') THEN
    CREATE POLICY "App admins can update teams" ON public.teams FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='teams' AND policyname='App admins can delete teams') THEN
    CREATE POLICY "App admins can delete teams" ON public.teams FOR DELETE USING (public.is_app_admin());
  END IF;

  -- fixtures
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='Admins can insert fixtures') THEN
    DROP POLICY "Admins can insert fixtures" ON public.fixtures;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='Admins can update fixtures') THEN
    DROP POLICY "Admins can update fixtures" ON public.fixtures;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='Admins can delete fixtures') THEN
    DROP POLICY "Admins can delete fixtures" ON public.fixtures;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='App admins can insert fixtures') THEN
    CREATE POLICY "App admins can insert fixtures" ON public.fixtures FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='App admins can update fixtures') THEN
    CREATE POLICY "App admins can update fixtures" ON public.fixtures FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fixtures' AND policyname='App admins can delete fixtures') THEN
    CREATE POLICY "App admins can delete fixtures" ON public.fixtures FOR DELETE USING (public.is_app_admin());
  END IF;

  -- match_events
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='Admins can insert match events') THEN
    DROP POLICY "Admins can insert match events" ON public.match_events;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='Admins can update match events') THEN
    DROP POLICY "Admins can update match events" ON public.match_events;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='Admins can delete match events') THEN
    DROP POLICY "Admins can delete match events" ON public.match_events;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='App admins can insert match events') THEN
    CREATE POLICY "App admins can insert match events" ON public.match_events FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='App admins can update match events') THEN
    CREATE POLICY "App admins can update match events" ON public.match_events FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_events' AND policyname='App admins can delete match events') THEN
    CREATE POLICY "App admins can delete match events" ON public.match_events FOR DELETE USING (public.is_app_admin());
  END IF;

  -- tournament_settings (legacy global policies from schema_updates.sql)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='Admins can insert tournament settings') THEN
    DROP POLICY "Admins can insert tournament settings" ON public.tournament_settings;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='Admins can update tournament settings') THEN
    DROP POLICY "Admins can update tournament settings" ON public.tournament_settings;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='Admins can delete tournament settings') THEN
    DROP POLICY "Admins can delete tournament settings" ON public.tournament_settings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='App admins can insert tournament settings') THEN
    CREATE POLICY "App admins can insert tournament settings" ON public.tournament_settings FOR INSERT WITH CHECK (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='App admins can update tournament settings') THEN
    CREATE POLICY "App admins can update tournament settings" ON public.tournament_settings FOR UPDATE USING (public.is_app_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_settings' AND policyname='App admins can delete tournament settings') THEN
    CREATE POLICY "App admins can delete tournament settings" ON public.tournament_settings FOR DELETE USING (public.is_app_admin());
  END IF;
END $$;
