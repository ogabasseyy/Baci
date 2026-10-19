-- =============================================
-- REGRESSION TEST: intent provenance stays consistent
--   Validates 20261007235800_enforce_blog_post_intent_provenance.sql.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/blog_post_intent_provenance.sql
--
-- This script mutates inside a transaction and rolls back. It assert-fails
-- (RAISE EXCEPTION) when the provenance constraint is missing, when a row
-- can persist an intent_source without an intent, or when a valid
-- intent/source pair is rejected.
-- =============================================

BEGIN;

DO $$
DECLARE
  platform_post_id uuid;
  rejected boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blog_posts_intent_provenance'
      AND conrelid = 'public.blog_posts'::regclass
  ) THEN
    RAISE EXCEPTION 'blog_posts_intent_provenance constraint missing on public.blog_posts';
  END IF;

  -- No orphan provenance may survive the migration repair.
  IF EXISTS (
    SELECT 1
    FROM public.blog_posts
    WHERE intent IS NULL AND intent_source IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'orphan intent_source rows survived the provenance repair';
  END IF;

  -- A platform row with a valid intent/source pair persists fine.
  INSERT INTO public.blog_posts
    (is_platform_post, title, slug, content, author_name, intent, intent_source)
  VALUES
    (true, 'Platform post', 'intent-provenance-pair', 'body', 'Author', 'news', 'platform')
  RETURNING id INTO platform_post_id;

  -- Direct PostgREST-style writes of a source without an intent must fail,
  -- on both the INSERT and UPDATE paths.
  BEGIN
    INSERT INTO public.blog_posts
      (is_platform_post, title, slug, content, author_name, intent_source)
    VALUES
      (true, 'Orphan', 'intent-provenance-orphan', 'body', 'Author', 'platform');
    rejected := false;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'platform INSERT with orphan intent_source must violate blog_posts_intent_provenance';
  END IF;

  BEGIN
    UPDATE public.blog_posts
    SET intent = NULL, intent_source = 'platform'
    WHERE id = platform_post_id;
    rejected := false;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'platform UPDATE with orphan intent_source must violate blog_posts_intent_provenance';
  END IF;

  -- Clearing the intent alongside the source stays legal.
  UPDATE public.blog_posts
  SET intent = NULL, intent_source = NULL
  WHERE id = platform_post_id;

  RAISE NOTICE 'blog_posts_intent_provenance boundary holds';
END;
$$;

ROLLBACK;
