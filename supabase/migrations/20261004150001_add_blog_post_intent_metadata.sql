-- Persist coarse editorial intent so performance cohorts do not collapse into
-- an untyped bucket. Existing rows intentionally remain NULL (unknown history).
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS intent_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blog_posts_intent_allowed_values'
      AND conrelid = 'public.blog_posts'::regclass
  ) THEN
    ALTER TABLE public.blog_posts
      ADD CONSTRAINT blog_posts_intent_allowed_values
      CHECK (intent IS NULL OR intent IN (
        'news', 'comparison', 'repair-guide', 'buying-guide', 'platform', 'unknown'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.blog_posts
  VALIDATE CONSTRAINT blog_posts_intent_allowed_values;
