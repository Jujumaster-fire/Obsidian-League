-- ============================================================================
-- Migration 12 — Harden remaining RLS policies (mirrors db-setup.sql)
--
-- Fixes three gaps the migration chain inherited from 05/06/08:
--   H1 — 06 granted anon SELECT on tournament_invites + a public valid-only
--        policy, leaking invite tokens. Revoke + drop.
--   M1 — 08 gave any tournament_member write on tournament_posts via
--        is_tournament_admin() with no duty check. Now requires 'posts'/'*'.
--   M2 — 06 gave any tournament_member write on tournament_settings via
--        is_tournament_admin(). Now requires '*' (full manager) or app_admin.
--   M3 — 05 granted storage.objects logo writes through legacy is_admin().
--        Now scoped to app_admin.
--
-- Idempotency: guarded by pg_policies existence checks. Re-running is a no-op.
-- Depends on: 05 (storage), 06 (invites), 08 (tournament_posts).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------------
-- H1: tournament_invites token leak.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_invites'
          AND policyname = 'Public can view valid invites'
    ) THEN
        DROP POLICY "Public can view valid invites" ON public.tournament_invites;
    END IF;
END
$$;

REVOKE SELECT ON public.tournament_invites FROM anon;
REVOKE SELECT ON public.tournament_invites FROM authenticated;

-- --------------------------------------------------------------------------
-- M1: tournament_posts writes — duty-scoped to 'posts' or '*' plus app_admin.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.tournament_posts') IS NULL THEN
        RAISE NOTICE 'public.tournament_posts does not exist; skipping';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tournament_posts'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.tournament_posts has no tournament_id column; skipping';
    ELSE
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can insert tournament posts'
        ) THEN
            DROP POLICY "Tournament members can insert tournament posts" ON public.tournament_posts;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can update tournament posts'
        ) THEN
            DROP POLICY "Tournament members can update tournament posts" ON public.tournament_posts;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_posts'
              AND policyname = 'Tournament members can delete tournament posts'
        ) THEN
            DROP POLICY "Tournament members can delete tournament posts" ON public.tournament_posts;
        END IF;
        END IF;

        -- Re-create as duty-scoped.
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
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
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
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
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
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_posts.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts'])
                        ))
                );
        END IF;
    END IF;
END
$$;

-- --------------------------------------------------------------------------
-- M2: tournament_settings writes — duty-scoped to '*' plus app_admin.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.tournament_settings') IS NULL THEN
        RAISE NOTICE 'public.tournament_settings does not exist; skipping';
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tournament_settings'
          AND column_name = 'tournament_id'
    ) THEN
        RAISE NOTICE 'public.tournament_settings has no tournament_id column; skipping';
    ELSE
    ELSE
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can insert tournament settings'
        ) THEN
            DROP POLICY "Tournament members can insert tournament settings" ON public.tournament_settings;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can update tournament settings'
        ) THEN
            DROP POLICY "Tournament members can update tournament settings" ON public.tournament_settings;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tournament_settings'
              AND policyname = 'Tournament members can delete tournament settings'
        ) THEN
            DROP POLICY "Tournament members can delete tournament settings" ON public.tournament_settings;
        END IF;

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
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
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
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
                )
                WITH CHECK (
                    public.is_app_admin()
                    OR (tournament_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
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
                        AND EXISTS (
                            SELECT 1 FROM public.tournament_members m
                            WHERE m.tournament_id = tournament_settings.tournament_id
                              AND m.user_id = auth.uid()
                              AND (m.duties @> ARRAY['*'])
                        ))
                );
        END IF;
    END IF;
END
$$;
END
$$;

-- --------------------------------------------------------------------------
-- M3: storage.objects logos bucket — replace legacy is_admin() policies.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can insert logos'
    ) THEN
        DROP POLICY "Admins can insert logos" ON storage.objects;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'App admins can insert logos'
    ) THEN
        CREATE POLICY "App admins can insert logos"
            ON storage.objects FOR INSERT WITH CHECK (
                bucket_id = 'logos'
                AND EXISTS (
                    SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
                )
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can update logos'
    ) THEN
        DROP POLICY "Admins can update logos" ON storage.objects;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'App admins can update logos'
    ) THEN
        CREATE POLICY "App admins can update logos"
            ON storage.objects FOR UPDATE USING (
                bucket_id = 'logos'
                AND EXISTS (
                    SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
                )
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Admins can delete logos'
    ) THEN
        DROP POLICY "Admins can delete logos" ON storage.objects;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'App admins can delete logos'
    ) THEN
        CREATE POLICY "App admins can delete logos"
            ON storage.objects FOR DELETE USING (
                bucket_id = 'logos'
                AND EXISTS (
                    SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
                )
            );
    END IF;
END
$$;