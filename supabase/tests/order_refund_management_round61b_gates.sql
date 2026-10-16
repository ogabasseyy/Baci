-- REGRESSION TEST: round-61 manual contradiction and manager gates.
--
-- Split from order_refund_management_round61_gates.sql for the
-- 300-line modularity gate: the stamped-manual contradiction verdict
-- and the manager's failed-row pending rules live here with their
-- own fixtures. A later failed verdict for a stamped manual
-- transitions the row (not refund_not_found) and re-alerts the
-- merchant; the demoted row still reselects for recovery polling by
-- stored provider id. An unstamped failed provider row holds the
-- manager pending, while provider-stamped and id-less failures are
-- definitively dead. Self-contained fixtures reuse the b611
-- namespace (each file rolls back) and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round61b_gates.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := 'b6110000-0000-4000-8000-000000000001';
  v_manager_id uuid := 'b6110000-0000-4000-8000-000000000002';
  v_merchant_id uuid := 'b6110100-0000-4000-8000-000000000001';
  v_alien_id uuid := 'b6110000-0000-4000-8000-000000000009';
  v_merchant_b_id uuid := 'b6110100-0000-4000-8000-000000000009';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'fail-owner@example.test',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb),
    (v_manager_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'fail-manager@example.test',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb),
    (v_alien_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'fail-alien@example.test',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'fail-owner@example.test',
      'Failedgate Fixture', 'failedgate-fixture'),
    (v_merchant_b_id, v_alien_id, 'fail-alien@example.test',
      'Failedgate Alien', 'failedgate-alien');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'fail-manager@example.test',
      'Failedgate Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('b6111000-0000-4000-8000-000000000091', v_merchant_id, 'FAIL-091',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b6111000-0000-4000-8000-000000000092', v_merchant_id, 'FAIL-092',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b6111000-0000-4000-8000-000000000095', v_merchant_id, 'FAIL-095',
      100, 100, 'refunded', 'cancelled', pg_catalog.now()),
    -- Merchant-scoping control: own outstanding leg plus alien rows
    -- that must not veto the panel flag.
    ('b6111000-0000-4000-8000-000000000096', v_merchant_id, 'FAIL-096',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('b6112000-0000-4000-8000-000000000091', v_merchant_id,
      'b6111000-0000-4000-8000-000000000091', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-91', '{}'::jsonb),
    ('b6112000-0000-4000-8000-000000000092', v_merchant_id,
      'b6111000-0000-4000-8000-000000000091', 'refund', 100, 'NGN',
      'failed', 'paystack', '611091',
      jsonb_build_object(
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000091')),
    -- Provider-confirmed failure plus an id-less unstamped one:
    -- both definitively dead, the control.
    ('b6112000-0000-4000-8000-000000000096', v_merchant_id,
      'b6111000-0000-4000-8000-000000000092', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-92', '{}'::jsonb),
    ('b6112000-0000-4000-8000-000000000097', v_merchant_id,
      'b6111000-0000-4000-8000-000000000092', 'refund', 100, 'NGN',
      'failed', 'paystack', '611092',
      jsonb_build_object(
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000096',
        'provider_refund_status', 'failed')),
    ('b6112000-0000-4000-8000-000000000101', v_merchant_id,
      'b6111000-0000-4000-8000-000000000092', 'refund', 100, 'NGN',
      'failed', 'paystack', 'fail-92-2',
      jsonb_build_object(
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000096')),
    -- Stamped manual on a finalized order: paired provider id 7
    -- persisted by the proof stamp for contradiction rechecks.
    ('b6112000-0000-4000-8000-000000000102', v_merchant_id,
      'b6111000-0000-4000-8000-000000000095', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-95', '{}'::jsonb),
    ('b6112000-0000-4000-8000-000000000103', v_merchant_id,
      'b6111000-0000-4000-8000-000000000095', 'refund', 100, 'NGN',
      'completed', 'manual', 'merchant-95',
      jsonb_build_object(
        'method', 'paystack',
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000102',
        'provider_refund_status', 'processed',
        'provider_refund_id', 7)),
    ('b6112000-0000-4000-8000-000000000104', v_merchant_id,
      'b6111000-0000-4000-8000-000000000096', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-96', '{}'::jsonb),
    -- Alien rows under merchant B on the same order: an unallocated
    -- terminal refund (veto arm 2) and a foreign-currency leg
    -- (veto arm 1). The manager ignores both; so must the flag.
    ('b6112000-0000-4000-8000-000000000105', v_merchant_b_id,
      'b6111000-0000-4000-8000-000000000096', 'refund', 100, 'NGN',
      'completed', 'paystack', 'alien-96-r', '{}'::jsonb),
    ('b6112000-0000-4000-8000-000000000106', v_merchant_b_id,
      'b6111000-0000-4000-8000-000000000096', 'payment', 100, 'USD',
      'completed', 'stripe', 'alien-96-p', '{}'::jsonb);
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round61_manual_contradiction$
DECLARE
  v_verdict text;
  v_row_status text;
BEGIN
  -- A later failed verdict for a stamped manual transitions the
  -- row (not refund_not_found) and re-alerts the merchant, like a
  -- provider-gateway row: the sweep rechecked the stored id.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b6112000-0000-4000-8000-000000000103', 'failed', 987654328,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'failed' THEN
    RAISE EXCEPTION 'manual contradiction misreported, got %', v_verdict;
  END IF;
  SELECT status INTO v_row_status FROM public.transactions
  WHERE id = 'b6112000-0000-4000-8000-000000000103';
  IF v_row_status <> 'failed' THEN
    RAISE EXCEPTION 'manual contradiction left row %, want failed',
      v_row_status;
  END IF;
  PERFORM 1 FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = 'b6111000-0000-4000-8000-000000000095'
    AND event_type = 'failed_merchant_push' AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual contradiction never re-alerted';
  END IF;
  -- The demoted row still reselects for recovery: the transition
  -- moved it from completed to failed, and a later provider
  -- correction to processed must be observable by polling.
  UPDATE public.transactions
     SET updated_at = pg_catalog.now() - interval '1 hour'
   WHERE id = 'b6112000-0000-4000-8000-000000000103';
  IF NOT EXISTS (
    SELECT 1
    FROM public.select_completed_paystack_cancellation_refund_candidates_v1(
      25, pg_catalog.now(), 5)
    WHERE id = 'b6112000-0000-4000-8000-000000000103'
  ) THEN
    RAISE EXCEPTION 'failed stamped manual missing from sweep';
  END IF;
END;
$refund_round61_manual_contradiction$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'b6110000-0000-4000-8000-000000000002',
  true
);

DO $refund_round61_manager$
DECLARE
  v_result jsonb;
BEGIN
  -- An unstamped failed provider row holds pending: the manager
  -- hides manual recovery and refuses the submission.
  SELECT public.manage_order_refund(
    'b6111000-0000-4000-8000-000000000091'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'unstamped failure left pending %, want 100',
      v_result->>'pending';
  END IF;
  IF (v_result->>'canRecordManual')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unstamped failure advertised manual, got %',
      v_result->>'canRecordManual';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      'b6111000-0000-4000-8000-000000000091', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'fail-91-2', NULL, true);
    RAISE EXCEPTION 'manual accepted beside unstamped failure';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- A provider-stamped failure and an id-less unstamped one
  -- are both definitively dead: pending stays zero and manual
  -- recovery stays available.
  SELECT public.manage_order_refund(
    'b6111000-0000-4000-8000-000000000092'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 0 THEN
    RAISE EXCEPTION 'stamped failure held pending %, want 0',
      v_result->>'pending';
  END IF;
  IF (v_result->>'canRecordManual')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'stamped failure hid manual, got %',
      v_result->>'canRecordManual';
  END IF;

  -- Cross-merchant rows veto nothing: the alien refund and foreign
  -- leg sit under merchant B, so the merchant-scoped flag matches
  -- the merchant-scoped manager and still advertises recovery.
  SELECT public.manage_order_refund(
    'b6111000-0000-4000-8000-000000000096'
  ) INTO v_result;
  IF (v_result->>'canRecordManual')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'alien rows vetoed manual, got %',
      v_result->>'canRecordManual';
  END IF;
END;
$refund_round61_manager$;

ROLLBACK;
