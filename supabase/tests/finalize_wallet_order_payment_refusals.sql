-- =====================================================================
-- REGRESSION TEST: finalize_wallet_order_payment refusals
--
-- A signed-in customer must not be able to mark their own unpaid order
-- paid unless the wallet was actually debited for that order, for the
-- amount due. Every call below must be refused, with a stable error name,
-- and must leave no wallet transaction or wallet-paid order behind.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_wallet_order_payment_refusals.sql
-- =====================================================================

BEGIN;

\ir finalize_wallet_order_payment_fixtures.inc.sql

-- --- R: every refusal, called as the buyer (user 1) ----------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"f7a10000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $refusals$
DECLARE
  r record;
  v_err text;
BEGIN
  FOR r IN
    SELECT
      t.label,
      CASE WHEN t.n = 'none' THEN NULL
           WHEN t.n = 'missing' THEN 'f7a11000-0000-4000-8000-0000000000ff'::uuid
           ELSE ('f7a11000-0000-4000-8000-0000000000' || t.n)::uuid END AS order_id,
      t.amount, t.expected
    FROM (VALUES
      ('no debit', '02', 500::numeric, 'wallet_debit_insufficient'),
      ('partial debit, claims debited amount', '03', 200, 'wallet_debit_insufficient'),
      ('partial debit, claims the total', '03', 500, 'wallet_debit_insufficient'),
      ('reversed debit', '07', 500, 'wallet_debit_insufficient'),
      ('debit under another merchant customer', '09', 500, 'wallet_debit_insufficient'),
      ('amount far below the debit', '04', 1, 'wallet_amount_mismatch'),
      ('amount just below the debit', '04', 499, 'wallet_amount_mismatch'),
      ('amount above the debit', '04', 501, 'wallet_amount_mismatch'),
      ('debit row not completed', '20', 500, 'wallet_debit_insufficient'),
      ('debit above the total, claims the debit', '19', 600, 'wallet_amount_mismatch'),
      ('debit above the total, claims the total', '19', 500, 'wallet_amount_mismatch'),
      ('cancelled shipping_status', '05', 500, 'order_not_payable'),
      ('cancelled_at set only', '06', 500, 'order_not_payable'),
      ('canceled spelling', '18', 500, 'order_not_payable'),
      ('non-NGN order', '10', 500, 'order_not_payable'),
      ('paid by another method, no wallet txn', '11', 500, 'order_not_payable'),
      ('abandoned payment_status cancelled', '12', 500, 'order_not_payable'),
      ('refunded', '13', 500, 'order_not_payable'),
      ('failed', '14', 500, 'order_not_payable'),
      ('pending', '15', 500, 'order_not_payable'),
      ('partially_paid', '16', 500, 'order_not_payable'),
      ('bnpl_pending', '17', 500, 'order_not_payable'),
      ('another customer order', '08', 500, 'unauthorized'),
      ('customer row belongs to another merchant', '21', 500, 'unauthorized'),
      ('unknown order', 'missing', 500, 'order_not_found'),
      ('null order', 'none', 500, 'order_id_required'),
      ('zero amount', '01', 0, 'amount_invalid'),
      ('negative amount', '01', -5, 'amount_invalid'),
      ('null amount', '01', NULL, 'amount_invalid')
    ) AS t(label, n, amount, expected)
  LOOP
    v_err := NULL;
    BEGIN
      PERFORM public.finalize_wallet_order_payment(r.order_id, r.amount);
    EXCEPTION WHEN raise_exception THEN
      v_err := SQLERRM;
    END;
    IF v_err IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'R (%): expected %, got %', r.label, r.expected,
        COALESCE(v_err, 'success (order finalized)');
    END IF;
  END LOOP;

  -- A session with no subject must be refused before any lookup.
  PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
  v_err := NULL;
  BEGIN
    PERFORM public.finalize_wallet_order_payment(
      'f7a11000-0000-4000-8000-000000000001', 500);
  EXCEPTION WHEN raise_exception THEN
    v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'unauthorized' THEN
    RAISE EXCEPTION 'R (no subject): expected unauthorized, got %',
      COALESCE(v_err, 'success (order finalized)');
  END IF;
END;
$refusals$;

-- Refusals must leave no trace: no wallet transaction, no wallet payment.
RESET ROLE;

DO $untouched$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE gateway = 'wallet'
      AND merchant_id IN (
        'f7a10100-0000-4000-8000-000000000001',
        'f7a10100-0000-4000-8000-000000000002')
  ) THEN
    RAISE EXCEPTION 'R: a refused call recorded a wallet transaction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE merchant_id IN (
        'f7a10100-0000-4000-8000-000000000001',
        'f7a10100-0000-4000-8000-000000000002')
      AND payment_method = 'wallet'
  ) THEN
    RAISE EXCEPTION 'R: a refused call stamped an order as wallet-paid';
  END IF;
END;
$untouched$;

ROLLBACK;
