-- Atomic tombstone sweep claim. The sweep used to read due tombstones,
-- scan references, and remove objects in separate statements, so a post
-- save committing between the final read and the removal lost the race
-- and its media was deleted. The claim below locks the due rows,
-- re-scans persisted references under the same snapshot, and drops
-- servable metadata for unreferenced paths in one transaction: a
-- concurrent save clearing these rows blocks on the row locks until the
-- claim commits, then its post-insert verification sees the final
-- metadata state and rolls back loudly instead of persisting broken
-- media.
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
  WITH unreferenced AS (
    SELECT candidate AS path
      FROM pg_catalog.unnest(v_due) AS candidate
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.blog_posts AS post
        WHERE post.is_platform_post IS TRUE
          AND post.merchant_id IS NULL
          AND (
            pg_catalog.strpos(post.content, candidate) > 0
            OR pg_catalog.strpos(post.excerpt, candidate) > 0
            OR pg_catalog.strpos(post.featured_image_url, candidate) > 0
            OR pg_catalog.strpos(post.author_image_url, candidate) > 0
            OR pg_catalog.strpos(
              post.featured_image_variants::text,
              candidate
            ) > 0
          )
      )
  ),
  claimed AS (
    DELETE FROM public.blog_media_delete_tombstones AS tomb
     WHERE tomb.path IN (SELECT path FROM unreferenced)
     RETURNING tomb.path
  ),
  metadata_dropped AS (
    DELETE FROM storage.objects AS object
     WHERE object.bucket_id = 'media'
       AND object.name IN (SELECT path FROM claimed)
  ),
  resurrected AS (
    DELETE FROM public.blog_media_delete_tombstones AS tomb
     WHERE tomb.path = ANY(v_due)
       AND tomb.path NOT IN (SELECT path FROM claimed)
  )
  SELECT due.path, due.path IN (SELECT path FROM claimed)
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
