-- REGRESSION TEST: partial-manual and terminal-step labels.
--
-- Covers partial-first responses, error labels, quarantine
-- precedence, legacy null-currency/timestamp rows, and retry.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round33_foundation.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_label text;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    ('9ef10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000001', 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    ('9ef10100-0000-4000-8000-000000000002', '9ef10000-0000-4000-8000-000000000005', 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000002', 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active'),
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000003', 'refund-viewer@example.test',
      'Refund Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active'),
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000004', 'refund-denied@example.test',
      'Refund Denied', 'accountant',
      '{"orders":{"view":false,"refund":false}}'::jsonb, 'active');


  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    ('9ef10200-0000-4000-8000-000000000001', '9ef10100-0000-4000-8000-000000000001', 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000035',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-035',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000038',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-038',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000039',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-039',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000040',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-040',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000041',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-041',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000042',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-042',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  -- Legacy null-currency order: its NGN leg still prices in NGN.
  UPDATE public.orders SET currency = NULL
  WHERE id = '9ef11000-0000-4000-8000-000000000040';

  -- Legacy missing-timestamp order: cancelled and paid, but the
  -- aggregate finalizer rejects a NULL cancelled_at.
  UPDATE public.orders SET cancelled_at = NULL
  WHERE id = '9ef11000-0000-4000-8000-000000000041';

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000048',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000035', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-35', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000049',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000038', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-38', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000050',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000038', 'refund', 100, 'NGN',
      'completed', 'manual', 'm-38#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000049',
        'method', 'paystack', 'reference', 'm-38')),
    ('9ef12000-0000-4000-8000-000000000051',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000039', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-39', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000052',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000039', 'refund', 100, 'NGN',
      'completed', 'paystack', '777001',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000051',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000053',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000040', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-40', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000054',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000041', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-41', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000055',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000042', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-42', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000056',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000042', 'refund', 100, 'NGN',
      'completed', 'paystack', '777002',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000055',
        'provider_refund_status', 'processed'));

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000035',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000035', 5,
      'Paystack/timeout (acquirer 91)'),
    ('9ef11000-0000-4000-8000-000000000038',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'delivery_uncertain', '9ef13000-0000-4000-8000-000000000038', 5,
      'Manual Paystack refunds exceed provider-confirmed amounts; review required'),
    ('9ef11000-0000-4000-8000-000000000039',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'delivery_uncertain', '9ef13000-0000-4000-8000-000000000039', 5,
      'An existing Paystack refund requires reconciliation before retry'),
    ('9ef11000-0000-4000-8000-000000000041',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000041', 5,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000042',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000042', 5,
      'settlement_wallet_missing');

  -- A null-currency order's self-terminal NGN leg flips the label:
  -- without the NGN default the currency comparison is NULL and
  -- the leg never counts.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000053';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000040';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'null-currency self-terminal leg did not flip label, got %',
      v_label;
  END IF;
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round33_foundation$
DECLARE
  v_result jsonb;
  v_label text;
  v_attempts integer;
BEGIN
  -- A first manual record that leaves a balance behind is partial in
  -- the same response: the panel must not advertise a retry the
  -- next call rejects until the next poll.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000035', 'manual', 30,
    pg_catalog.now(), 'bank_transfer', 'partial-first-35', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 70 THEN
    RAISE EXCEPTION 'partial-first manual left remaining %',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'retry advertised in the partial-first response';
  END IF;
  -- The status response carries fixed labels, never raw worker
  -- text, with the Paystack review signal as structured data.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000035'
  ) INTO v_result;
  IF v_result->>'error'
    <> 'The refund ran into a problem. Support has the details.'
    OR v_result->>'error' LIKE '%Paystack%' THEN
    RAISE EXCEPTION 'status response leaked raw worker text: %',
      v_result->>'error';
  END IF;
  IF NOT (v_result->>'needsPaystackCheck')::boolean THEN
    RAISE EXCEPTION 'paystack signal missing for a provider error';
  END IF;
  -- Terminal quarantine reports review before pending evidence:
  -- the drain never resumes these rows.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000038'
  ) INTO v_result;
  IF v_result->>'status' <> 'requires_review' THEN
    RAISE EXCEPTION 'quarantined pending order reports %, want requires_review',
      v_result->>'status';
  END IF;
  IF v_result->>'error'
    <> 'This refund needs review before it can continue.' THEN
    RAISE EXCEPTION 'review error mislabeled: %', v_result->>'error';
  END IF;
  -- ... and before full coverage: an open terminal review stays
  -- visible even once the money lands.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000039'
  ) INTO v_result;
  IF v_result->>'status' <> 'requires_review' THEN
    RAISE EXCEPTION 'quarantined covered order reports %, want requires_review',
      v_result->>'status';
  END IF;
  -- A cancelled order without a cancellation timestamp rejects both
  -- actions: the aggregate finalizer requires cancelled_at, so
  -- rearming would move provider money and then strand settlement
  -- reversal and notifications.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000041', 'retry');
    RAISE EXCEPTION 'retry accepted without a cancellation timestamp';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000041', 'manual', 100,
      pg_catalog.now(), 'bank_transfer', 'no-ts-41', NULL, true);
    RAISE EXCEPTION 'manual accepted without a cancellation timestamp';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;
  -- Full coverage with a failed finalize reports failed (not
  -- refunded) and stays retryable: rearming reruns trusted
  -- finalization, the only recovery when the claim rolled back.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000042'
  ) INTO v_result;
  IF v_result->>'status' <> 'failed' THEN
    RAISE EXCEPTION 'failed finalize reports %, want failed',
      v_result->>'status';
  END IF;
  IF NOT (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'failed finalize is not retryable';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000042', 'retry'
  ) INTO v_result;
  IF (v_result->>'retryRequests')::integer <> 1 THEN
    RAISE EXCEPTION 'finalize rerun was not counted';
  END IF;
END;
$refund_round33_foundation$;
ROLLBACK;
