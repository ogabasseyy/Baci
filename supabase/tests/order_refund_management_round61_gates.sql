-- REGRESSION TEST: round-61 failed-provider reverify gates.
--
-- A locally failed Paystack row is not dead: the verified-record
-- function still accepts a later processed verdict for it, so the
-- pending gate's failed-row exclusion let the manager advertise
-- and accept a manual recovery an out-of-order provider event
-- could then double-pay. Failed provider rows (Paystack or
-- Paystack-declared manuals) stay pending until a fresh provider
-- check stamps non-acceptance; the aggregate finalizer and the
-- status label apply the same gate so the three can never
-- disagree. The manual-contradiction and manager scenarios moved to
-- order_refund_management_round61b_gates.sql for the 300-line
-- modularity gate. Self-contained fixtures use the b611 namespace
-- and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round61_gates.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := 'b6110000-0000-4000-8000-000000000001';
  v_manager_id uuid := 'b6110000-0000-4000-8000-000000000002';
  v_merchant_id uuid := 'b6110100-0000-4000-8000-000000000001';
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
      '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'fail-owner@example.test',
      'Failedgate Fixture', 'failedgate-fixture');

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
    ('b6111000-0000-4000-8000-000000000093', v_merchant_id, 'FAIL-093',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b6111000-0000-4000-8000-000000000094', v_merchant_id, 'FAIL-094',
      100, 100, 'bnpl_approved', 'cancelled', pg_catalog.now());

  -- FAIL-093's evidence predates the sync trigger: with the
  -- trigger disabled the inserts leave its label stale for the
  -- backfill below.
  ALTER TABLE public.transactions
    DISABLE TRIGGER sync_cancelled_order_refund_status;
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('b6112000-0000-4000-8000-000000000093', v_merchant_id,
      'b6111000-0000-4000-8000-000000000093', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-93', '{}'::jsonb),
    ('b6112000-0000-4000-8000-000000000094', v_merchant_id,
      'b6111000-0000-4000-8000-000000000093', 'refund', 100, 'NGN',
      'completed', 'manual', 'fail-93-1',
      jsonb_build_object(
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000093')),
    ('b6112000-0000-4000-8000-000000000095', v_merchant_id,
      'b6111000-0000-4000-8000-000000000093', 'refund', 100, 'NGN',
      'failed', 'paystack', '611093',
      jsonb_build_object(
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000093'));
  ALTER TABLE public.transactions
    ENABLE TRIGGER sync_cancelled_order_refund_status;

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    -- Finalizer case: one pending row plus an unstamped failed
    -- sibling on the same leg.
    ('b6112000-0000-4000-8000-000000000098', v_merchant_id,
      'b6111000-0000-4000-8000-000000000094', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-94', '{}'::jsonb),
    ('b6112000-0000-4000-8000-000000000099', v_merchant_id,
      'b6111000-0000-4000-8000-000000000094', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '611094',
      jsonb_build_object(
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000098')),
    ('b6112000-0000-4000-8000-000000000100', v_merchant_id,
      'b6111000-0000-4000-8000-000000000094', 'refund', 100, 'NGN',
      'failed', 'paystack', '611095',
      jsonb_build_object(
        'payment_transaction_id', 'b6112000-0000-4000-8000-000000000098'));
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round61_label$
DECLARE
  v_status text;
BEGIN
  -- Full coverage beside an unstamped failed sibling: the
  -- backfill holds the paid-family label.
  PERFORM private.backfill_cancelled_order_refund_status();
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = 'b6111000-0000-4000-8000-000000000093';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'backfill flipped failed-gated order, got %', v_status;
  END IF;
END;
$refund_round61_label$;

DO $refund_round61_finalizer$
DECLARE
  v_verdict text;
  v_notifications integer;
BEGIN
  -- The unstamped failed sibling vetoes aggregate finalization:
  -- no notifications queue on the processed verdict.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b6112000-0000-4000-8000-000000000099', 'processed', 987654326,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'gated verdict misreported, got %', v_verdict;
  END IF;
  SELECT count(*) INTO v_notifications
  FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = 'b6111000-0000-4000-8000-000000000094'
    AND event_type IN ('processed_customer_email', 'processed_merchant_push');
  IF v_notifications <> 0 THEN
    RAISE EXCEPTION 'gated finalization notified, got %', v_notifications;
  END IF;
  -- Once the provider check stamps the sibling failed, the
  -- repeat verdict finalizes: the veto defers, never strands.
  -- The repeat write reports already_failed while persisting
  -- the stamp that clears the gates.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b6112000-0000-4000-8000-000000000100', 'failed', 987654327,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'already_failed' THEN
    RAISE EXCEPTION 'stamp verdict misreported, got %', v_verdict;
  END IF;
  SELECT metadata->>'provider_refund_status' INTO v_verdict
  FROM public.transactions
  WHERE id = 'b6112000-0000-4000-8000-000000000100';
  IF v_verdict <> 'failed' THEN
    RAISE EXCEPTION 'repeat verdict left no stamp, got %', v_verdict;
  END IF;
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b6112000-0000-4000-8000-000000000099', 'processed', 987654326,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'ungated verdict misreported, got %', v_verdict;
  END IF;
  SELECT count(*) INTO v_notifications
  FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = 'b6111000-0000-4000-8000-000000000094'
    AND event_type IN ('processed_customer_email', 'processed_merchant_push');
  IF v_notifications <> 2 THEN
    RAISE EXCEPTION 'ungated finalization missing, got %', v_notifications;
  END IF;
END;
$refund_round61_finalizer$;

ROLLBACK;
