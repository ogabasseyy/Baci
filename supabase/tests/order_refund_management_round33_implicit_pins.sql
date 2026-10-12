-- REGRESSION TEST: implicit leg pins.
--
-- Covers sole-leg self-pinning, cross-gateway skipping, and
-- proof-stamp audit idempotency.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round33_implicit_pins.sql

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
    ('9ef11000-0000-4000-8000-000000000045',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-045',
      200, 200, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000048',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000035', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-35', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000061',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000045', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-45a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000062',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000045', 'payment', 100, 'NGN',
      'completed', 'korapay', 'kp-45b', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000035',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000035', 5,
      'Paystack/timeout (acquirer 91)');

END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round33_implicit$
DECLARE
  v_result jsonb;
  v_label text;
  v_attempts integer;
BEGIN
  -- Reproduce the foundation file's partial-first manual so the
  -- implicit pin below pends beside covered money.
  PERFORM public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000035', 'manual', 30,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-first-35', NULL, true);
  -- A sole outstanding external leg pins itself: no review, no
  -- guess. The attestation still pends verification beside the 30
  -- already covered (link asserted below).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000035', 'manual', 70,
    '2026-09-28T12:00:00Z', 'paystack', 'implicit-pin-35', NULL, true
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 70
    OR (v_result->>'remaining')::numeric <> 70 THEN
    RAISE EXCEPTION 'implicit pin left pending % remaining %',
      v_result->>'pending', v_result->>'remaining';
  END IF;
  -- A Paystack attestation pinned to a non-Paystack leg is
  -- invalid: preflight cannot verify it, so recording it would
  -- only quarantine the refund later.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000045', 'manual', 50,
      '2026-09-28T12:00:00Z', 'paystack', 'korapay-pin-45', NULL, true,
      p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000062');
    RAISE EXCEPTION 'paystack pin to a korapay leg was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid_manual_refund' THEN RAISE; END IF;
  END;
  -- The implicit pin skips the Korapay leg: the sole Paystack
  -- capture resolves even beside other gateways, and the
  -- candidate list names it alone.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000045', 'manual', 50,
    '2026-09-28T12:00:00Z', 'paystack', 'implicit-45', NULL, true
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 50
    OR (v_result->>'remaining')::numeric <> 200 THEN
    RAISE EXCEPTION 'implicit paystack pin left pending % remaining %',
      v_result->>'pending', v_result->>'remaining';
  END IF;
  IF pg_catalog.jsonb_array_length(v_result->'legs') <> 1
    OR v_result->'legs'->0->>'id' <> '9ef12000-0000-4000-8000-000000000061' THEN
    RAISE EXCEPTION 'korapay leg listed as a pin candidate: %',
      v_result->'legs';
  END IF;
END;
$refund_round33_implicit$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round36_implicit$
DECLARE
  v_link text;
  v_count integer;
BEGIN
  -- The implicit pin resolved to the sole outstanding leg.
  SELECT metadata->>'payment_transaction_id' INTO v_link
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000035'
  AND gateway_reference = 'implicit-pin-35#1';
  IF v_link <> '9ef12000-0000-4000-8000-000000000048' THEN
    RAISE EXCEPTION 'implicit pin linked %, want leg 048', v_link;
  END IF;
  -- The cross-gateway implicit pin skipped the Korapay leg.
  SELECT metadata->>'payment_transaction_id' INTO v_link
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000045'
  AND gateway_reference = 'implicit-45#1';
  IF v_link <> '9ef12000-0000-4000-8000-000000000061' THEN
    RAISE EXCEPTION 'cross-gateway pin linked %, want leg 061', v_link;
  END IF;
  -- Stamping provider proof reassigns the same status to refire the
  -- label sync: the audit must not log the record twice.
  UPDATE public.transactions
     SET status = status,
         metadata = metadata || '{"provider_refund_status":"processed"}'::jsonb
   WHERE order_id = '9ef11000-0000-4000-8000-000000000035'
     AND gateway_reference = 'implicit-pin-35#1';
  SELECT count(*) INTO v_count FROM public.order_refund_events
   WHERE order_id = '9ef11000-0000-4000-8000-000000000035'
     AND action = 'manual_recorded';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'proof stamp duplicated the audit, got % events', v_count;
  END IF;
END;
$refund_round36_implicit$;
ROLLBACK;
