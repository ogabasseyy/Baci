-- REGRESSION TEST: round-53 BNPL reconciliation finalization.
--
-- record_verified_paystack_cancellation_refund_v1 skipped
-- bnpl_approved orders: for a cancelled mixed BNPL order whose
-- provider refund settled after the worker completed, settlement
-- reversal, processed-refund notifications, and review closure
-- never ran. A processed verdict must now run the shared
-- aggregate finalization for BNPL orders; a nonterminal verdict
-- must still leave them untouched. The coverage scan also counts
-- legacy refunded rows as terminal evidence like the claim and
-- executor rules. Self-contained fixtures use the b531 namespace
-- and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round53_gates.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := 'b5310000-0000-4000-8000-000000000001';
  v_merchant_id uuid := 'b5310100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'bnpl-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'bnpl-owner@example.test',
      'BNPL Fixture', 'bnpl-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('b5311000-0000-4000-8000-000000000091', v_merchant_id, 'BNPL-091',
      100, 100, 'bnpl_approved', 'cancelled', pg_catalog.now()),
    ('b5311000-0000-4000-8000-000000000092', v_merchant_id, 'BNPL-092',
      100, 100, 'bnpl_approved', 'cancelled', pg_catalog.now()),
    ('b5311000-0000-4000-8000-000000000093', v_merchant_id, 'BNPL-093',
      200, 200, 'bnpl_approved', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('b5312000-0000-4000-8000-000000000091', v_merchant_id,
      'b5311000-0000-4000-8000-000000000091', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-91', '{}'::jsonb),
    ('b5312000-0000-4000-8000-000000000092', v_merchant_id,
      'b5311000-0000-4000-8000-000000000091', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '123456',
      jsonb_build_object(
        'payment_transaction_id', 'b5312000-0000-4000-8000-000000000091')),
    ('b5312000-0000-4000-8000-000000000093', v_merchant_id,
      'b5311000-0000-4000-8000-000000000092', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-92', '{}'::jsonb),
    ('b5312000-0000-4000-8000-000000000094', v_merchant_id,
      'b5311000-0000-4000-8000-000000000092', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '123457',
      jsonb_build_object(
        'payment_transaction_id', 'b5312000-0000-4000-8000-000000000093')),
    ('b5312000-0000-4000-8000-000000000095', v_merchant_id,
      'b5311000-0000-4000-8000-000000000093', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-93a', '{}'::jsonb),
    ('b5312000-0000-4000-8000-000000000096', v_merchant_id,
      'b5311000-0000-4000-8000-000000000093', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-93b', '{}'::jsonb),
    ('b5312000-0000-4000-8000-000000000097', v_merchant_id,
      'b5311000-0000-4000-8000-000000000093', 'refund', 100, 'NGN',
      'refunded', 'paystack', '123458',
      jsonb_build_object(
        'payment_transaction_id', 'b5312000-0000-4000-8000-000000000095',
        'provider_refund_status', 'processed')),
    ('b5312000-0000-4000-8000-000000000098', v_merchant_id,
      'b5311000-0000-4000-8000-000000000093', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '123459',
      jsonb_build_object(
        'payment_transaction_id', 'b5312000-0000-4000-8000-000000000096'));
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round53_gates$
DECLARE
  v_verdict text;
  v_status text;
  v_label text;
  v_notifications integer;
BEGIN
  -- A settled provider refund on a BNPL order runs the shared
  -- aggregate finalization: the order flips to refunded and both
  -- processed notifications queue. Pre-fix the verdict persisted
  -- while the order stayed bnpl_approved.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b5312000-0000-4000-8000-000000000092', 'processed', 987654321,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'BNPL verdict misreported, got %', v_verdict;
  END IF;
  SELECT status INTO v_status FROM public.transactions
  WHERE id = 'b5312000-0000-4000-8000-000000000092';
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'BNPL refund not completed, got %', v_status;
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = 'b5311000-0000-4000-8000-000000000091';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'BNPL order not finalized, got %', v_label;
  END IF;
  SELECT count(*) INTO v_notifications
  FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = 'b5311000-0000-4000-8000-000000000091'
    AND event_type IN ('processed_customer_email', 'processed_merchant_push');
  IF v_notifications <> 2 THEN
    RAISE EXCEPTION 'BNPL processed notifications missing, got %',
      v_notifications;
  END IF;

  -- A nonterminal verdict still leaves the BNPL order untouched.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b5312000-0000-4000-8000-000000000094', 'processing', 987654322,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processing' THEN
    RAISE EXCEPTION 'control verdict misreported, got %', v_verdict;
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = 'b5311000-0000-4000-8000-000000000092';
  IF v_label <> 'bnpl_approved' THEN
    RAISE EXCEPTION 'control order finalized early, got %', v_label;
  END IF;

  -- A legacy refunded row covers its leg like a completed one: once
  -- the remaining Paystack leg settles, finalization runs instead
  -- of stranding reversal, notifications, and review closure. The
  -- label alone cannot prove it (the transactions sync trigger
  -- flips it on the verdict write either way): the processed
  -- notifications exist only when the shared finalization ran.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b5312000-0000-4000-8000-000000000098', 'processed', 987654323,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'legacy verdict misreported, got %', v_verdict;
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = 'b5311000-0000-4000-8000-000000000093';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'legacy-covered order not finalized, got %', v_label;
  END IF;
  SELECT count(*) INTO v_notifications
  FROM public.paystack_cancellation_refund_notifications
  WHERE order_id = 'b5311000-0000-4000-8000-000000000093'
    AND event_type IN ('processed_customer_email', 'processed_merchant_push');
  IF v_notifications <> 2 THEN
    RAISE EXCEPTION 'legacy finalization stranded, notifications got %',
      v_notifications;
  END IF;
END;
$refund_round53_gates$;

ROLLBACK;
