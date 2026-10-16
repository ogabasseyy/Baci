-- REGRESSION TEST: manual-refund confirmation attestation.
--
-- Covers unattested direct recording, attestation persistence on the
-- ledger row, and unattested replay rejection (no audit-note
-- mutation). Split from order_refund_management.sql per the
-- 300-line boundary; self-contained fixtures use the 9ef1 namespace
-- and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_attestation.sql

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
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-0000-0000-000000000000',
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
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'REFUND-001',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id = '9ef11000-0000-4000-8000-000000000001';

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-1', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000001', 5,
      'Insufficient balance');
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_attestation$
DECLARE
  v_result jsonb;
  v_label text;
  -- Replay identity includes the refund instant: the idempotent
  -- retries below must present the same instant, not two clock
  -- reads microseconds apart, or they read as a conflicting
  -- transfer instead of the same one.
  v_refunded_at timestamptz := pg_catalog.now();
BEGIN
  -- Recording attests money already moved: direct RPC callers must
  -- attest too, and the ledger row keeps the proof.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
      v_refunded_at, 'bank_transfer', 'unconfirmed-1', NULL, false);
    RAISE EXCEPTION 'unattested manual refund accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'refund_confirmation_required' THEN RAISE; END IF;
  END;
  PERFORM public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
    v_refunded_at, 'bank_transfer', 'attested-1', NULL, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND gateway_reference = 'attested-1#1'
      AND metadata->>'confirmed' = 'true'
  ) THEN
    RAISE EXCEPTION 'merchant attestation not persisted on manual row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND gateway_reference = 'attested-1#1'
      AND metadata ? 'recorded_by'
  ) THEN
    RAISE EXCEPTION 'recorder identity persisted to readable metadata';
  END IF;

  -- Replays attest too: the replay branch rewrites audit notes and
  -- short-circuits to status before the record helper is reached, so
  -- an unattested replay must fail without touching the stored note.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
      v_refunded_at, 'bank_transfer', 'attested-1', 'rewritten',
      false);
    RAISE EXCEPTION 'unattested replay accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'refund_confirmation_required' THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND metadata->>'reference' = 'attested-1'
      AND metadata->>'note' = 'rewritten'
  ) THEN
    RAISE EXCEPTION 'unattested replay mutated the audit note';
  END IF;

  -- A replay while the worker holds the step claimed still reads
  -- back status, but the note rewrite freezes: audit metadata must
  -- not mutate in the states the processing gate protects.
  SET LOCAL ROLE service_role;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND step = 'refund'
  ) THEN
    RAISE EXCEPTION 'manual record left no side-effect row to claim';
  END IF;
  UPDATE public.order_cancellation_side_effects SET status = 'claimed'
   WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
     AND step = 'refund';
  SET LOCAL ROLE authenticated;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
    v_refunded_at, 'bank_transfer', 'attested-1',
    'frozen-note', true) INTO v_result;
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND metadata->>'reference' = 'attested-1'
      AND metadata->>'note' = 'frozen-note'
  ) THEN
    RAISE EXCEPTION 'claimed-step replay mutated the audit note';
  END IF;
  -- Unfrozen, the same replay applies the annotation correction.
  SET LOCAL ROLE service_role;
  UPDATE public.order_cancellation_side_effects
     SET status = 'failed', error = NULL
   WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
     AND step = 'refund';
  SET LOCAL ROLE authenticated;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
    v_refunded_at, 'bank_transfer', 'attested-1',
    'applied-note', true) INTO v_result;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND metadata->>'reference' = 'attested-1'
      AND metadata->>'note' = 'applied-note'
  ) THEN
    RAISE EXCEPTION 'unfrozen replay skipped the annotation correction';
  END IF;
  -- Peer identity stays out of the payload at the SQL source, so
  -- direct RPC callers bypassing the route mask see none either.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF (v_result->'history'->0) ? 'recorded_by' THEN
    RAISE EXCEPTION 'recorded_by leaked into refund history';
  END IF;
  IF COALESCE(jsonb_array_length(v_result->'events'), 0) < 1 THEN
    RAISE EXCEPTION 'no audit event to check for actor leaks';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'events') e
    WHERE e ? 'actor') THEN
    RAISE EXCEPTION 'actor leaked into refund events';
  END IF;
  -- A full manual re-arms the queue: the audit action reads queued
  -- like the status response, not failed.
  PERFORM public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 90,
    v_refunded_at, 'bank_transfer', 'attested-full', NULL, true);
  SELECT action INTO v_label FROM public.order_refund_events
   WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
   ORDER BY created_at DESC LIMIT 1;
  IF v_label <> 'queued' THEN
    RAISE EXCEPTION 're-armed queue audited as %, want queued', v_label;
  END IF;
END;
$refund_attestation$;
ROLLBACK;
