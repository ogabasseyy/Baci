-- =============================================
-- REGRESSION TEST (3/3): tracking RPC stays publicly executable.
--
-- Guest success lookups call get_order_tracking as anon; signed-in
-- lookups as authenticated. Both roles must retain EXECUTE after the
-- notification_delivered projection lands.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/tracking_order_notification_privileges.sql
-- =============================================

DO $$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.get_order_tracking(text,uuid,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute get_order_tracking(text,uuid,text,text,text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_order_tracking(text,uuid,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute get_order_tracking(text,uuid,text,text,text)';
  END IF;
END;
$$;
