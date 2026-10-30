-- =====================================================================
-- REGRESSION TEST: finalize_store_credit_order_payment authorization
--
-- A signed-in customer must not be able to mark their own unpaid order
-- paid with a caller-chosen amount. The RPC has to verify the ledger
-- itself: the net savings redemption for the order (reversed rows do not
-- count) plus the net wallet order_redemption (net of order_reversal
-- rows), for this customer and merchant, must equal the order total and
-- the amount the caller states, and the payment method must match the
-- ledger ('savings' when no wallet is involved, 'store_credit' when it is).
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_store_credit_order_payment_authorization.sql
--
-- Savings are redeemed through the real redeem_savings_for_order RPC,
-- wallet debits through redeem_wallet_for_order, and reversals through
-- reverse_savings_redemption_for_order / reverse_wallet_redemption, so the
-- ledger shapes asserted here are the ones production code writes. Denied
-- EXECUTE is asserted via the catalog (see the $grants$ block): on the
-- pinned replay image a denied function EXECUTE cannot be trapped.
-- =====================================================================

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

-- Orders (m1 unless noted; c1 = the buyer's customer row; total 500), by id
-- suffix. Savings / wallet columns are what the checkout redeemed.
--   01 savings 500 (legit)         02 savings 300 + wallet 200 (legit)
--   03 nothing redeemed            04 savings 300 only
--   05 wallet 500 only             06 savings 300 + wallet 100
--   07 savings 300 + wallet 400    08 savings 500 (amount/method cases)
--   09 cancelled shipping_status   10 cancelled_at only
--   11 'canceled' spelling         12 savings reversed
--   13 wallet leg reversed         14 another customer's order (c2)
--   15 wallet leg under a different merchant's customer row (c3 / m2)
--   16 order whose customer row belongs to m2 (c3), no ledger
--   17 USD order                   18-24 payment_status variants
--   25 wallet leg never completed  26 legit, finalized as service_role
--   27 legit, float-noise p_amount (savings 300 + wallet 200)
DO $fixtures$
DECLARE
  v_m1 uuid := '5c0d0100-0000-4000-8000-000000000001';
  v_m2 uuid := '5c0d0100-0000-4000-8000-000000000002';
  v_c1 uuid := '5c0d0200-0000-4000-8000-000000000001';
  v_c2 uuid := '5c0d0200-0000-4000-8000-000000000002';
  v_c3 uuid := '5c0d0200-0000-4000-8000-000000000003';
  v_p1 uuid := '5c0d0400-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    ('5c0d0000-0000-4000-8000-000000000001',
     '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'scop-u1@example.test', 'test', pg_catalog.now(),
     pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb),
    ('5c0d0000-0000-4000-8000-000000000002',
     '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'scop-u2@example.test', 'test', pg_catalog.now(),
     pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_m1, 'scop-m1@example.test', 'SCOP M1', 'scop-m1'),
    (v_m2, 'scop-m2@example.test', 'SCOP M2', 'scop-m2');

  INSERT INTO public.customers (id, merchant_id, email, user_id)
  VALUES
    (v_c1, v_m1, 'scop-u1@example.test', '5c0d0000-0000-4000-8000-000000000001'),
    (v_c2, v_m1, 'scop-u2@example.test', '5c0d0000-0000-4000-8000-000000000002'),
    (v_c3, v_m2, 'scop-u1@example.test', '5c0d0000-0000-4000-8000-000000000001');

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance)
  VALUES
    ('5c0d0300-0000-4000-8000-000000000001', v_c1, v_m1, 100000),
    ('5c0d0300-0000-4000-8000-000000000002', v_c2, v_m1, 1000),
    ('5c0d0300-0000-4000-8000-000000000003', v_c3, v_m2, 1000);

  INSERT INTO public.products (id, merchant_id, name, price, status)
  VALUES (v_p1, v_m1, 'SCOP Fixture Product', 500, 'active');

  INSERT INTO public.orders (
    id, merchant_id, customer_id, order_number, total,
    payment_status, shipping_status, currency
  )
  SELECT
    ('5c0d1100-0000-4000-8000-0000000000' || o.n)::uuid, v_m1,
    CASE o.n WHEN '14' THEN v_c2 WHEN '16' THEN v_c3 ELSE v_c1 END,
    'SCOP-' || o.n, 500,
    o.payment_status, o.shipping_status, o.currency
  FROM (VALUES
    ('01', 'unpaid', 'pending', 'NGN'), ('02', 'unpaid', 'pending', 'NGN'),
    ('03', 'unpaid', 'pending', 'NGN'), ('04', 'unpaid', 'pending', 'NGN'),
    ('05', 'unpaid', 'pending', 'NGN'), ('06', 'unpaid', 'pending', 'NGN'),
    ('07', 'unpaid', 'pending', 'NGN'), ('08', 'unpaid', 'pending', 'NGN'),
    ('09', 'unpaid', 'cancelled', 'NGN'), ('10', 'unpaid', 'pending', 'NGN'),
    ('11', 'unpaid', 'canceled', 'NGN'), ('12', 'unpaid', 'pending', 'NGN'),
    ('13', 'unpaid', 'pending', 'NGN'), ('14', 'unpaid', 'pending', 'NGN'),
    ('15', 'unpaid', 'pending', 'NGN'), ('16', 'unpaid', 'pending', 'NGN'),
    ('17', 'unpaid', 'pending', 'USD'),
    ('18', 'paid', 'pending', 'NGN'), ('19', 'cancelled', 'pending', 'NGN'),
    ('20', 'refunded', 'pending', 'NGN'), ('21', 'failed', 'pending', 'NGN'),
    ('22', 'pending', 'pending', 'NGN'),
    ('23', 'partially_paid', 'pending', 'NGN'),
    ('24', 'bnpl_pending', 'pending', 'NGN'),
    ('25', 'unpaid', 'pending', 'NGN'), ('26', 'unpaid', 'pending', 'NGN'),
    ('27', 'unpaid', 'pending', 'NGN')
  ) AS o(n, payment_status, shipping_status, currency);

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id = '5c0d1100-0000-4000-8000-000000000010';

  -- One matching line item per savings order, and one goal per savings
  -- order holding exactly the amount to be redeemed (a completed legacy
  -- goal, the shape the production savings flow produces).
  INSERT INTO public.order_items (order_id, product_id, variant_id, name, price, quantity)
  SELECT ('5c0d1100-0000-4000-8000-0000000000' || s.n)::uuid, v_p1, NULL,
    'SCOP item', 500, 1
  FROM (VALUES
    ('01'), ('02'), ('04'), ('06'), ('07'), ('08'), ('09'), ('10'), ('11'),
    ('12'), ('13'), ('14'), ('15'), ('17'), ('18'), ('19'), ('20'), ('21'),
    ('22'), ('23'), ('24'), ('25'), ('26'), ('27')
  ) AS s(n);

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    current_amount, contribution_amount, contribution_frequency, start_date,
    maturity_date, source_mode, status, completed_at, terms_accepted_at,
    non_withdrawable_accepted_at
  )
  SELECT
    ('5c0d0500-0000-4000-8000-0000000000' || g.n)::uuid, v_m1,
    CASE g.n WHEN '14' THEN v_c2 ELSE v_c1 END, v_p1,
    'SCOP goal ' || g.n, g.amount, g.amount, 10, 'weekly', '2026-01-01',
    '2026-12-31', 'manual', 'completed', pg_catalog.now(), pg_catalog.now(),
    pg_catalog.now()
  FROM (VALUES
    ('01', 500), ('02', 300), ('04', 300), ('06', 300), ('07', 300),
    ('08', 500), ('09', 500), ('10', 500), ('11', 500), ('12', 500),
    ('13', 300), ('14', 500), ('15', 300), ('17', 500), ('18', 500),
    ('19', 500), ('20', 500), ('21', 500), ('22', 500), ('23', 500),
    ('24', 500), ('25', 300), ('26', 500), ('27', 300)
  ) AS g(n, amount);

  -- A redemption row that never completed must not count as a debit.
  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id, status
  )
  VALUES (
    '5c0d0300-0000-4000-8000-000000000001', v_c1, v_m1, 'redemption', 200,
    99800, 'order_redemption', '5c0d1100-0000-4000-8000-000000000025',
    'pending'
  );
