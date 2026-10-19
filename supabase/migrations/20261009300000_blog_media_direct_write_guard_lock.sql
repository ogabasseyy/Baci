-- Serialize the direct-write guard against the claim. Checking the
-- claimed flag without locking leaves a hole: an unclaimed row at
-- the trigger's snapshot can commit its claim before the guarded
-- write commits, and the sweep then deletes a referenced object.
-- The trigger now locks every platform tombstone the row references
-- (path order, claimed or not) before reading the flag — the same
-- row locks the claim's FOR UPDATE takes. Either the claim waits and
-- then sees this committed row (resurrecting it), or this write
-- waits and then sees the claim (aborting). The sweep keeps its own
-- lock order, so a rare deadlock aborts one side retryably rather
-- than deleting referenced media.
CREATE OR REPLACE FUNCTION public.blog_media_guard_direct_row_references()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hit TEXT;
  v_content TEXT := public.blog_media_percent_decode(NEW.content);
  v_excerpt TEXT := public.blog_media_percent_decode(NEW.excerpt);
  v_featured TEXT :=
    public.blog_media_percent_decode(NEW.featured_image_url);
  v_author TEXT :=
    public.blog_media_percent_decode(NEW.author_image_url);
  v_variants TEXT :=
    public.blog_media_percent_decode(NEW.featured_image_variants::text);
BEGIN
  PERFORM 1
    FROM public.blog_media_delete_tombstones AS tomb
   WHERE tomb.path LIKE 'platform/blog/%'
     AND (
       pg_catalog.strpos(v_content, tomb.path) > 0
       OR pg_catalog.strpos(v_excerpt, tomb.path) > 0
       OR pg_catalog.strpos(v_featured, tomb.path) > 0
       OR pg_catalog.strpos(v_author, tomb.path) > 0
       OR pg_catalog.strpos(v_variants, tomb.path) > 0
     )
   ORDER BY tomb.path
   FOR UPDATE;
  SELECT tomb.path INTO v_hit
    FROM public.blog_media_delete_tombstones AS tomb
   WHERE tomb.claimed IS TRUE
     AND tomb.path LIKE 'platform/blog/%'
     AND (
       pg_catalog.strpos(v_content, tomb.path) > 0
       OR pg_catalog.strpos(v_excerpt, tomb.path) > 0
       OR pg_catalog.strpos(v_featured, tomb.path) > 0
       OR pg_catalog.strpos(v_author, tomb.path) > 0
       OR pg_catalog.strpos(v_variants, tomb.path) > 0
     )
   LIMIT 1;
  IF v_hit IS NOT NULL THEN
    IF NEW.is_platform_post IS TRUE AND NEW.merchant_id IS NULL THEN
      RAISE EXCEPTION 'platform_blog_media_swept_during_save: %', v_hit
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'merchant_blog_media_swept_during_save: %', v_hit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.blog_media_guard_direct_row_references()
  OWNER TO postgres;
