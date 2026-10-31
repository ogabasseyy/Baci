-- =====================================================================
-- REGRESSION TEST: finalize_store_credit_order_payment refusals
--
-- A signed-in customer must not be able to mark their own unpaid order
-- paid with a caller-chosen amount. The RPC verifies the ledger itself:
-- the net savings redemption for the order (reversed rows do not count)
-- plus the net wallet order_redemption (net of order_reversal rows), for
-- this customer and merchant, must equal the order total and the amount
-- the caller states, and the method must match the ledger. This suite
-- asserts every refusal and that a refused call leaves no trace.
--
-- Fixtures: finalize_store_credit_order_payment_fixtures.inc.sql (\ir).
-- Siblings: ..._legitimate.sql, ..._privileges.sql.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_store_credit_order_payment_refusals.sql
-- =====================================================================

BEGIN;

\ir finalize_store_credit_order_payment_fixtures.inc.sql

-- --- R: every refusal, called as the buyer (user 1) ----------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"5c0d0000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $refusals$
DECLARE
  r record;
  v_err text;
  v_state text;
BEGIN
  FOR r IN
    SELECT
      t.label,
      CASE WHEN t.n = 'none' THEN NULL
           WHEN t.n = 'missing' THEN '5c0d1100-0000-4000-8000-0000000000ff'::uuid
           ELSE ('5c0d1100-0000-4000-8000-0000000000' || t.n)::uuid END AS order_id,
      t.amount, t.method, t.expected, t.state
    FROM (VALUES
      ('nothing redeemed, savings', '03', 500::numeric, 'savings', 'store_credit_insufficient', 'P0001'),
      ('nothing redeemed, store_credit', '03', 500, 'store_credit', 'store_credit_insufficient', 'P0001'),
      ('1 naira claim on a 500 order, nothing redeemed', '03', 1, 'savings', 'store_credit_insufficient', 'P0001'),
      ('partial savings, claims the redeemed part', '04', 300, 'savings', 'store_credit_insufficient', 'P0001'),
      ('partial savings, claims the total', '04', 500, 'savings', 'store_credit_insufficient', 'P0001'),
      ('wallet only, savings method', '05', 500, 'savings', 'store_credit_insufficient', 'P0001'),
      ('wallet only, store_credit method', '05', 500, 'store_credit', 'store_credit_insufficient', 'P0001'),
      ('savings + wallet short, claims the redeemed sum', '06', 400, 'store_credit', 'store_credit_insufficient', 'P0001'),
      ('savings + wallet short, claims the total', '06', 500, 'store_credit', 'store_credit_insufficient', 'P0001'),
      ('over-redeemed, claims the total', '07', 500, 'store_credit', 'store_credit_amount_mismatch', 'P0001'),
      ('over-redeemed, claims the redeemed sum', '07', 700, 'store_credit', 'store_credit_amount_mismatch', 'P0001'),
      ('amount far below the total', '08', 1, 'savings', 'store_credit_amount_mismatch', 'P0001'),
      ('amount one kobo below', '08', 499.99, 'savings', 'store_credit_amount_mismatch', 'P0001'),
      ('amount one kobo above', '08', 500.01, 'savings', 'store_credit_amount_mismatch', 'P0001'),
      ('amount far above', '08', 501, 'savings', 'store_credit_amount_mismatch', 'P0001'),
      ('NaN amount', '08', 'NaN', 'savings', 'store_credit_amount_mismatch', 'P0001'),
      ('Infinity amount', '08', 'Infinity', 'savings', 'store_credit_amount_mismatch', 'P0001'),
      ('store_credit on a savings-only ledger', '08', 500, 'store_credit', 'store_credit_method_mismatch', 'P0001'),
      ('savings on a savings + wallet ledger', '02', 500, 'savings', 'store_credit_method_mismatch', 'P0001'),
      ('payment method wallet', '08', 500, 'wallet', 'invalid_store_credit_payment_method', '22023'),
      ('payment method card', '08', 500, 'card', 'invalid_store_credit_payment_method', '22023'),
      ('payment method wrong case', '08', 500, 'Savings', 'invalid_store_credit_payment_method', '22023'),
      ('null payment method', '08', 500, NULL, 'invalid_store_credit_payment_method', '22023'),
      ('cancelled shipping_status', '09', 500, 'savings', 'order_not_payable', 'P0001'),
      ('cancelled_at set only', '10', 500, 'savings', 'order_not_payable', 'P0001'),
      ('canceled spelling', '11', 500, 'savings', 'order_not_payable', 'P0001'),
      ('reversed savings', '12', 500, 'savings', 'store_credit_insufficient', 'P0001'),
      ('reversed wallet leg', '13', 500, 'store_credit', 'store_credit_insufficient', 'P0001'),
      ('reversed wallet leg, claims the savings part', '13', 300, 'savings', 'store_credit_insufficient', 'P0001'),
      ('another customer order', '14', 500, 'savings', 'unauthorized', '42501'),
      ('wallet leg under another merchant customer', '15', 500, 'store_credit', 'store_credit_insufficient', 'P0001'),
      ('customer row belongs to another merchant', '16', 500, 'savings', 'unauthorized', '42501'),
      ('non-NGN order', '17', 500, 'savings', 'order_not_payable', 'P0001'),
      ('paid by another method', '18', 500, 'savings', 'order_not_payable', 'P0001'),
      ('abandoned payment_status cancelled', '19', 500, 'savings', 'order_not_payable', 'P0001'),
      ('refunded', '20', 500, 'savings', 'order_not_payable', 'P0001'),
      ('failed', '21', 500, 'savings', 'order_not_payable', 'P0001'),
      ('pending (gateway payment in flight)', '22', 500, 'savings', 'order_not_payable', 'P0001'),
      ('partially_paid', '23', 500, 'savings', 'order_not_payable', 'P0001'),
      ('bnpl_pending', '24', 500, 'savings', 'order_not_payable', 'P0001'),
      ('wallet leg never completed', '25', 500, 'store_credit', 'store_credit_insufficient', 'P0001'),
      ('unknown order', 'missing', 500, 'savings', 'order_not_found', 'P0001'),
      ('null order', 'none', 500, 'savings', 'order_id_required', '22023'),
      ('zero amount', '01', 0, 'savings', 'amount_invalid', '22023'),
      ('negative amount', '01', -5, 'savings', 'amount_invalid', '22023'),
      ('null amount', '01', NULL, 'savings', 'amount_invalid', '22023')
    ) AS t(label, n, amount, method, expected, state)
  LOOP
    v_err := NULL;
    v_state := NULL;
    BEGIN
      PERFORM public.finalize_store_credit_order_payment(
        r.order_id, r.amount, r.method);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_state := SQLSTATE;
    END;
    IF v_err IS DISTINCT FROM r.expected OR v_state IS DISTINCT FROM r.state THEN
      RAISE EXCEPTION 'R (%): expected % (%), got %', r.label, r.expected,
        r.state, COALESCE(v_err || ' (' || v_state || ')',
                          'success (order finalized)');
    END IF;
  END LOOP;

  -- A session with no subject must be refused before any ledger read.
  PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
  v_err := NULL;
  BEGIN
    PERFORM public.finalize_store_credit_order_payment(
      '5c0d1100-0000-4000-8000-000000000001', 500, 'savings');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'unauthorized' THEN
    RAISE EXCEPTION 'R (no subject): expected unauthorized, got %',
      COALESCE(v_err, 'success (order finalized)');
  END IF;