END;
$fixtures$;

-- --- Redemptions through the real RPCs, as the buyer (user 1) ------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"5c0d0000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $redeem$
DECLARE
  r record;
  v_result record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('01', 500, 0), ('02', 300, 200), ('04', 300, 0), ('05', 0, 500),
      ('06', 300, 100),
      -- redeem_wallet_for_order does not cap the amount at the order total.
      ('07', 300, 400),
      ('08', 500, 0), ('09', 500, 0), ('10', 500, 0), ('11', 500, 0),
      ('12', 500, 0), ('13', 300, 200), ('17', 500, 0), ('18', 500, 0),
      ('19', 500, 0), ('20', 500, 0), ('21', 500, 0), ('22', 500, 0),
      ('23', 500, 0), ('24', 500, 0), ('25', 300, 0), ('26', 500, 0),
      ('27', 300, 200)
    ) AS p(n, savings, wallet)
  LOOP
    IF r.savings > 0 THEN
      SELECT * INTO v_result FROM public.redeem_savings_for_order(
        '5c0d0200-0000-4000-8000-000000000001',
        '5c0d0100-0000-4000-8000-000000000001',
        ('5c0d1100-0000-4000-8000-0000000000' || r.n)::uuid,
        ('5c0d0500-0000-4000-8000-0000000000' || r.n)::uuid,
        r.savings, 'scop-' || r.n
      );
      IF NOT v_result.success OR v_result.redeemed_amount <> r.savings THEN
        RAISE EXCEPTION 'setup: savings redeem order % failed: %', r.n,
          row_to_json(v_result);
      END IF;
    END IF;
    IF r.wallet > 0 THEN
      SELECT * INTO v_result FROM public.redeem_wallet_for_order(
        '5c0d0200-0000-4000-8000-000000000001',
        '5c0d0100-0000-4000-8000-000000000001',
        ('5c0d1100-0000-4000-8000-0000000000' || r.n)::uuid,
        r.wallet, 'SCOP-' || r.n
      );
      IF NOT v_result.success OR v_result.redeemed_amount <> r.wallet THEN
        RAISE EXCEPTION 'setup: wallet redeem order % failed: %', r.n,
          row_to_json(v_result);
      END IF;
    END IF;
  END LOOP;

  -- A wallet leg recorded against ANOTHER merchant's customer row (the
  -- buyer's own customer there) must never count toward an m1 order.
  SELECT * INTO v_result FROM public.redeem_wallet_for_order(
    '5c0d0200-0000-4000-8000-000000000003',
    '5c0d0100-0000-4000-8000-000000000002',
    '5c0d1100-0000-4000-8000-000000000015', 200, 'SCOP-15'
  );
  IF NOT v_result.success OR v_result.redeemed_amount <> 200 THEN
    RAISE EXCEPTION 'setup: cross-tenant wallet redeem failed: %',
      row_to_json(v_result);
  END IF;
