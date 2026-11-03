-- =====================================================================
-- REGRESSION TEST: finalize_store_credit_order_payment privileges
--
-- (1) Effective EXECUTE: anon and PUBLIC cannot call the RPC,
--     authenticated (the orders route runs on the customer session) and
--     service_role can, and it is SECURITY DEFINER with a pinned
--     search_path. Denied EXECUTE is asserted via the catalog: on the
--     pinned replay image a denied function EXECUTE cannot be trapped.
-- (2) The verification is only as good as the ledgers it reads, so the
--     buyer must not be able to forge them: direct writes to the savings
--     redemption ledger and the wallet transaction ledger are refused, and
--     the RPC still refuses the order afterwards.
--
-- Fixtures: finalize_store_credit_order_payment_fixtures.inc.sql (\ir).
-- Siblings: ..._refusals.sql, ..._legitimate.sql.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_store_credit_order_payment_privileges.sql
-- =====================================================================

BEGIN;

\ir finalize_store_credit_order_payment_fixtures.inc.sql

RESET ROLE;

-- --- Grants: effective privileges (anon, PUBLIC, authenticated, service_role)
DO $grants$
DECLARE
  v_fn regprocedure :=
    'public.finalize_store_credit_order_payment(uuid, numeric, text)'::regprocedure;
BEGIN
  IF pg_catalog.has_function_privilege('anon', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must NOT have EXECUTE on finalize_store_credit_order_payment';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) a
    WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must NOT have EXECUTE on finalize_store_credit_order_payment';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on finalize_store_credit_order_payment';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must have EXECUTE on finalize_store_credit_order_payment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn::oid AND p.prosecdef
      AND EXISTS (
        SELECT 1 FROM pg_catalog.unnest(p.proconfig) c
        WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'finalize_store_credit_order_payment must be SECURITY DEFINER with a pinned search_path';
  END IF;
END;
$grants$;


-- --- Ledger forgery: the buyer (user 1) cannot write the ledgers directly
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"5c0d0000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $forgery$
DECLARE
  v_state text;
BEGIN
  v_state := NULL;
  BEGIN
    INSERT INTO public.customer_savings_redemptions (
      goal_id, merchant_id, customer_id, order_id, amount, idempotency_key
    ) VALUES (
      '5c0d0500-0000-4000-8000-000000000008',
      '5c0d0100-0000-4000-8000-000000000001',
      '5c0d0200-0000-4000-8000-000000000001',
      '5c0d1100-0000-4000-8000-000000000003', 500, 'scop-forged'
    );
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'F1: forged savings redemption: expected 42501, got %',
      COALESCE(v_state, 'success');
  END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.customer_wallet_transactions (
      wallet_id, customer_id, merchant_id, type, amount, balance_after,
      source_type, source_id, status
    ) VALUES (
      '5c0d0300-0000-4000-8000-000000000001',
      '5c0d0200-0000-4000-8000-000000000001',
      '5c0d0100-0000-4000-8000-000000000001', 'redemption', 500, 0,
      'order_redemption', '5c0d1100-0000-4000-8000-000000000003',
      'completed'
    );
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'F2: forged wallet redemption: expected 42501, got %',
      COALESCE(v_state, 'success');
  END IF;

  -- With the forgeries refused, the order is still unbacked.
  v_state := NULL;
  BEGIN
    PERFORM public.finalize_store_credit_order_payment(
      '5c0d1100-0000-4000-8000-000000000003', 500, 'savings');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM 'store_credit_insufficient' THEN
    RAISE EXCEPTION 'F3: unbacked order after forgery attempts: expected store_credit_insufficient, got %',
      COALESCE(v_state, 'success (order finalized)');
  END IF;
END;
$forgery$;

RESET ROLE;

ROLLBACK;
