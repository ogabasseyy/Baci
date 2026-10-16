-- REGRESSION TEST: per-leg retry gating and the retry interval.
--
-- Covers covered-leg retry passthrough, unlinked-manual pending
-- ownership, and the minimum retry interval with its aged
-- requeue. Split from order_refund_management_round45_gates.sql per
-- the 300-line boundary; self-contained fixtures use the 9ef1
-- namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_retry_gating.sql

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
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000001', 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000002', 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    ('9ef10200-0000-4000-8000-000000000001', '9ef10100-0000-4000-8000-000000000001', 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000058',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-058',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000059',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-059',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000060',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-060',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000061',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-061',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000086',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000058', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-58a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000087',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000058', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-58b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000088',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000058', 'refund', 100, 'NGN',
      'completed', 'manual', 'full-leg-a-58#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000086',
        'method', 'bank_transfer', 'reference', 'full-leg-a-58')),
    ('9ef12000-0000-4000-8000-000000000089',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000059', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-59', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000090',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000059', 'refund', 30, 'NGN',
      'completed', 'manual', 'unlinked-59#1',
      jsonb_build_object(
        'method', 'bank_transfer', 'reference', 'unlinked-59')),
    ('9ef12000-0000-4000-8000-000000000091',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000060', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-60', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000092',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000061', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-61', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000058',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000058', 5,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000059',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000059', 5,
      'Insufficient balance');

  -- Retry-throttle fixtures: one row re-armed seconds ago, one
  -- whose last retry aged past the minimum interval.
  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error,
    last_retry_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000060',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000060', 5,
      'Insufficient balance', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000061',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000061', 5,
      'Insufficient balance', pg_catalog.now() - interval '70 seconds');
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_retry_gating$
DECLARE
  v_result jsonb;
BEGIN
  -- A fully manually covered leg never blocks retry for its
  -- uncovered sibling: the executor skips covered legs, so the
  -- merchant recovers the Paystack balance without finishing
  -- manual work that is already done.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000058'
  ) INTO v_result;
  IF NOT (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'covered-leg retry not advertised';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000058', 'retry'
  ) INTO v_result;
  IF (v_result->>'attempts')::integer <> 0
    OR v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'covered-leg retry did not requeue, %/%',
      v_result->>'status', v_result->>'attempts';
  END IF;
  -- An unlinked manual row waits in pending (manual rows never
  -- sole-attribute), so the pending gate — not the partial-manual
  -- helper — owns retry and manual beside it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000059'
  ) INTO v_result;
  IF (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'retry advertised beside unlinked manual row';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000059', 'retry');
    RAISE EXCEPTION 'retry accepted beside unlinked manual row';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- Retries carry a minimum interval: a row re-armed seconds ago
  -- rejects the requeue, while one whose last retry aged out
  -- requeues normally.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000060', 'retry');
    RAISE EXCEPTION 'retry accepted inside the minimum interval';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'retry_too_soon' THEN RAISE; END IF;
  END;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000061', 'retry'
  ) INTO v_result;
  IF (v_result->>'attempts')::integer <> 0
    OR v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'aged retry did not requeue, %/%',
      v_result->>'status', v_result->>'attempts';
  END IF;
END;
$refund_retry_gating$;
ROLLBACK;
