-- REGRESSION TEST: aggregate claim routing.
--
-- Covers corrupt-evidence, mixed-balance, and unverified-manual
-- routing plus provider-confirmation flips.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_claim_routing.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_viewer_id uuid := '9ef10000-0000-4000-8000-000000000003';
  v_denied_id uuid := '9ef10000-0000-4000-8000-000000000004';
  v_m2_owner_id uuid := '9ef10000-0000-4000-8000-000000000005';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_m2_id uuid := '9ef10100-0000-4000-8000-000000000002';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
  v_product_id uuid := '9ef10300-0000-4000-8000-000000000001';
  v_goal_id uuid := '9ef10400-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_viewer_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_denied_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_m2_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    (v_m2_id, v_m2_owner_id, 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active'),
    (v_merchant_id, v_viewer_id, 'refund-viewer@example.test',
      'Refund Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active'),
    (v_merchant_id, v_denied_id, 'refund-denied@example.test',
      'Refund Denied', 'accountant',
      '{"orders":{"view":false,"refund":false}}'::jsonb, 'active');


  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000017', v_merchant_id, 'REFUND-017',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'REFUND-020',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000027', v_merchant_id, 'REFUND-027',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000017',
      '9ef11000-0000-4000-8000-000000000020',
      '9ef11000-0000-4000-8000-000000000027');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000023', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000017', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-17', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000025', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000017', 'refund', 100, 'NGN',
      'completed', 'paystack', 'badlink-1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000004')),
    ('9ef12000-0000-4000-8000-000000000029', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-20', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000030', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'refund', 60, 'NGN',
      'completed', 'paystack', 'pp-20',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000029',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000031', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 40, 'NGN',
      'completed', 'cash', 'cash-20', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000044', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000027', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-27', '{}'::jsonb);

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000048',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-048',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000068',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000048', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-48a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000069',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000048', 'refund', 100, 'NGN',
      'completed', 'paystack', '777048',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000068',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000070',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000048', 'refund', 100, 'NGN',
      'completed', 'manual', 'claim-48#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000068',
        'method', 'paystack',
        'recorded_by', '9ef10100-0000-4000-8000-000000000001'));

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000020', 0,
      'Insufficient balance');

  -- The Paystack-declared manual the record file would create.
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status,
     gateway, gateway_reference, metadata)
  VALUES
    ('9ef12000-0000-4000-8000-000000000098',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000027', 'refund', 100, 'NGN',
      'completed', 'manual', 'direct-paystack-1#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000044',
        'method', 'paystack', 'reference', 'direct-paystack-1', 'provider_refund_status', 'unverified'));
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_claim_routing$
DECLARE
  v_won boolean;
  v_status text;
  v_label text;
  v_result jsonb;
BEGIN
  -- A corrupt link routes to the worker instead of finalizing: the
  -- claim takes the worker branch (where the executor quarantines
  -- the row for reconciliation) rather than completing past
  -- evidence that may be real provider money.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000017', 'refund',
    '9ef13000-0000-4000-8000-000000000017');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'corrupt link finalized past evidence, got %', v_status;
  END IF;
  -- A mixed order with an outstanding cash balance stays in the
  -- worker branch: finalizing now would close the order with money
  -- still owed.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000020', 'refund',
    '9ef13000-0000-4000-8000-000000000020');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'mixed cash balance finalized early, got %', v_status;
  END IF;
  -- A full manual declared as Paystack is a merchant claim about
  -- provider money, not coverage: the claim defers to the
  -- executor's API-verified provider check instead of finalizing.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000027', 'refund',
    '9ef13000-0000-4000-8000-000000000027');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'unverified paystack manual finalized, got %', v_status;
  END IF;
  -- The guard holds even when a verified provider row covers the
  -- same leg: the executor must still pair-or-quarantine the
  -- merchant claim, or a second provider refund escapes
  -- reconciliation.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000048', 'refund',
    '9ef13000-0000-4000-8000-000000000048');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'covered-leg manual claim finalized, got %', v_status;
  END IF;
  -- Provider confirmation flips the label at once, but the
  -- worker-owned claim keeps polling as processing until finish.
  UPDATE public.transactions
     SET status = 'completed',
         metadata = metadata || '{"provider_refund_status":"processed"}'::jsonb
   WHERE order_id = '9ef11000-0000-4000-8000-000000000027'
     AND transaction_type = 'refund';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000027';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'confirmed paystack manual did not flip label, got %',
      v_label;
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000027'
  ) INTO v_result;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'worker-owned confirmation status = %, want processing',
      v_result->>'status';
  END IF;
  -- Once the worker finishes, the same coverage reports refunded.
  UPDATE public.order_cancellation_side_effects
     SET status = 'completed', completed_at = pg_catalog.now()
   WHERE order_id = '9ef11000-0000-4000-8000-000000000027'
     AND step = 'refund';
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000027'
  ) INTO v_result;
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'finished confirmation status = %, want refunded',
      v_result->>'status';
  END IF;
  -- Per-leg claim assertions (028+) live in
  -- order_refund_management_per_leg_coverage.sql.
END;
$refund_claim_routing$;
ROLLBACK;
