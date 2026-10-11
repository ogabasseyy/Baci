-- REGRESSION TEST: refund finalizer internal-leg coverage.
--
-- Covers the finalize_refunded_cancellation_order_v1 guard: a mixed
-- order (verified external leg beside an outstanding cash-like leg)
-- must not finalize (label, settlement reversal, notifications) until
-- the merchant returns the internal portion. Split from
-- order_refund_management_per_leg_coverage.sql per the 300-line
-- boundary; fixtures use the 9ef3 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_finalizer_internal_coverage.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $finalizer_fixtures$
DECLARE
  v_owner_id uuid := '9ef30000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9ef30100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'finalizer-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'finalizer-owner@example.test',
      'Finalizer Fixture', 'finalizer-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef31000-0000-4000-8000-000000000033', v_merchant_id, 'FINAL-033',
      200, 200, 'paid', 'cancelled'),
    ('9ef31000-0000-4000-8000-000000000035', v_merchant_id, 'FINAL-035',
      100, 100, 'bnpl_approved', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
    '9ef31000-0000-4000-8000-000000000033',
    '9ef31000-0000-4000-8000-000000000035');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    -- A mixed order: verified Paystack leg beside an outstanding cash
    -- leg. Provider reconciliation must not finalize the order (label,
    -- settlement, notifications) before the internal portion returns.
    ('9ef32000-0000-4000-8000-000000000056', v_merchant_id,
      '9ef31000-0000-4000-8000-000000000033', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-33', '{}'::jsonb),
    ('9ef32000-0000-4000-8000-000000000057', v_merchant_id,
      '9ef31000-0000-4000-8000-000000000033', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-33-ok',
      jsonb_build_object(
        'payment_transaction_id', '9ef32000-0000-4000-8000-000000000056',
        'provider_refund_status', 'processed')),
    ('9ef32000-0000-4000-8000-000000000058', v_merchant_id,
      '9ef31000-0000-4000-8000-000000000033', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-33', '{}'::jsonb),
    -- A BNPL-approved order with terminal refund evidence: funded
    -- like paid, so finalization must flip the label too.
    ('9ef32000-0000-4000-8000-000000000060', v_merchant_id,
      '9ef31000-0000-4000-8000-000000000035', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-35', '{}'::jsonb),
    ('9ef32000-0000-4000-8000-000000000061', v_merchant_id,
      '9ef31000-0000-4000-8000-000000000035', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-35-ok',
      jsonb_build_object(
        'payment_transaction_id', '9ef32000-0000-4000-8000-000000000060',
        'provider_refund_status', 'processed'));
END;
$finalizer_fixtures$;

DO $finalizer_coverage$
DECLARE
  v_label text;
  v_notifications integer;
BEGIN
  -- Direct finalization skips mixed orders with outstanding internal
  -- legs: no label flip, no notifications.
  PERFORM public.finalize_refunded_cancellation_order_v1(
    '9ef31000-0000-4000-8000-000000000033',
    '9ef30100-0000-4000-8000-000000000001');
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef31000-0000-4000-8000-000000000033';
  SELECT count(*) INTO v_notifications
  FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = '9ef31000-0000-4000-8000-000000000033';
  IF v_label <> 'paid' OR v_notifications <> 0 THEN
    RAISE EXCEPTION 'finalizer ran with open internal leg: %/%',
      v_label, v_notifications;
  END IF;
  -- Once the merchant returns the internal portion, finalization runs.
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES (
    '9ef32000-0000-4000-8000-000000000059',
    '9ef30100-0000-4000-8000-000000000001',
    '9ef31000-0000-4000-8000-000000000033', 'refund', 100, 'NGN',
    'completed', 'manual', 'man-33',
    jsonb_build_object(
      'payment_transaction_id', '9ef32000-0000-4000-8000-000000000058',
      'method', 'bank_transfer',
      'reference', 'man-33',
      'refunded_at', '2026-09-28T12:00:00Z'));
  PERFORM public.finalize_refunded_cancellation_order_v1(
    '9ef31000-0000-4000-8000-000000000033',
    '9ef30100-0000-4000-8000-000000000001');
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef31000-0000-4000-8000-000000000033';
  SELECT count(*) INTO v_notifications
  FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = '9ef31000-0000-4000-8000-000000000033';
  IF v_label <> 'refunded' OR v_notifications <> 2 THEN
    RAISE EXCEPTION 'finalizer skipped covered mixed order: %/%',
      v_label, v_notifications;
  END IF;
  -- A BNPL-approved order finalizes like a paid one: the label flips
  -- alongside settlement reversal and notifications.
  PERFORM public.finalize_refunded_cancellation_order_v1(
    '9ef31000-0000-4000-8000-000000000035',
    '9ef30100-0000-4000-8000-000000000001');
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef31000-0000-4000-8000-000000000035';
  SELECT count(*) INTO v_notifications
  FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = '9ef31000-0000-4000-8000-000000000035';
  IF v_label <> 'refunded' OR v_notifications <> 2 THEN
    RAISE EXCEPTION 'finalizer left bnpl_approved order: %/%',
      v_label, v_notifications;
  END IF;
END;
$finalizer_coverage$;

ROLLBACK;
