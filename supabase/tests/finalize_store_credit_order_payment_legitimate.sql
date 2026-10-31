-- =====================================================================
-- REGRESSION TEST: finalize_store_credit_order_payment legitimate paths
--
-- The checkout flow that must keep working after the ledger verification:
-- savings-only ('savings'), savings + wallet ('store_credit'), the route's
-- float-sum p_amount, a service_role finalize, idempotent replay, and what
-- is recorded (amount_paid = the verified amount, wallet_amount_used = the
-- wallet leg, one completed transaction per order).
--
-- Fixtures: finalize_store_credit_order_payment_fixtures.inc.sql (\ir).
-- Siblings: ..._refusals.sql, ..._privileges.sql.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_store_credit_order_payment_legitimate.sql
-- =====================================================================

BEGIN;

\ir finalize_store_credit_order_payment_fixtures.inc.sql

-- --- L: the legitimate checkout flow still works -------------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"5c0d0000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $legit$
BEGIN
  IF public.finalize_store_credit_order_payment(
    '5c0d1100-0000-4000-8000-000000000001', 500, 'savings')
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L1: savings-only redemption was not finalized';
  END IF;
  -- The route sends savings + wallet as one float sum with 'store_credit'.
  IF public.finalize_store_credit_order_payment(
    '5c0d1100-0000-4000-8000-000000000002', 500, 'store_credit')
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L2: savings + wallet redemption was not finalized';
  END IF;
  -- Idempotent: a replay returns true without a second transaction.
  IF public.finalize_store_credit_order_payment(
    '5c0d1100-0000-4000-8000-000000000001', 500, 'savings')
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L3: replay was not idempotent';
  END IF;
  -- The route's float sum (savings + wallet) can carry sub-kobo noise; it
  -- is compared at kobo precision and the verified amount is what is
  -- recorded.
  IF public.finalize_store_credit_order_payment(
    '5c0d1100-0000-4000-8000-000000000027', 500.00000000000006, 'store_credit')
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L4: float-noise amount was not finalized';
  END IF;
END;
$legit$;

-- A finalized order cannot be re-finalized under a different method.
DO $after$
DECLARE
  v_err text;
BEGIN
  BEGIN
    PERFORM public.finalize_store_credit_order_payment(
      '5c0d1100-0000-4000-8000-000000000001', 500, 'store_credit');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'order_not_payable' THEN
    RAISE EXCEPTION 'L5: re-finalizing a paid order under another method: expected order_not_payable, got %',
      COALESCE(v_err, 'success');
  END IF;
END;
$after$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $legit_service$
BEGIN
  IF public.finalize_store_credit_order_payment(
    '5c0d1100-0000-4000-8000-000000000026', 500, 'savings')
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L6: service_role could not finalize a backed order';
  END IF;
END;
$legit_service$;

RESET ROLE;

DO $legit_state$
DECLARE
  v_order record;
  v_txn record;
  r record;
BEGIN
  -- Merchant cancellation refuses a paid order whose amount_paid differs
  -- from its total, so every store-credit-paid order must record what was
  -- paid; wallet_amount_used carries the wallet part when there is one.
  FOR r IN
    SELECT * FROM (VALUES
      ('01', 'savings', 0), ('02', 'store_credit', 200),
      ('26', 'savings', 0), ('27', 'store_credit', 200)
    ) AS t(n, method, wallet)
  LOOP
    SELECT payment_status, payment_method, amount_paid, wallet_amount_used
    INTO v_order
    FROM public.orders
    WHERE id = ('5c0d1100-0000-4000-8000-0000000000' || r.n)::uuid;
    IF v_order.payment_status IS DISTINCT FROM 'paid'
      OR v_order.payment_method IS DISTINCT FROM r.method
      OR v_order.amount_paid IS DISTINCT FROM 500
      OR COALESCE(v_order.wallet_amount_used, 0) IS DISTINCT FROM r.wallet::numeric
    THEN
      RAISE EXCEPTION 'L (order %): order not recorded correctly: %', r.n,
        row_to_json(v_order);
    END IF;

    SELECT * INTO v_txn FROM public.transactions
    WHERE order_id = ('5c0d1100-0000-4000-8000-0000000000' || r.n)::uuid
      AND gateway = r.method;
    IF v_txn.amount IS DISTINCT FROM 500
      OR v_txn.status IS DISTINCT FROM 'completed'
      OR v_txn.transaction_type IS DISTINCT FROM 'payment'
      OR v_txn.currency IS DISTINCT FROM 'NGN'
      OR v_txn.merchant_id IS DISTINCT FROM '5c0d0100-0000-4000-8000-000000000001'
      OR (v_txn.metadata->>'store_credit_used')::numeric IS DISTINCT FROM 500
    THEN
      RAISE EXCEPTION 'L (order %): store-credit transaction wrong: %', r.n,
        row_to_json(v_txn);
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.transactions
      WHERE order_id = '5c0d1100-0000-4000-8000-000000000001'
        AND gateway = 'savings') <> 1 THEN
    RAISE EXCEPTION 'L3: replay created a second store-credit transaction';
  END IF;

  IF (SELECT count(*) FROM public.transactions
      WHERE gateway IN ('savings', 'store_credit')
        AND merchant_id IN (
          '5c0d0100-0000-4000-8000-000000000001',
          '5c0d0100-0000-4000-8000-000000000002')) <> 4 THEN
    RAISE EXCEPTION 'L: expected exactly the four legitimate store-credit transactions';
  END IF;

  IF (SELECT count(*) FROM public.orders
      WHERE merchant_id IN (
          '5c0d0100-0000-4000-8000-000000000001',
          '5c0d0100-0000-4000-8000-000000000002')
        AND payment_method IN ('savings', 'store_credit')) <> 4 THEN
    RAISE EXCEPTION 'L: expected exactly the four legitimately paid orders';
  END IF;
END;
$legit_state$;

ROLLBACK;
