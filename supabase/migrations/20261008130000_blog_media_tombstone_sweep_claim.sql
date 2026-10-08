-- Atomic tombstone sweep claim with API-first removal and cross-scope
-- reference protection.
--
-- The sweep used to read due tombstones, scan references, and remove
-- objects in separate statements, so a post save committing between
-- the final read and the removal lost the race and its media was
-- deleted. The claim below locks the due rows and flags unreferenced
-- ones in one transaction; the Storage API then performs the actual
-- deletion (direct SQL deletes would orphan file bytes), and the
-- sweep drops the claimed rows. A concurrent save clearing these rows
-- blocks on the row locks until the claim commits, then its
-- post-insert verification sees claimed flags or missing metadata and
-- rolls back loudly instead of persisting broken media. Claimed rows
-- persist until the API removal succeeds, so a crashed sweep retries
-- its bytes instead of leaking them. The reference scan covers every
-- persisted blog row: merchant article content accepts sanitized HTTPS
-- images, so a merchant post can embed a public platform URL that
-- staging must never remove.
ALTER TABLE public.blog_media_delete_tombstones
  ADD COLUMN IF NOT EXISTS claimed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.claim_sweepable_blog_media_tombstones(
  p_cutoff TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS TABLE (tombstone_path TEXT, tombstone_claimed BOOLEAN)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_due TEXT[];
BEGIN
  SELECT pg_catalog.array_agg(locked.path ORDER BY locked.created_at)
    INTO v_due
    FROM (
      SELECT tomb.path, tomb.created_at
        FROM public.blog_media_delete_tombstones AS tomb
       WHERE tomb.created_at < p_cutoff
       ORDER BY tomb.created_at
       LIMIT LEAST(GREATEST(p_limit, 0), 1000)
       FOR UPDATE
    ) AS locked;
  IF v_due IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH referenced AS (
    SELECT DISTINCT candidate AS path
      FROM public.blog_posts AS post
     CROSS JOIN pg_catalog.unnest(v_due) AS candidate
     WHERE pg_catalog.strpos(post.content, candidate) > 0
        OR pg_catalog.strpos(post.excerpt, candidate) > 0
        OR pg_catalog.strpos(post.featured_image_url, candidate) > 0
        OR pg_catalog.strpos(post.author_image_url, candidate) > 0
        OR pg_catalog.strpos(post.featured_image_variants::text, candidate) > 0
  ),
  newly_claimed AS (
    UPDATE public.blog_media_delete_tombstones AS tomb
       SET claimed = TRUE
     WHERE tomb.path = ANY(v_due)
       AND tomb.path NOT IN (SELECT path FROM referenced)
     RETURNING tomb.path
  ),
  resurrected AS (
    DELETE FROM public.blog_media_delete_tombstones AS tomb
     WHERE tomb.path = ANY(v_due)
       AND tomb.path IN (SELECT path FROM referenced)
  )
  SELECT due.path, due.path NOT IN (SELECT path FROM referenced)
    FROM pg_catalog.unnest(v_due) AS due(path);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_sweepable_blog_media_tombstones(
  TIMESTAMPTZ,
  INTEGER
)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sweepable_blog_media_tombstones(
  TIMESTAMPTZ,
  INTEGER
)
TO service_role;

-- Presence probe for save-path verification. The storage schema sits
-- outside PostgREST, so saves cannot SELECT storage.objects directly;
-- this probe reports which media objects still exist after a save
-- clears its tombstones. Media objects are publicly readable, so
-- granting authenticated callers a presence probe widens nothing.
CREATE OR REPLACE FUNCTION public.blog_media_objects_present_v1(
  p_paths TEXT[]
)
RETURNS TABLE (path TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT object.name AS path
    FROM storage.objects AS object
   WHERE object.bucket_id = 'media'
     AND object.name = ANY(p_paths);
$function$;

REVOKE ALL ON FUNCTION public.blog_media_objects_present_v1(TEXT[])
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.blog_media_objects_present_v1(TEXT[])
TO authenticated, service_role;
