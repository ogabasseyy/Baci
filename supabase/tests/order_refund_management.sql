-- REGRESSION TEST: merchant cancellation-refund core.
--
-- Covers retry/requeue, partial-manual gating, replay/idempotency,
-- claimed-step blocking, and the bounded audit/history tails.
-- Attestation scenarios split to order_refund_management_attestation.sql
-- per the 300-line boundary; self-contained fixtures use the 9ef1
-- namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management.sql

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
    ('9ef11000-0000-4000-8000-000000000008', v_merchant_id, 'REFUND-008',
      100, 100, 'paid', 'cancelled'),
    -- Full coverage beside an anomalous foreign-currency leg.
    ('9ef11000-0000-4000-8000-000000000011', v_merchant_id, 'REFUND-011',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000008',
      '9ef11000-0000-4000-8000-000000000011');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-1', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000012', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000008', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-8', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000013', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000011', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-11', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000014', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000011', 'payment', 50, 'USD',
      'refunded', 'paystack', 'cap-11-fx', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000015', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000011', 'refund', 100, 'NGN',
      'completed', 'paystack', '424244',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000013',
        'provider_refund_status', 'processed'));

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000001', 5,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000008', v_merchant_id, 'refund',
      'claimed', '9ef13000-0000-4000-8000-000000000008', 1, NULL),
    ('9ef11000-0000-4000-8000-000000000011', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000011', 5,
      'Settlement reversal pending');

  -- A long-pending refund accumulates audit events; the status response
  -- must bound them instead of growing every poll.
  INSERT INTO public.order_refund_events (order_id, merchant_id, action, created_at)
  SELECT '9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'seed',
    pg_catalog.now() - (s || ' minutes')::interval
  FROM pg_catalog.generate_series(1, 60) AS s;


END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_manager$
DECLARE
  v_result jsonb;
  v_label text;
BEGIN
  -- Failed refunds are retryable, and a retry requeues exhausted work.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF NOT (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'failed refund is not retryable';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'expected remaining 100, got %', v_result->>'remaining';
  END IF;
  IF NOT (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'refund manager cannot manage refunds';
  END IF;

  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 101,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'excess-1',NULL,true);
    RAISE EXCEPTION 'excess refund accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;

  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'retry'
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'retry did not requeue, got %', v_result->>'status';
  END IF;
  IF (v_result->>'retryRequests')::integer <> 1 THEN
    RAISE EXCEPTION 'retry request was not counted';
  END IF;

  -- Partial manual coverage disables retry: the worker's gateway
  -- matcher would quarantine the step and strand the balance.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 80 THEN
    RAISE EXCEPTION 'partial refund did not reduce remaining';
  END IF;
  IF (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'retry still advertised after partial manual refund';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'retry');
    RAISE EXCEPTION 'retry accepted after partial manual refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_completion_required' THEN RAISE; END IF;
  END;

  -- Replaying the identical manual record is idempotent, while a
  -- conflicting reuse of the reference is rejected.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'manual replay duplicated the ledger row';
  END IF;
  -- Replaying with a corrected note refreshes the annotation on the
  -- existing rows instead of recording new money or going stale.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1', 'teller 4', true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'note-corrected replay duplicated the ledger row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND gateway_reference = 'partial-1#1'
      AND metadata->>'note' = 'teller 4'
  ) THEN
    RAISE EXCEPTION 'note correction not persisted on replay';
  END IF;
  -- The recorded note surfaces in the refund history payload the
  -- timeline renders, including replay corrections.
  IF (v_result->'history'->0->>'note') <> 'teller 4' THEN
    RAISE EXCEPTION 'corrected note missing from refund history';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 25,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true);
    RAISE EXCEPTION 'conflicting reference reuse accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_reference_conflict' THEN RAISE; END IF;
  END;

  -- Attestation scenarios live in order_refund_management_attestation.sql.
  -- Claimed refunds block manual writes and management.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000008'
  ) INTO v_result;
  IF (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'claimed refund still manageable';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000008', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'claimed-1',NULL,true);
    RAISE EXCEPTION 'manual write accepted during claimed refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- Missing-order indistinguishability lives in the tenancy suite.

  -- A retry under full coverage re-arms the step but must not
  -- persist the refunded label while an anomalous leg blocks the
  -- label gates (the aggregate claim still refuses finalization).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000011', 'retry'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'anomalous order not fully covered';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
   WHERE id = '9ef11000-0000-4000-8000-000000000011';
  IF v_label = 'refunded' THEN
    RAISE EXCEPTION 'retry persisted refunded past blocked label gates';
  END IF;

  -- Audit history stays bounded no matter how long a refund pends.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'events') <> 50 THEN
    RAISE EXCEPTION 'refund events unbounded, got %',
      pg_catalog.jsonb_array_length(v_result->'events');
  END IF;
END;
$refund_manager$;
ROLLBACK;
