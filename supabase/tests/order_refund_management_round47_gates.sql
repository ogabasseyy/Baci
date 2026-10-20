-- REGRESSION TEST: funded links, in-flight completion block, pending floor.
--
-- Covers link validity restricted to funded legs, completion blocked
-- while nonterminal refunds exist, and the pending gate's
-- non-positive amount floor.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round47_gates.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000071', v_merchant_id, 'REFUND-071',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000072', v_merchant_id, 'REFUND-072',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000073', v_merchant_id, 'REFUND-073',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000074', v_merchant_id, 'REFUND-074',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000081', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000071', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r47-71a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000082', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000071', 'payment', 100, 'NGN',
      'failed', 'paystack', 'r47-71b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000083', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000071', 'refund', 100, 'NGN',
      'completed', 'manual', 'cover-71#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000081',
        'method', 'bank_transfer', 'reference', 'cover-71')),
    ('9ef12000-0000-4000-8000-000000000084', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000071', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-71b',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000082',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000085', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000072', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r47-72', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000086', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000072', 'refund', 100, 'NGN',
      'completed', 'manual', 'cover-72#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000085',
        'method', 'bank_transfer', 'reference', 'cover-72')),
    ('9ef12000-0000-4000-8000-000000000087', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000072', 'refund', 100, 'NGN',
      'pending', 'paystack', 'pp-72-extra',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000085')),
    ('9ef12000-0000-4000-8000-000000000088', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000073', 'refund', 0, 'NGN',
      'pending', 'paystack', 'pp-73-zero', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000089', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000074', 'refund', 100, 'NGN',
      'pending', 'paystack', 'pp-74-pos', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000090', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000074', 'refund', -100, 'NGN',
      'pending', 'paystack', 'pp-74-neg', '{}'::jsonb);
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round47_gates$
DECLARE
  v_result jsonb;
BEGIN
  -- A refund linked to a failed leg is unreconciled evidence, not
  -- coverage: the executor never loads failed legs, so the manager
  -- holds it pending instead of reporting refunded past it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000071'
  ) INTO v_result;
  IF v_result->>'status' <> 'processing'
    OR (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'failed-leg link not pending, %/%',
      v_result->>'status', v_result->>'pending';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000071', 'manual', 10,
      pg_catalog.now(), 'bank_transfer', 'blocked-71', NULL, true);
    RAISE EXCEPTION 'manual accepted beside failed-leg evidence';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- The manager agrees with the claim below: in-flight evidence
  -- keeps the order polling instead of reporting refunded.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000072'
  ) INTO v_result;
  IF v_result->>'status' <> 'processing'
    OR (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'in-flight extra not pending, %/%',
      v_result->>'status', v_result->>'pending';
  END IF;
  -- A zero-amount pending row still pins the gate: absence of money
  -- is not absence of evidence.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000073'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 1 THEN
    RAISE EXCEPTION 'zero pending vanished, got %', v_result->>'pending';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000073', 'manual', 10,
      pg_catalog.now(), 'bank_transfer', 'blocked-73', NULL, true);
    RAISE EXCEPTION 'manual accepted beside zero pending row';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- A negative row cannot cancel real in-flight money: the positive
  -- leg counts fully and the corrupt row pins one unit beside it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000074'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 101 THEN
    RAISE EXCEPTION 'signed pending cancelled, got %', v_result->>'pending';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000074', 'manual', 10,
      pg_catalog.now(), 'bank_transfer', 'blocked-74', NULL, true);
    RAISE EXCEPTION 'manual accepted beside signed pending rows';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
END;
$refund_round47_gates$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round47_claim$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  -- The failed-leg link routes to the worker instead of finalizing
  -- past evidence the executor would quarantine.
  SELECT we_won, current_status INTO v_won, v_status
    FROM public.claim_order_cancellation_side_effect(
      '9ef11000-0000-4000-8000-000000000071', 'refund',
      '9ef13000-0000-4000-8000-000000000071');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'failed-leg evidence finalized, got %', v_status;
  END IF;
  -- A covered leg with an extra in-flight refund still routes to
  -- the worker: finalizing now would complete the side effect
  -- while a second provider refund settles unnoticed.
  SELECT we_won, current_status INTO v_won, v_status
    FROM public.claim_order_cancellation_side_effect(
      '9ef11000-0000-4000-8000-000000000072', 'refund',
      '9ef13000-0000-4000-8000-000000000072');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'in-flight extra finalized, got %', v_status;
  END IF;
END;
$refund_round47_claim$;
ROLLBACK;
