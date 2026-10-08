-- =============================================
-- REGRESSION TEST: merchant rows keep intent null
--   Validates 20261007234000_enforce_platform_only_blog_post_intent.sql.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/blog_post_merchant_intent_null.sql
--
-- This script mutates inside a transaction and rolls back. It assert-fails
-- (RAISE EXCEPTION) when the boundary constraint is missing, when a merchant
-- row can persist intent metadata, or when a platform row cannot.
-- =============================================

BEGIN;

-- Merchant writes fire the canonical audit trigger, which rejects actorless
-- callers (28000), so the fixtures run under the service actor like the
-- other SQL checks that seed merchants.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  merchant_row_id uuid := '99999999-9999-9999-9999-999999999999';
  merchant_post_id uuid;
  rejected boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blog_posts_merchant_intent_null'
      AND conrelid = 'public.blog_posts'::regclass
  ) THEN
    RAISE EXCEPTION 'blog_posts_merchant_intent_null constraint missing on public.blog_posts';
  END IF;

  INSERT INTO public.merchants (id, email)
  VALUES (merchant_row_id, 'intent-boundary@example.com');

  -- Merchant rows persist fine with null intent columns.
  INSERT INTO public.blog_posts (merchant_id, title, slug, content, author_name)
  VALUES (merchant_row_id, 'Merchant post', 'intent-boundary-merchant', 'body', 'Author')
  RETURNING id INTO merchant_post_id;

  -- Direct PostgREST-style writes of intent on a merchant row must fail,
  -- on both the INSERT and UPDATE paths.
  BEGIN
    INSERT INTO public.blog_posts
      (merchant_id, title, slug, content, author_name, intent, intent_source)
    VALUES
      (merchant_row_id, 'Sneaky', 'intent-boundary-sneaky', 'body', 'Author', 'news', 'platform');
    rejected := false;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'merchant INSERT with intent metadata must violate blog_posts_merchant_intent_null';
  END IF;

  BEGIN
    UPDATE public.blog_posts
    SET intent = 'news', intent_source = 'platform'
    WHERE id = merchant_post_id;
    rejected := false;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'merchant UPDATE with intent metadata must violate blog_posts_merchant_intent_null';
  END IF;

  -- Platform rows keep their editorial taxonomy.
  INSERT INTO public.blog_posts
    (is_platform_post, title, slug, content, author_name, intent, intent_source)
  VALUES
    (true, 'Platform post', 'intent-boundary-platform', 'body', 'Author', 'news', 'platform');

  RAISE NOTICE 'blog_posts_merchant_intent_null boundary holds';
END;
$$;

ROLLBACK;
