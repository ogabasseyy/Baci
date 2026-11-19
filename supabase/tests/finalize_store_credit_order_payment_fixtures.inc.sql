-- =====================================================================
-- FIXTURES (include-only, no BEGIN/ROLLBACK): shared by the
-- finalize_store_credit_order_payment_* suites via \ir. Each suite opens
-- its own transaction, includes this file, and rolls back.
--
-- Everything is arranged through the real redeem_savings_for_order,
-- redeem_wallet_for_order, reverse_savings_redemption_for_order and
-- reverse_wallet_redemption RPCs, so the ledger rows are the ones
-- production code writes, under every guard trigger in the replayed schema
-- (the goal catalogue-price guard, the redemption variant / order-total
-- guards, the order route-context guard, the tax-total triggers, ...).
-- =====================================================================

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
  -- order holding the amount to be redeemed.
  INSERT INTO public.order_items (order_id, product_id, variant_id, name, price, quantity)
  SELECT ('5c0d1100-0000-4000-8000-0000000000' || s.n)::uuid, v_p1, NULL,
    'SCOP item', 500, 1
  FROM (VALUES
    ('01'), ('02'), ('04'), ('06'), ('07'), ('08'), ('09'), ('10'), ('11'),
    ('12'), ('13'), ('14'), ('15'), ('17'), ('18'), ('19'), ('20'), ('21'),
    ('22'), ('23'), ('24'), ('25'), ('26'), ('27')
  ) AS s(n);

  -- target_amount must be at least the catalogue price (the goal guard
  -- trigger enforces it), so every goal targets 500; current_amount is what
  -- the checkout redeems. Fully funded goals are completed legacy goals, the
  -- partially funded ones are active.
  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    current_amount, contribution_amount, contribution_frequency, start_date,
    maturity_date, source_mode, status, completed_at, terms_accepted_at,
    non_withdrawable_accepted_at
  )
  SELECT
    ('5c0d0500-0000-4000-8000-0000000000' || g.n)::uuid, v_m1,
    CASE g.n WHEN '14' THEN v_c2 ELSE v_c1 END, v_p1,
    'SCOP goal ' || g.n, 500, g.amount, 10, 'weekly', '2026-01-01',
    '2026-12-31', 'manual',
    CASE WHEN g.amount >= 500 THEN 'completed' ELSE 'active' END,
    CASE WHEN g.amount >= 500 THEN pg_catalog.now() END,
    pg_catalog.now(), pg_catalog.now()
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

RESET ROLE;
