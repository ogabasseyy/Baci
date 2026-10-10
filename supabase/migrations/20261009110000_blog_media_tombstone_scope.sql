-- Constrain blog media tombstones to platform blog paths with
-- server-owned state. A content.manage caller can reach this table
-- through PostgREST, and the staging policy used to validate only the
-- permission: such a caller could insert an already-due tombstone
-- naming any object in the shared media bucket, and the sweep would
-- pass that path to Storage deletion. The CHECK below bounds every
-- row to the platform prefix, the trigger forces created_at/claimed
-- to server values on insert, and the claim revalidates the prefix
-- so even a pre-existing out-of-scope row can never be swept.
ALTER TABLE public.blog_media_delete_tombstones
  ADD CONSTRAINT blog_media_delete_tombstones_platform_path
  CHECK (path LIKE 'platform/blog/%');

CREATE OR REPLACE FUNCTION public.blog_media_tombstones_force_insert_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Re-staging keeps the row only when it already exists (the write
  -- path upserts with ignoreDuplicates); a fresh insert always starts
  -- its own grace window unclaimed. Service-role inserts keep their
  -- explicit values: that role bypasses RLS anyway and could UPDATE
  -- the row right after, so forcing it would only break fixtures.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.created_at := now();
    NEW.claimed := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS blog_media_delete_tombstones_force_insert_state
  ON public.blog_media_delete_tombstones;
CREATE TRIGGER blog_media_delete_tombstones_force_insert_state
  BEFORE INSERT ON public.blog_media_delete_tombstones
  FOR EACH ROW
  EXECUTE FUNCTION public.blog_media_tombstones_force_insert_state();

DROP POLICY IF EXISTS "Platform admins manage blog media delete tombstones"
ON public.blog_media_delete_tombstones;
CREATE POLICY "Platform admins manage blog media delete tombstones"
ON public.blog_media_delete_tombstones
FOR ALL
TO authenticated
USING (
  path LIKE 'platform/blog/%'
  AND EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE merchants.user_id = auth.uid()
      AND merchants.is_platform_admin IS TRUE
  )
)
WITH CHECK (
  path LIKE 'platform/blog/%'
  AND EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE merchants.user_id = auth.uid()
      AND merchants.is_platform_admin IS TRUE
  )
);

DROP POLICY IF EXISTS
  blog_media_delete_tombstones_content_manage_insert_v1
ON public.blog_media_delete_tombstones;
CREATE POLICY blog_media_delete_tombstones_content_manage_insert_v1
ON public.blog_media_delete_tombstones
FOR INSERT TO authenticated
WITH CHECK (
  path LIKE 'platform/blog/%'
  AND public.current_user_has_platform_admin_permission_v1('content.manage')
);

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
         AND tomb.path LIKE 'platform/blog/%'
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
