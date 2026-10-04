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
    'public.submit_storefront_product_request(text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Restricted role cannot submit requests';
  END IF;
  FOREACH caller IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(caller,
      'public.submit_storefront_product_request(text,text,text,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'Unrestricted caller can submit requests: %', caller;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('storefront_intake',
    'public.storefront_product_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Intake role can access request rows directly';
  END IF;
END $$;
ROLLBACK;
