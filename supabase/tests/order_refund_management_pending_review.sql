-- REGRESSION TEST: pending and review-routed refunds.
--
-- Covers reference races, corrupt links, unlinked pending,
-- and the bounded refund history.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_pending_review.sql

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
    ('9ef11000-0000-4000-8000-000000000052', v_merchant_id, 'REFUND-052',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000017', v_merchant_id, 'REFUND-017',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000022', v_merchant_id, 'REFUND-022',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000052',
      '9ef11000-0000-4000-8000-000000000017',
      '9ef11000-0000-4000-8000-000000000022');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000078', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000052', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-52', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000079', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000052', 'refund', 5, 'NGN',
      'failed', 'paystack', 'race-52#1',
      jsonb_build_object('provider_refund_status', 'failed')),
    ('9ef12000-0000-4000-8000-000000000023', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000017', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-17', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000025', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000017', 'refund', 100, 'NGN',
      'completed', 'paystack', 'badlink-1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000004')),
    ('9ef12000-0000-4000-8000-000000000033', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000022', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-22a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000034', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000022', 'payment', 40, 'NGN',
      'completed', 'paystack', 'cap-22b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000035', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000022', 'refund', 100, 'NGN',
      'completed', 'paystack', 'unlinked-22',
      jsonb_build_object('provider_refund_status', 'processed'));

  GRANT SELECT ON public.orders TO authenticated;
  GRANT SELECT ON public.order_cancellation_side_effects TO authenticated;
  CREATE POLICY refund_suite_probe_side_effects
    ON public.order_cancellation_side_effects FOR SELECT TO authenticated
    USING (true);
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_pending_review$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
BEGIN
  -- A concurrent twin racing the same merchant reference slips past
  -- the idempotency check and collides mid-allocation: the rescue
  -- reports the reference conflict instead of a raw unique violation.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000052', 'manual', 10,
      pg_catalog.now(), 'bank_transfer', 'race-52',NULL,true);
    RAISE EXCEPTION 'racing reference accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_reference_conflict' THEN RAISE; END IF;
  END;

  -- A provider-confirmed failed row never counts as coverage
  -- or pending; an unstamped one stays gated (round-61 suite).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000052'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'pending')::numeric <> 0 THEN
    RAISE EXCEPTION 'failed row counted, refunded % remaining % pending %',
      v_result->>'refunded', v_result->>'remaining', v_result->>'pending';
  END IF;

  -- Corrupt links never count as coverage, but they hold pending: a
  -- completed row claiming another order's leg is excluded from the
  -- remainder and cannot flip the payment label, while recording
  -- beside it stays blocked until reconciliation (the row may be
  -- real provider money under a malformed link — recording past it
  -- would double-pay).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000017'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'corrupt link miscounted, refunded % remaining % pending %',
      v_result->>'refunded', v_result->>'remaining', v_result->>'pending';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000017';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'corrupt link flipped payment label to %', v_label;
  END IF;

  -- Recording beside the corrupt link stays blocked, and the block
  -- precedes any side-effect write: no claimable row is created.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000017', 'manual', 100,
      pg_catalog.now(), 'bank_transfer', 'norow-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside a corrupt link';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000017'
      AND step = 'refund'
  ) THEN
    RAISE EXCEPTION 'blocked manual created a claimable row';
  END IF;

  -- An unlinked refund across several legs waits in pending: it is
  -- neither whole-order coverage nor a flipped label, and manuals
  -- stay blocked until operations links it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000022'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'multi-leg unlinked row miscounted, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'multi-leg unlinked row did not hold processing status';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000022';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'multi-leg unlinked row flipped payment label to %',
      v_label;
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000022', 'manual', 100,
      pg_catalog.now(), 'bank_transfer', 'multileg-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside multi-leg unlinked money';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

END;
$refund_pending_review$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

-- Refund history stays bounded: bulk ledger rows cap the payload at
-- 50 like the audit events.
DO $refund_history_bulk$
BEGIN
  INSERT INTO public.transactions
    (merchant_id, order_id, transaction_type, amount, currency, status,
     gateway, gateway_reference, metadata)
  SELECT '9ef10100-0000-4000-8000-000000000001',
    '9ef11000-0000-4000-8000-000000000017', 'refund', 1, 'NGN', 'completed',
    'manual', 'bulk-' || g || '#1',
    jsonb_build_object(
      'payment_transaction_id', '9ef12000-0000-4000-8000-000000000023',
      'reference', 'bulk-' || g)
  FROM pg_catalog.generate_series(1, 55) g;
END;
$refund_history_bulk$;


SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_history_bound$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000017'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 50 THEN
    RAISE EXCEPTION 'refund history unbounded, got %',
      pg_catalog.jsonb_array_length(v_result->'history');
  END IF;
END;
$refund_history_bound$;

ROLLBACK;
