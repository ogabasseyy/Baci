-- Bind the sweep worker's Storage deletes to claimed tombstones.
-- The worker policy admitted every media/platform/blog/* object, so
-- the Bearer [REDACTED] used directly against the Storage delete
-- endpoint could remove live platform media the claim never
-- selected. The predicate below admits only paths with a claimed
-- tombstone row; unclaimed staged rows (fresh uploads awaiting save)
-- and unstaged live media stay undeletable through this capability.
-- Claimed rows persist until byte removal succeeds, so retries keep
-- their admission and the release wrapper still drops them after.
CREATE OR REPLACE FUNCTION public.blog_media_sweep_worker_can_delete(
  p_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.blog_media_delete_tombstones AS tomb
     WHERE tomb.path = p_name
       AND tomb.claimed IS TRUE
  );
$function$;

ALTER FUNCTION public.blog_media_sweep_worker_can_delete(TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.blog_media_sweep_worker_can_delete(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.blog_media_sweep_worker_can_delete(TEXT)
  TO blog_media_sweep_worker;

DROP POLICY IF EXISTS "Blog media sweep worker deletes platform media"
  ON storage.objects;
CREATE POLICY "Blog media sweep worker deletes platform media"
  ON storage.objects
  FOR DELETE TO blog_media_sweep_worker
  USING (
    bucket_id = 'media'
    AND name LIKE 'platform/blog/%'
    AND public.blog_media_sweep_worker_can_delete(name)
  );
