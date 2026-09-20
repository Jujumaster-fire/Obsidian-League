-- ============================================================================
-- Migration 08 — tournament_posts (Phase 5: blog / news surface)
-- ============================================================================
-- Purpose:
--   * Create the `tournament_posts` table the Batch 4/5 work depends on
--     (admin CRUD + public news list/detail + homepage carousel). Migration 06
--     already contains the member-scoped write policies for this table but
--     skipped them because the table did not exist yet (`to_regclass` guard);
--     the policies are re-created here so a single run of 08 is sufficient.
--   * RLS: public may read published posts; app_admin reads/writes everything;
--     tournament members may read all posts of their tournament and write when
--     their duties include '*' or 'posts'.
--   * Indexes for the public list (`tournament_id, published_at DESC`) and for
--     slug lookups.
--
-- Idempotency: re-runnable. CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
--   EXISTS, and every policy inside a pg_policies guard.
--
-- Depends on: supabase/schema.sql (auth.users), 02_tournaments_core.sql
--   (tournaments), 06_roles_invites_rpcs.sql (is_app_admin,
--   is_tournament_admin, is_admin).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.tournament_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    excerpt TEXT,
    body TEXT,
    image_url TEXT,
    category TEXT NOT NULL DEFAULT 'News',
    author_id UUID,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tournament_posts_slug_check
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- FK to tournaments (guarded; re-runnable).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_posts'
          AND c.conname = 'fk_tournament_posts_tournament_id'
    ) THEN
        ALTER TABLE public.tournament_posts
            ADD CONSTRAINT fk_tournament_posts_tournament_id
            FOREIGN KEY (tournament_id)
            REFERENCES public.tournaments (id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_posts'
          AND c.conname = 'fk_tournament_posts_author_id'
    ) THEN
        ALTER TABLE public.tournament_posts
            ADD CONSTRAINT fk_tournament_posts_author_id
            FOREIGN KEY (author_id)
            REFERENCES auth.users (id)
            ON DELETE SET NULL;
    END IF;

    -- One slug per tournament (URLs are /news/<slug>).
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'tournament_posts'
          AND c.conname = 'uq_tournament_posts_tournament_slug'
    ) THEN
        ALTER TABLE public.tournament_posts
            ADD CONSTRAINT uq_tournament_posts_tournament_slug
            UNIQUE (tournament_id, slug);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_tournament_posts_tournament_published
    ON public.tournament_posts (tournament_id, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_tournament_posts_slug
    ON public.tournament_posts (slug);

CREATE INDEX IF NOT EXISTS idx_tournament_posts_published_at
    ON public.tournament_posts (published_at DESC NULLS LAST)
    WHERE published IS TRUE;

ALTER TABLE public.tournament_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Anyone can view published tournament posts'
    ) THEN
        CREATE POLICY "Anyone can view published tournament posts"
            ON public.tournament_posts FOR SELECT
            USING (published IS TRUE AND published_at IS NOT NULL AND published_at <= NOW());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can manage tournament posts'
    ) THEN
        CREATE POLICY "App admins can manage tournament posts"
            ON public.tournament_posts FOR SELECT
            USING (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'Tournament members can view tournament posts'
    ) THEN
        CREATE POLICY "Tournament members can view tournament posts"
            ON public.tournament_posts FOR SELECT
            USING (public.is_tournament_admin(tournament_id));
    END IF;
END
$$;
-- Write policies: app_admin everywhere; members scoped to their tournament
-- with the '*' or 'posts' duty.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can insert tournament posts'
    ) THEN
        CREATE POLICY "App admins can insert tournament posts"
            ON public.tournament_posts FOR INSERT
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can update tournament posts'
    ) THEN
        CREATE POLICY "App admins can update tournament posts"
            ON public.tournament_posts FOR UPDATE
            USING (public.is_app_admin())
            WITH CHECK (public.is_app_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tournament_posts'
          AND policyname = 'App admins can delete tournament posts'
    ) THEN
        CREATE POLICY "App admins can delete tournament posts"
            ON public.tournament_posts FOR DELETE
            USING (public.is_app_admin());
    END IF;

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
END
$$;

-- Keep updated_at fresh without app changes.
CREATE OR REPLACE FUNCTION public.touch_tournament_posts_updated_at()
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
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_tournament_posts_updated_at'
    ) THEN
        CREATE TRIGGER trg_tournament_posts_updated_at
            BEFORE UPDATE ON public.tournament_posts
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_tournament_posts_updated_at();
    END IF;
END
$$;