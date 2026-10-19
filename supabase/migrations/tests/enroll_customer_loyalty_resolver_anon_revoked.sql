-- Resolver privilege shape for issue #3696: the loyalty checkout
-- resolver must not be callable by anon or authenticated
-- (enumeration oracle; self-registration is open), while
-- service_role retains EXECUTE for the server routes.
DO $$
BEGIN
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.get_loyalty_redemption_for_checkout(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute get_loyalty_redemption_for_checkout(uuid, text)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_loyalty_redemption_for_checkout(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not execute get_loyalty_redemption_for_checkout(uuid, text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.get_loyalty_redemption_for_checkout(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute get_loyalty_redemption_for_checkout(uuid, text)';
  END IF;
END;
$$;
