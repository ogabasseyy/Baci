-- =====================================================================
-- REGRESSION TEST: finalize_wallet_order_payment legitimate path
--
-- The orders route finalizes a fully wallet-covered checkout with the
-- customer's own session right after redeem_wallet_for_order. That flow must
-- still mark the order paid, record the payment at the verified debit,
-- and stay idempotent on replay.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_wallet_order_payment_finalization.sql
-- =====================================================================

BEGIN;

\ir finalize_wallet_order_payment_fixtures.inc.sql

-- --- L: the legitimate checkout flow still works -------------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"f7a10000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $legit$
BEGIN
  IF public.finalize_wallet_order_payment(
    'f7a11000-0000-4000-8000-000000000001', 500) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L1: full wallet redemption was not finalized';
  END IF;
  -- Same order that was refused for a wrong amount: the right amount works.
  IF public.finalize_wallet_order_payment(
    'f7a11000-0000-4000-8000-000000000004', 500) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L2: matching amount was not finalized';
  END IF;
  -- Idempotent: a replay returns true without a second transaction.
  IF public.finalize_wallet_order_payment(
    'f7a11000-0000-4000-8000-000000000001', 500) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'L3: replay was not idempotent';
  END IF;
END;
$legit$;

RESET ROLE;

DO $legit_state$
DECLARE
  v_order record;
  v_txn record;
BEGIN
  SELECT payment_status, payment_method, amount_paid, wallet_amount_used
  INTO v_order
  FROM public.orders WHERE id = 'f7a11000-0000-4000-8000-000000000001';
  IF v_order.payment_status IS DISTINCT FROM 'paid'
    OR v_order.payment_method IS DISTINCT FROM 'wallet' THEN
    RAISE EXCEPTION 'L1: order not paid by wallet: %', row_to_json(v_order);
  END IF;

  -- Merchant cancellation refuses a paid order whose amount_paid differs
  -- from its total, so a wallet-paid order must record what was paid.
  IF v_order.amount_paid IS DISTINCT FROM 500
    OR v_order.wallet_amount_used IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'L1: wallet payment not recorded on the order: %',
      row_to_json(v_order);
  END IF;

  IF (SELECT count(*) FROM public.transactions
      WHERE order_id = 'f7a11000-0000-4000-8000-000000000001'
        AND gateway = 'wallet') <> 1 THEN
    RAISE EXCEPTION 'L3: replay created a second wallet transaction';
  END IF;

  SELECT * INTO v_txn FROM public.transactions
  WHERE order_id = 'f7a11000-0000-4000-8000-000000000001'
    AND gateway = 'wallet';
  IF v_txn.amount IS DISTINCT FROM 500
    OR v_txn.status IS DISTINCT FROM 'completed'
    OR v_txn.transaction_type IS DISTINCT FROM 'payment'
    OR v_txn.merchant_id IS DISTINCT FROM 'f7a10100-0000-4000-8000-000000000001'
    OR (v_txn.metadata->>'wallet_credit_used')::numeric IS DISTINCT FROM 500
  THEN
    RAISE EXCEPTION 'L1: wallet transaction wrong: %', row_to_json(v_txn);
  END IF;

  IF (SELECT count(*) FROM public.transactions
      WHERE gateway = 'wallet'
        AND merchant_id IN (
          'f7a10100-0000-4000-8000-000000000001',
          'f7a10100-0000-4000-8000-000000000002')) <> 2 THEN
    RAISE EXCEPTION 'L: expected exactly the two legitimate wallet transactions';
  END IF;
END;
$legit_state$;

ROLLBACK;
