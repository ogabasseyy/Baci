-- =====================================================================
-- REGRESSION TEST: finalize_wallet_order_payment authorization
--
-- A signed-in customer must not be able to mark their own unpaid order
-- paid unless the wallet was actually debited for that order, for the
-- amount due. The RPC has to verify the ledger itself (order_redemption
-- rows net of order_reversal rows), the order state, and the amount.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/finalize_wallet_order_payment_authorization.sql
--
-- Debits are created through the real redeem_wallet_for_order RPC and the
-- reversal through the real reverse_wallet_redemption RPC, so the ledger
-- shapes asserted here are the ones production code writes. Denied
-- EXECUTE is asserted via the catalog (see the $grants$ block): on the
-- pinned replay image a denied function EXECUTE cannot be trapped.
-- =====================================================================

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

-- Orders (all c1 / m1, total 500 unless noted), id suffix -> scenario:
--   01 legitimate    02 no debit      03 partial debit  04 amount mismatch
--   05 cancelled     06 cancelled_at  07 reversed debit 08 other customer
--   09 cross-tenant  10 USD order     11-17 payment_status variants
--   18 canceled spelling      19 debit above the total
--   20 debit row not completed  21 customer from another merchant
DO $fixtures$
DECLARE
  v_m1 uuid := 'f7a10100-0000-4000-8000-000000000001';
  v_m2 uuid := 'f7a10100-0000-4000-8000-000000000002';
  v_c1 uuid := 'f7a10200-0000-4000-8000-000000000001';
  v_c2 uuid := 'f7a10200-0000-4000-8000-000000000002';
  v_c3 uuid := 'f7a10200-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    ('f7a10000-0000-4000-8000-000000000001',
     '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'fwop-u1@example.test', 'test', pg_catalog.now(),
     pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb),
    ('f7a10000-0000-4000-8000-000000000002',
     '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'fwop-u2@example.test', 'test', pg_catalog.now(),
     pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_m1, 'fwop-m1@example.test', 'FWOP M1', 'fwop-m1'),
    (v_m2, 'fwop-m2@example.test', 'FWOP M2', 'fwop-m2');

  INSERT INTO public.customers (id, merchant_id, email, user_id)
  VALUES
    (v_c1, v_m1, 'fwop-u1@example.test', 'f7a10000-0000-4000-8000-000000000001'),
    (v_c2, v_m1, 'fwop-u2@example.test', 'f7a10000-0000-4000-8000-000000000002'),
    (v_c3, v_m2, 'fwop-u1@example.test', 'f7a10000-0000-4000-8000-000000000001');

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance)
  VALUES
    ('f7a10300-0000-4000-8000-000000000001', v_c1, v_m1, 100000),
    ('f7a10300-0000-4000-8000-000000000002', v_c2, v_m1, 1000),
    ('f7a10300-0000-4000-8000-000000000003', v_c3, v_m2, 1000);

  INSERT INTO public.orders (
    id, merchant_id, customer_id, order_number, total,
    payment_status, shipping_status, currency
  )
  SELECT
    ('f7a11000-0000-4000-8000-0000000000' || o.n)::uuid, v_m1,
    CASE o.n WHEN '08' THEN v_c2 WHEN '21' THEN v_c3 ELSE v_c1 END,
    'FWOP-' || o.n, 500,
    o.payment_status, o.shipping_status, o.currency
  FROM (VALUES
    ('01', 'unpaid', 'pending', 'NGN'), ('02', 'unpaid', 'pending', 'NGN'),
    ('03', 'unpaid', 'pending', 'NGN'), ('04', 'unpaid', 'pending', 'NGN'),
    ('05', 'unpaid', 'cancelled', 'NGN'), ('06', 'unpaid', 'pending', 'NGN'),
    ('07', 'unpaid', 'pending', 'NGN'), ('08', 'unpaid', 'pending', 'NGN'),
    ('09', 'unpaid', 'pending', 'NGN'), ('10', 'unpaid', 'pending', 'USD'),
    ('11', 'paid', 'pending', 'NGN'), ('12', 'cancelled', 'pending', 'NGN'),
    ('13', 'refunded', 'pending', 'NGN'), ('14', 'failed', 'pending', 'NGN'),
    ('15', 'pending', 'pending', 'NGN'),
    ('16', 'partially_paid', 'pending', 'NGN'),
    ('17', 'bnpl_pending', 'pending', 'NGN'),
    ('18', 'unpaid', 'canceled', 'NGN'), ('19', 'unpaid', 'pending', 'NGN'),
    ('20', 'unpaid', 'pending', 'NGN'), ('21', 'unpaid', 'pending', 'NGN')
  ) AS o(n, payment_status, shipping_status, currency);

  -- A redemption row that never completed must not count as a debit.
  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id, status
  )
  VALUES (
    'f7a10300-0000-4000-8000-000000000001', v_c1, v_m1, 'redemption', 500,
    99500, 'order_redemption', 'f7a11000-0000-4000-8000-000000000020',
    'pending'
  );

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
    'f7a11000-0000-4000-8000-000000000005',
    'f7a11000-0000-4000-8000-000000000006');
