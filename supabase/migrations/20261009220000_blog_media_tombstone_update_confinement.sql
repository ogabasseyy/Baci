-- Confine heartbeat UPDATEs to the lease column. The content.manage
-- UPDATE policy lets any authenticated content manager rewrite any
-- tombstone column through PostgREST: backdating another editor's
-- fresh upload so the next cron deletes it before the grace period,
-- or clearing a worker claim between claim and Storage removal. The
-- table grant now covers created_at only (the heartbeat's sole
-- write), and a trigger keeps lease moves monotonic for
-- authenticated callers — SECURITY DEFINER worker functions run as
-- their owner and skip it. A five-minute tolerance absorbs app/DB
-- clock skew; the attack needs an hour-plus backdate to matter.
REVOKE UPDATE ON public.blog_media_delete_tombstones FROM authenticated;
GRANT UPDATE (created_at) ON public.blog_media_delete_tombstones
  TO authenticated;

CREATE OR REPLACE FUNCTION
  public.blog_media_tombstone_lease_monotonic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF current_user = 'authenticated'
    AND NEW.created_at < OLD.created_at - pg_catalog.make_interval(mins => 5)
  THEN
    RAISE EXCEPTION 'blog_media_lease_backdate_blocked'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.blog_media_tombstone_lease_monotonic()
  OWNER TO postgres;

DROP TRIGGER IF EXISTS blog_media_tombstone_lease_monotonic_trigger
  ON public.blog_media_delete_tombstones;
CREATE TRIGGER blog_media_tombstone_lease_monotonic_trigger
  BEFORE UPDATE ON public.blog_media_delete_tombstones
  FOR EACH ROW
  EXECUTE FUNCTION public.blog_media_tombstone_lease_monotonic();
