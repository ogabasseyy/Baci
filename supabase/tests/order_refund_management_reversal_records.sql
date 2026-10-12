-- REGRESSION TEST: reversal-adjusted and unlinked manual records.
--
-- Covers wallet/savings-adjusted remainders and sole-leg
-- attribution of unlinked refunds.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_reversal_records.sql

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

  INSERT INTO public.products (id, merchant_id, name, price, status) VALUES
    (v_product_id, v_merchant_id, 'Refund Fixture Product', 100, 'active');

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id, v_product_id,
    'Refund Fixture Goal', 100, 10, 'weekly', '2026-01-01', '2026-12-31',
    'manual', pg_catalog.now(), pg_catalog.now()
  );

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id);

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id,
      'adjustment', 40, 40, 'order_reversal',
      '9ef11000-0000-4000-8000-000000000004');
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000004', v_merchant_id, 'REFUND-004',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000005', v_merchant_id, 'REFUND-005',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000004',
      '9ef11000-0000-4000-8000-000000000005');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000006', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000004', 'payment', 50, 'NGN',
      'completed', 'paystack', 'cap-4', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000007', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000005', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-5', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000008', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000005', 'refund', 10, 'NGN',
      'completed', 'paystack', '777005',
      jsonb_build_object('provider_refund_status', 'processed'));

  UPDATE public.orders SET customer_id = v_customer_id
  WHERE id = '9ef11000-0000-4000-8000-000000000004';

  INSERT INTO public.order_items (order_id, product_id, name, price, quantity)
  VALUES ('9ef11000-0000-4000-8000-000000000004', v_product_id,
    'Refund Fixture Product', 100, 1);

  INSERT INTO public.customer_savings_redemptions (
    goal_id, merchant_id, customer_id, order_id, amount, idempotency_key,
    metadata
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id,
    '9ef11000-0000-4000-8000-000000000004', 10, 'refund-fixture-004',
    '{"reversed_at":"2026-10-01T00:00:00Z"}'::jsonb
  );

END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_reversal_records$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
BEGIN
  -- Wallet and savings reversals reduce the outstanding balance, and a
  -- reversal-adjusted manual completes the order.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000004'
  ) INTO v_result;
  IF (v_result->>'reversedInternal')::numeric <> 50 THEN
    RAISE EXCEPTION 'internal reversals not accounted';
  END IF;
  IF (v_result->>'remaining')::numeric <> 50 THEN
    RAISE EXCEPTION 'reversed money still outstanding';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000004', 'manual', 51,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'over-after-reversal',NULL,true);
    RAISE EXCEPTION 'manual exceeded reversal-adjusted remaining';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000004', 'manual', 50,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'reversal-adjusted',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'reversal-adjusted manual did not requeue, got %',
      v_result->>'status';
  END IF;

  -- Unlinked completed refunds block manual allocation for review.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000005', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'unlinked-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside unallocated refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'unallocated_refund_requires_review' THEN RAISE; END IF;
  END;

  -- A sole-leg unlinked refund still attributes like the claim gate.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000005'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 10
    OR (v_result->>'pending')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 90 THEN
    RAISE EXCEPTION 'sole unlinked row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;

END;
$refund_reversal_records$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_reversal_asserts$
DECLARE
  v_split_refs integer;
  v_split_merchant_refs integer;
  v_padded_ok boolean;
  v_internal_ok boolean;
  v_o4_status text;
BEGIN

  SELECT payment_status INTO v_o4_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000004';
  IF v_o4_status <> 'refunded' THEN
    RAISE EXCEPTION 'reversal-adjusted completion did not flip payment status';
  END IF;

END;
$refund_reversal_asserts$;
ROLLBACK;
