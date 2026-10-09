-- Guard direct row writes against the claim-to-delete race. The
-- mutation RPCs register media in-transaction, but an authenticated
-- writer can also reach blog_posts directly through PostgREST: a
-- write that commits after the claim snapshot but before byte
-- removal re-references a doomed path the Storage delete policy
-- (claimed platform rows only) still admits, and the sweep then
-- deletes a live image. This trigger intersects every written row
-- against claimed platform tombstones and aborts the write with the
-- same swept-media failure the RPCs raise, so direct writes can
-- neither resurrect the doomed nor pass silently. Only claimed
-- platform paths can race the sweep, and the claimed set holds
-- in-flight batches only, so the intersect stays cheap; the partial
-- index keeps even the empty case to an index scan.
CREATE INDEX IF NOT EXISTS blog_media_delete_tombstones_claimed_path_idx
  ON public.blog_media_delete_tombstones (path)
  WHERE claimed IS TRUE;

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

DROP TRIGGER IF EXISTS blog_media_guard_direct_row_references_trigger
  ON public.blog_posts;
CREATE TRIGGER blog_media_guard_direct_row_references_trigger
  BEFORE INSERT OR UPDATE ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.blog_media_guard_direct_row_references();
