BEGIN;

DO $$
BEGIN
  -- Column: boolean, NOT NULL, default ON so existing merchants keep alerts.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'chat_message_push_enabled'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
      AND column_default = 'true'
  ) THEN
    RAISE EXCEPTION 'chat_message_push_enabled must be boolean NOT NULL DEFAULT true';
  END IF;

  -- The owner-only table policy stays on (RLS enabled).
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = 'public.notification_preferences'::regclass) THEN
    RAISE EXCEPTION 'notification_preferences must keep row level security';
  END IF;

  -- Read: one boolean, callable without a merchant session, not by PUBLIC.
  IF NOT pg_catalog.has_function_privilege(
       'anon', 'public.get_chat_message_push_preference(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.get_chat_message_push_preference(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_chat_message_push_preference must be executable by anon and authenticated';
  END IF;

  -- Write: signed-in or service role only; anon must never write.
  IF pg_catalog.has_function_privilege(
       'anon', 'public.set_chat_message_push_preference(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute set_chat_message_push_preference';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.set_chat_message_push_preference(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute set_chat_message_push_preference';
  END IF;

  -- Both are SECURITY DEFINER with a pinned search_path.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN (
      'public.get_chat_message_push_preference(uuid)'::regprocedure,
      'public.set_chat_message_push_preference(uuid,boolean)'::regprocedure
    )
    AND (NOT p.prosecdef OR p.proconfig IS NULL
         OR NOT ('search_path=""' = ANY (p.proconfig)))
  ) THEN
    RAISE EXCEPTION 'chat push preference functions must be SECURITY DEFINER with search_path pinned';
  END IF;
END;
$$;

ROLLBACK;
