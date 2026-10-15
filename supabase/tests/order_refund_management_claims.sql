-- REGRESSION TEST: aggregate claim completion.
--
-- Covers fully manual finalization, partial/uncovered routing,
-- legacy refunded rows, cash-only completion, and notifications.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_claims.sql

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
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'REFUND-001',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000002', v_merchant_id, 'REFUND-002',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000016', v_merchant_id, 'REFUND-016',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000019', v_merchant_id, 'REFUND-019',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000002',
      '9ef11000-0000-4000-8000-000000000016',
      '9ef11000-0000-4000-8000-000000000019');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-1', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000002', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000002', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-2a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000003', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000002', 'payment', 40, 'NGN',
      'completed', 'paystack', 'cap-2b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000021', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000016', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-16', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000022', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000016', 'refund', 100, 'NGN',
      'refunded', 'paystack', 'legacy-16',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000021',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000028', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000019', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-19', '{}'::jsonb);

  -- Order 001's side effect sits in its post-manage terminal state:
  -- the record file's successful retry reset attempts to 0, so the
  -- partial-coverage claim below can still win the row.
  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error,
    retry_requests, last_retry_by, last_retry_at, claimed_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000001', 0, NULL,
      1, '9ef10000-0000-4000-8000-000000000002',
      pg_catalog.now(), pg_catalog.now());
  -- Reproduce the manual-record files' terminal rows directly: the
  -- claim only reads coverage, so live RPC recording adds nothing.
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status,
     gateway, gateway_reference, metadata)
  VALUES
    ('9ef12000-0000-4000-8000-000000000094',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000001', 'refund', 30, 'NGN',
      'completed', 'manual', 'partial-1#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000001',
        'method', 'bank_transfer', 'reference', 'partial-1')),
    ('9ef12000-0000-4000-8000-000000000095',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000002', 'refund', 60, 'NGN',
      'completed', 'manual', 'split-1#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000002',
        'method', 'bank_transfer', 'reference', 'split-1')),
    ('9ef12000-0000-4000-8000-000000000096',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000002', 'refund', 40, 'NGN',
      'completed', 'manual', 'split-1#2',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000003',
        'method', 'bank_transfer', 'reference', 'split-1')),
    ('9ef12000-0000-4000-8000-000000000097',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000019', 'refund', 100, 'NGN',
      'completed', 'manual', 'cashonly-1#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000028',
        'method', 'cash', 'reference', 'cashonly-1'));
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_claims$
DECLARE
  v_won boolean;
  v_status text;
  v_label text;
  v_result jsonb;
BEGIN
  -- A fully manual refund routes through the trusted aggregate
  -- finalization: the next claim sees manual-row coverage and runs
  -- settlement reversal, notifications, and review close.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000002', 'refund',
    '9ef13000-0000-4000-8000-000000000002');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'full manual coverage did not finalize, got %', v_status;
  END IF;
  -- A partial manual refund leaves the legs uncovered for the worker.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000001', 'refund',
    '9ef13000-0000-4000-8000-000000000001');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'partial manual coverage finalized early, got %', v_status;
  END IF;
  -- A legacy refunded row is terminal evidence like a completed one:
  -- full coverage finalizes instead of running the worker.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000016', 'refund',
    '9ef13000-0000-4000-8000-000000000016');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'refunded-row coverage did not finalize, got %', v_status;
  END IF;
  -- A cash-only order with full manual coverage passes the claim
  -- guard on that coverage alone and runs the trusted finalization.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000019', 'refund',
    '9ef13000-0000-4000-8000-000000000019');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'cash-only coverage did not finalize, got %', v_status;
  END IF;
  -- The aggregate claim completed the fully manual order; the
  -- self-terminal PayPal leg flipped its label on landing.
  IF NOT EXISTS (SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000002'
      AND step = 'refund' AND status = 'completed') THEN
    RAISE EXCEPTION 'claim did not complete the fully manual order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'finalization skipped notifications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000019') THEN
    RAISE EXCEPTION 'cash-only finalization skipped notifications';
  END IF;
END;
$refund_claims$;
ROLLBACK;
