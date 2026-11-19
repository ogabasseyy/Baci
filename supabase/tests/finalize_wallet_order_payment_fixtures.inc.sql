-- Include-only fixtures for the finalize_wallet_order_payment suites
-- (finalize_wallet_order_payment_refusals.sql and _finalization.sql). Not a
-- standalone check: it carries no BEGIN/ROLLBACK, so the including suite owns
-- the transaction. Debits are created through the real redeem_wallet_for_order
-- RPC and the reversal through the real reverse_wallet_redemption RPC, so the
-- ledger shapes are the ones production code writes. Leaves the session on the
-- connection role.

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

RESET ROLE;
