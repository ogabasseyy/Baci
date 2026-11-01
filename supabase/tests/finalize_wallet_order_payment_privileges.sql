-- =====================================================================
-- REGRESSION TEST: finalize_wallet_order_payment privileges
--
-- Effective EXECUTE: anon and PUBLIC must not have it; authenticated (the
-- orders route runs with the customer's session) and service_role must.
-- Denied EXECUTE is asserted via the catalog: on the pinned replay image a
-- denied function EXECUTE cannot be trapped by an exception handler.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_wallet_order_payment_privileges.sql
-- =====================================================================

BEGIN;

-- --- Grants: effective privileges (anon, PUBLIC, authenticated, service_role)
DO $grants$
DECLARE
  v_fn regprocedure :=
    'public.finalize_wallet_order_payment(uuid, numeric)'::regprocedure;
BEGIN
  IF pg_catalog.has_function_privilege('anon', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must NOT have EXECUTE on finalize_wallet_order_payment';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) a
    WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must NOT have EXECUTE on finalize_wallet_order_payment';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on finalize_wallet_order_payment';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must have EXECUTE on finalize_wallet_order_payment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn::oid AND p.prosecdef
      AND EXISTS (
        SELECT 1 FROM pg_catalog.unnest(p.proconfig) c
        WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'finalize_wallet_order_payment must be SECURITY DEFINER with a pinned search_path';
  END IF;
END;
$grants$;

ROLLBACK;
