-- REGRESSION TEST: per-leg uncovered obligation.
--
-- Covers legacy timestamps, self-terminal completion,
-- double-counting, superseded captures, and live-capture gaps.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round33_obligation.sql

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
    ('9ef11000-0000-4000-8000-000000000046',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-046',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000047',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-047',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000063',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000046', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-46a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000064',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000046', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-46b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000065',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000046', 'refund', 100, 'NGN',
      'completed', 'paystack', '777065',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000063',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000066',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000047', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-47a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000067',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000047', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-47b', '{}'::jsonb);

  -- A self-terminal leg with a linked terminal refund row counts
  -- once (payment side), not twice: the sibling leg is still
  -- uncovered, so the label must stay paid.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000063';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000046';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'self-terminal double count flipped label, got %',
      v_label;
  END IF;
  -- Superseded capture: the obsolete leg's reversal already matches
  -- amount_paid while the live capture sits outstanding. Neither the
  -- label nor the remainder may treat the order as refunded.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000066';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000047';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'superseded capture flipped label, got %', v_label;
  END IF;
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000012', '9ef10100-0000-4000-8000-000000000001', 'REFUND-012',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000013', '9ef10100-0000-4000-8000-000000000001', 'REFUND-013',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000014', '9ef10100-0000-4000-8000-000000000001', 'REFUND-014',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000013',
      '9ef11000-0000-4000-8000-000000000014');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000016', '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000012', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-12', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000017', '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000013', 'payment', 100, 'NGN',
      'refunded', 'paypal', 'pp-13', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000018', '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000014', 'payment', 100, 'NGN',
      'refund_pending', 'paypal', 'pp-14', '{}'::jsonb);

END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round33_obligation$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
  v_attempts integer;
BEGIN
  -- The self-terminal leg's linked row counts once: the manager
  -- still owes the uncovered sibling leg.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000046'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'refunded')::numeric <> 100 THEN
    RAISE EXCEPTION 'self-terminal leg double counted, refunded % remaining %',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  -- The superseded capture's reversal matches amount_paid, but the
  -- live capture is still owed: recording stays open.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000047'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR NOT (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'superseded capture stranded, remaining % recordable %',
      v_result->>'remaining', v_result->>'canRecordManual';
  END IF;
  -- Legacy rows without a cancellation timestamp route to review: the
  -- trusted finalization cannot run without one.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000012', 'manual', 10,
      pg_catalog.now(), 'bank_transfer', 'legacy-1',NULL,true);
    RAISE EXCEPTION 'manual accepted without cancellation timestamp';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- Self-terminal payment legs count toward their side: a refunded
  -- PayPal leg is returned money, an in-flight one blocks recording.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000013'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 100 THEN
    RAISE EXCEPTION 'refunded payment leg not counted as returned';
  END IF;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'refunded payment leg still outstanding';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual offered on a self-terminally refunded order';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000014'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'in-flight payment leg not counted as pending';
  END IF;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'in-flight payment leg not processing';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual offered beside an in-flight payment leg';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000014', 'manual', 10,
      pg_catalog.now(), 'bank_transfer', 'inflight-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside an in-flight payment leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

END;
$refund_round33_obligation$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_obligation_asserts$
DECLARE
  v_split_refs integer;
  v_split_merchant_refs integer;
  v_padded_ok boolean;
  v_internal_ok boolean;
  v_o4_status text;
BEGIN
  SELECT payment_status INTO v_o4_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000013';
  IF v_o4_status <> 'refunded' THEN
    RAISE EXCEPTION 'self-terminal payment leg did not flip payment status';
  END IF;

END;
$refund_obligation_asserts$;
ROLLBACK;
