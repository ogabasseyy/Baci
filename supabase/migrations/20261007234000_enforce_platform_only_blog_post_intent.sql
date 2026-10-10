-- Intent metadata is platform-editorial taxonomy, but merchants can UPDATE any
-- column on their rows through PostgREST: blog_posts_merchant_update_v2 does
-- not restrict intent or intent_source. Force both columns to NULL on merchant
-- rows so a direct API write cannot contaminate intent cohorts. Merchant rows
-- are exactly merchant_id IS NOT NULL (see chk_platform_post_merchant in the
-- baseline). The repair first clears rows that predated this boundary so the
-- VALIDATE step cannot fail on legacy data.
UPDATE public.blog_posts
SET intent = NULL,
    intent_source = NULL
WHERE merchant_id IS NOT NULL
  AND (intent IS NOT NULL OR intent_source IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blog_posts_merchant_intent_null'
      AND conrelid = 'public.blog_posts'::regclass
  ) THEN
    ALTER TABLE public.blog_posts
      ADD CONSTRAINT blog_posts_merchant_intent_null
      CHECK (merchant_id IS NULL OR (intent IS NULL AND intent_source IS NULL))
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.blog_posts
  VALIDATE CONSTRAINT blog_posts_merchant_intent_null;
