-- Floor lease refreshes at server time. The monotonic guard alone
-- compares only with the immediately preceding value, so repeated
-- five-minute-step direct PostgREST updates can walk a fresh upload
-- past the one-hour cutoff (~twelve accepted steps) and let the next
-- cron delete another editor's unsaved media. The legitimate
-- heartbeat always writes server now through the refresh route, so a
-- ten-minute server-time floor bounds the total damage of any walk
-- to ten minutes of aging — far short of the cutoff — without
-- touching legitimate refreshes.
CREATE OR REPLACE FUNCTION
  public.blog_media_tombstone_lease_monotonic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF current_user = 'authenticated'
    AND (
      NEW.created_at < OLD.created_at - pg_catalog.make_interval(mins => 5)
      OR NEW.created_at < pg_catalog.now() - pg_catalog.make_interval(mins => 10)
    )
  THEN
    RAISE EXCEPTION 'blog_media_lease_backdate_blocked'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.blog_media_tombstone_lease_monotonic()
  OWNER TO postgres;