END;
$refusals$;

-- The service_role bypass skips the ownership check only: it is refused
-- exactly like a customer when the ledger does not back the payment.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $service_refusals$
DECLARE
  r record;
  v_err text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('service_role, nothing redeemed', '03', 500::numeric, 'savings', 'store_credit_insufficient'),
      ('service_role, partial savings', '04', 500, 'savings', 'store_credit_insufficient'),
      ('service_role, wrong amount', '08', 1, 'savings', 'store_credit_amount_mismatch'),
      ('service_role, cancelled order', '09', 500, 'savings', 'order_not_payable')
    ) AS t(label, n, amount, method, expected)
  LOOP
    v_err := NULL;
    BEGIN
      PERFORM public.finalize_store_credit_order_payment(
        ('5c0d1100-0000-4000-8000-0000000000' || r.n)::uuid,
        r.amount, r.method);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    IF v_err IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'R (%): expected %, got %', r.label, r.expected,
        COALESCE(v_err, 'success (order finalized)');
    END IF;
  END LOOP;
END;
$service_refusals$;

-- Refusals must leave no trace: no store-credit transaction, no order
-- stamped as paid by savings / store credit, nothing recorded as paid.
RESET ROLE;

DO $untouched$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE gateway IN ('savings', 'store_credit')
      AND merchant_id IN (
        '5c0d0100-0000-4000-8000-000000000001',
        '5c0d0100-0000-4000-8000-000000000002')
  ) THEN
    RAISE EXCEPTION 'R: a refused call recorded a store-credit transaction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE merchant_id IN (
        '5c0d0100-0000-4000-8000-000000000001',
        '5c0d0100-0000-4000-8000-000000000002')
      AND (payment_method IN ('savings', 'store_credit')
        OR COALESCE(amount_paid, 0) <> 0)
  ) THEN
    RAISE EXCEPTION 'R: a refused call stamped an order as paid by store credit';
  END IF;
END;
$untouched$;

ROLLBACK;