END;
$redeem$;

-- The buyer's own savings leg for order 15 (m1 / c1).
DO $redeem15$
DECLARE
  v_result record;
BEGIN
  -- Goal 15 was created at 300; the cross-tenant case adds the real
  -- savings leg so only the wallet leg is the foreign one.
  SELECT * INTO v_result FROM public.redeem_savings_for_order(
    '5c0d0200-0000-4000-8000-000000000001',
    '5c0d0100-0000-4000-8000-000000000001',
    '5c0d1100-0000-4000-8000-000000000015',
    '5c0d0500-0000-4000-8000-000000000015', 300, 'scop-15'
  );
  IF NOT v_result.success OR v_result.redeemed_amount <> 300 THEN
    RAISE EXCEPTION 'setup: savings redeem order 15 failed: %',
      row_to_json(v_result);
  END IF;
END;
$redeem15$;

-- Another customer's own order, redeemed by that customer (user 2).
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"5c0d0000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

DO $redeem_other$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result FROM public.redeem_savings_for_order(
    '5c0d0200-0000-4000-8000-000000000002',
    '5c0d0100-0000-4000-8000-000000000001',
    '5c0d1100-0000-4000-8000-000000000014',
    '5c0d0500-0000-4000-8000-000000000014', 500, 'scop-14'
  );
  IF NOT v_result.success OR v_result.redeemed_amount <> 500 THEN
    RAISE EXCEPTION 'setup: other-customer savings redeem failed: %',
      row_to_json(v_result);
  END IF;
END;
$redeem_other$;

-- Reversals through the real RPCs (what order cancellation runs).
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $reverse$
DECLARE
  v_savings numeric;
  v_wallet record;
BEGIN
  v_savings := public.reverse_savings_redemption_for_order(
    '5c0d1100-0000-4000-8000-000000000012',
    '5c0d0100-0000-4000-8000-000000000001',
    NULL, 'scop test reversal'
  );
  IF v_savings IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'setup: savings reversal returned %', v_savings;
  END IF;

  SELECT * INTO v_wallet FROM public.reverse_wallet_redemption(
    '5c0d1100-0000-4000-8000-000000000013', 'scop test reversal',
    '5c0d0100-0000-4000-8000-000000000001'
  );
  IF NOT v_wallet.success OR v_wallet.reversed_amount <> 200 THEN
    RAISE EXCEPTION 'setup: wallet reversal failed: %', row_to_json(v_wallet);
  END IF;
END;
$reverse$;

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

ROLLBACK;
