-- Confine direct DELETEs to unclaimed rows. The content.manage
-- DELETE policy (together with the legacy platform-admin FOR ALL
-- policy) lets any authenticated content manager delete any
-- tombstone through PostgREST: removing a claimed row between the
-- sweep claim and Storage removal unauthorizes the byte deletion
-- while destroying the retry record, orphaning the object forever.
-- A BEFORE DELETE trigger blocks claimed-row removal for
-- authenticated callers — SECURITY DEFINER worker functions run as
-- their owner and skip it, as does the service_role escape hatch.
-- The upload release path deletes unclaimed rows only, so it is
-- unaffected.
CREATE OR REPLACE FUNCTION
  public.blog_media_tombstone_claimed_delete_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF pg_catalog.current_user() = 'authenticated'
    AND OLD.claimed IS TRUE
  THEN
    RAISE EXCEPTION 'blog_media_claimed_delete_blocked'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

ALTER FUNCTION public.blog_media_tombstone_claimed_delete_block()
  OWNER TO postgres;

DROP TRIGGER IF EXISTS blog_media_tombstone_claimed_delete_trigger
  ON public.blog_media_delete_tombstones;
CREATE TRIGGER blog_media_tombstone_claimed_delete_trigger
  BEFORE DELETE ON public.blog_media_delete_tombstones
  FOR EACH ROW
  EXECUTE FUNCTION public.blog_media_tombstone_claimed_delete_block();
