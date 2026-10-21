-- Run after the restricted intake migration. No request/contact data is read.
BEGIN;
DO $$
DECLARE caller text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'storefront_intake'
    AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Intake role must not inherit, login or bypass RLS';
  END IF;
  IF NOT pg_catalog.pg_has_role('authenticator', 'storefront_intake', 'MEMBER') THEN
    RAISE EXCEPTION 'PostgREST cannot select the intake role';
  END IF;
  IF NOT pg_catalog.has_function_privilege('storefront_intake',
    'public.submit_storefront_product_request(text,text,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Restricted role cannot submit requests';
  END IF;
  FOREACH caller IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(caller,
      'public.submit_storefront_product_request(text,text,text,uuid,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'Unrestricted caller can submit requests: %', caller;
    END IF;
  END LOOP;
  -- Expand-contract rollout shim (#3750): the deprecated 4-arg overload
  -- stays live for still-running old route instances until the new
  -- revision serves 100% of traffic. It keeps the same least-privilege
  -- shape: executable by storefront_intake only. #3750 drops it and
  -- flips these assertions to absence.
  IF NOT pg_catalog.has_function_privilege('storefront_intake',
    'public.submit_storefront_product_request(text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollout shim lost: restricted role cannot call 4-arg intake';
  END IF;
  FOREACH caller IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(caller,
      'public.submit_storefront_product_request(text,text,text,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'Unrestricted caller can submit requests via 4-arg shim: %', caller;
    END IF;
  END LOOP;
  -- The network-budget ledger is deny-by-default: RLS on, no direct
  -- access for any caller; only the SECURITY DEFINER owner path touches it.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'storefront_search_private'
      AND tablename = 'intake_net_windows' AND NOT rowsecurity) THEN
    RAISE EXCEPTION 'Network budget ledger must have RLS enabled';
  END IF;
  FOREACH caller IN ARRAY ARRAY['storefront_intake', 'anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(caller,
      'storefront_search_private.intake_net_windows', 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Direct ledger access granted to %', caller;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('storefront_intake',
    'public.storefront_product_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Intake role can access request rows directly';
  END IF;
END $$;
ROLLBACK;