END;
$fixtures$;

-- --- Debits through the real redeem_wallet_for_order RPC, as the buyer ---
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"f7a10000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $redeem$
DECLARE
  v_n text;
  v_result record;
BEGIN
  FOREACH v_n IN ARRAY ARRAY[
    '01', '04', '05', '06', '07', '10', '11', '12', '13', '14', '15', '16',
    '17', '18'
  ]
  LOOP
    SELECT * INTO v_result FROM public.redeem_wallet_for_order(
      'f7a10200-0000-4000-8000-000000000001',
      'f7a10100-0000-4000-8000-000000000001',
      ('f7a11000-0000-4000-8000-0000000000' || v_n)::uuid, 500, 'FWOP-' || v_n
    );
    IF NOT v_result.success OR v_result.redeemed_amount <> 500 THEN
      RAISE EXCEPTION 'setup: redeem order % failed: %', v_n, row_to_json(v_result);
    END IF;
  END LOOP;

  SELECT * INTO v_result FROM public.redeem_wallet_for_order(
    'f7a10200-0000-4000-8000-000000000001',
    'f7a10100-0000-4000-8000-000000000001',
    'f7a11000-0000-4000-8000-000000000003', 200, 'FWOP-03'
  );
  IF NOT v_result.success OR v_result.redeemed_amount <> 200 THEN
    RAISE EXCEPTION 'setup: partial redeem failed: %', row_to_json(v_result);
  END IF;

  -- redeem_wallet_for_order does not cap the amount at the order total.
  SELECT * INTO v_result FROM public.redeem_wallet_for_order(
    'f7a10200-0000-4000-8000-000000000001',
    'f7a10100-0000-4000-8000-000000000001',
    'f7a11000-0000-4000-8000-000000000019', 600, 'FWOP-19'
  );
  IF NOT v_result.success OR v_result.redeemed_amount <> 600 THEN
    RAISE EXCEPTION 'setup: over-debit redeem failed: %', row_to_json(v_result);
  END IF;

  -- A debit recorded against ANOTHER merchant's customer (the buyer's own
  -- customer row there) must never count toward an m1 order.
  SELECT * INTO v_result FROM public.redeem_wallet_for_order(
    'f7a10200-0000-4000-8000-000000000003',
    'f7a10100-0000-4000-8000-000000000002',
    'f7a11000-0000-4000-8000-000000000009', 500, 'FWOP-09'
  );
  IF NOT v_result.success OR v_result.redeemed_amount <> 500 THEN
    RAISE EXCEPTION 'setup: cross-tenant redeem failed: %', row_to_json(v_result);
  END IF;
END;
$redeem$;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"f7a10000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

DO $redeem_other$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result FROM public.redeem_wallet_for_order(
    'f7a10200-0000-4000-8000-000000000002',
    'f7a10100-0000-4000-8000-000000000001',
    'f7a11000-0000-4000-8000-000000000008', 500, 'FWOP-08'
  );
  IF NOT v_result.success OR v_result.redeemed_amount <> 500 THEN
    RAISE EXCEPTION 'setup: other-customer redeem failed: %', row_to_json(v_result);
  END IF;
END;
$redeem_other$;

-- Order 07: cancelled-style reversal of a full debit via the real RPC.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $reverse$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result FROM public.reverse_wallet_redemption(
    'f7a11000-0000-4000-8000-000000000007', 'fwop test reversal',
    'f7a10100-0000-4000-8000-000000000001'
  );
  IF NOT v_result.success OR v_result.reversed_amount <> 500 THEN
    RAISE EXCEPTION 'setup: reversal failed: %', row_to_json(v_result);
  END IF;
END;
$reverse$;

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
  SELECT payment_status, payment_method INTO v_order
  FROM public.orders WHERE id = 'f7a11000-0000-4000-8000-000000000001';
  IF v_order.payment_status IS DISTINCT FROM 'paid'
    OR v_order.payment_method IS DISTINCT FROM 'wallet' THEN
    RAISE EXCEPTION 'L1: order not paid by wallet: %', row_to_json(v_order);
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
