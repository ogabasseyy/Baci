-- Public intake must never use an RLS-bypassing service-role JWT.
-- This supersedes the service-role-only grant in
-- 20261002190000_storefront_product_requests.sql: only the least-privilege
-- storefront_intake role may execute the submit RPC.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'storefront_intake') THEN
    CREATE ROLE storefront_intake NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE storefront_intake NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT storefront_intake TO authenticator;
GRANT USAGE ON SCHEMA public TO storefront_intake;
REVOKE ALL ON public.storefront_product_requests FROM storefront_intake;
REVOKE ALL ON FUNCTION public.submit_storefront_product_request(text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_storefront_product_request(text, text, text, uuid) TO storefront_intake;
-- The SECURITY DEFINER function enforces publication, validation,
-- idempotency and merchant/contact budgets; callers cannot read requests.
NOTIFY pgrst, 'reload schema';
