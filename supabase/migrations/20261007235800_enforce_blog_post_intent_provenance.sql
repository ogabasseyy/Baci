-- Provenance without an intent is an orphan: the API routes already clear
-- intent_source whenever the effective intent is nullish, but direct
-- PostgREST writes by content administrators bypass that cleanup and can
-- still create source-only rows that contaminate source-based reporting.
-- Enforce the same invariant in the database. The repair first clears rows
-- that predated this boundary so the VALIDATE step cannot fail on legacy
-- data. (Merchant rows trivially satisfy this check: the merchant boundary
-- forces both columns to NULL there.)
UPDATE public.blog_posts
SET intent_source = NULL
WHERE intent IS NULL
  AND intent_source IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blog_posts_intent_provenance'
      AND conrelid = 'public.blog_posts'::regclass
  ) THEN
    ALTER TABLE public.blog_posts
      ADD CONSTRAINT blog_posts_intent_provenance
      CHECK (intent IS NOT NULL OR intent_source IS NULL)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.blog_posts
  VALIDATE CONSTRAINT blog_posts_intent_provenance;
