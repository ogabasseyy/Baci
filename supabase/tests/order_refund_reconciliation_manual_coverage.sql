-- REGRESSION TEST: reconciliation honors manual leg coverage.
--
-- A mixed order (manual-covered leg A, provider leg B) finishes its
-- side effect as completed; when B settles, the Paystack
-- reconciliation gate must run aggregate finalization for the whole
-- order — not strand settlement reversal, notifications, and review
-- closure because A has no same-gateway provider row. A drifted
-- order (legs sum below amount_paid) must NOT finalize even with
-- full per-leg coverage: total returned money gates the predicate.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_reconciliation_manual_coverage.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
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
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture');

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000081', v_merchant_id, 'REFUND-081',
      100, 100, 'paid', 'cancelled'),
    -- Drifted ledger: funded rows sum to 60 against 100 paid.
    ('9ef11000-0000-4000-8000-000000000082', v_merchant_id, 'REFUND-082',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
    '9ef11000-0000-4000-8000-000000000081',
    '9ef11000-0000-4000-8000-000000000082');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000101', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-81a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000102', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'refund', 60, 'NGN',
      'completed', 'manual', 'bank-81a#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000101',
        'reference', 'bank-81a', 'method', 'bank_transfer',
        'confirmed', true)),
    ('9ef12000-0000-4000-8000-000000000103', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'payment', 40, 'NGN',
      'completed', 'paystack', 'cap-81b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000104', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'refund', 40, 'NGN',
      'completed', 'paystack', '424242',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000103')),
    ('9ef12000-0000-4000-8000-000000000105', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000082', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-82', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000106', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000082', 'refund', 60, 'NGN',
      'completed', 'paystack', '424243',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000105'));
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $reconciliation_manual_coverage$
DECLARE
  v_verdict text;
  v_status text;
BEGIN
  -- Leg B settles at the provider: the manual-covered leg A must
  -- not block aggregate finalization.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    '9ef12000-0000-4000-8000-000000000104', 'processed', 424242, 4000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'reconciliation did not process, got %', v_verdict;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000081'
  ) THEN
    RAISE EXCEPTION 'reconciliation skipped finalization for manual-covered leg';
  END IF;
  -- The drifted order stamps its verdict but must not finalize:
  -- 60 returned of 100 paid leaves a gap no leg can accept.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    '9ef12000-0000-4000-8000-000000000106', 'processed', 424243, 6000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'drifted reconciliation did not process, got %', v_verdict;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000082'
  ) THEN
    RAISE EXCEPTION 'drifted reconciliation finalized despite the ledger gap';
  END IF;
  -- A duplicate in-flight provider refund blocks the same-gateway
  -- fallback: per-leg terminal coverage alone must not finalize
  -- while provider money can still settle.
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000083',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-083',
      100, 100, 'paid', 'cancelled', pg_catalog.now());
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000107',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000083', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-83', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000108',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000083', 'refund', 100, 'NGN',
      'completed', 'paystack', '424249',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000107',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000109',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000083', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '424250',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000107'));
  IF private.reconciliation_should_finalize_v1(
    '9ef11000-0000-4000-8000-000000000083',
    '9ef10100-0000-4000-8000-000000000001', 'NGN', 'paid'
  ) THEN
    RAISE EXCEPTION 'predicate finalized beside an in-flight duplicate';
  END IF;
  -- A delivery-uncertain side effect completes once reconciliation
  -- finalizes with no review outstanding ...
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000084',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-084',
      100, 100, 'paid', 'cancelled', pg_catalog.now());
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000110',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000084', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-84', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000111',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000084', 'refund', 100, 'NGN',
      'completed', 'paystack', '424251',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000110'));
  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000084',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'delivery_uncertain', '9ef13000-0000-4000-8000-000000000084', 2,
      'Ambiguous initiation');
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    '9ef12000-0000-4000-8000-000000000111', 'processed', 424251, 10000, 'NGN'
  ) INTO v_verdict;
  SELECT status INTO v_status
    FROM public.order_cancellation_side_effects
   WHERE order_id = '9ef11000-0000-4000-8000-000000000084'
     AND step = 'refund';
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'reconciliation left delivery_uncertain behind, got %',
      v_status;
  END IF;
  -- ... but stays put while a review still needs a human.
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000085',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-085',
      100, 100, 'paid', 'cancelled', pg_catalog.now());
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000112',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000085', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-85', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000113',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000085', 'refund', 100, 'NGN',
      'completed', 'paystack', '424252',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000112'));
  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000085',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'delivery_uncertain', '9ef13000-0000-4000-8000-000000000085', 2,
      'Ambiguous initiation');
  INSERT INTO public.reconciliation_review (
    order_id, merchant_id, issue_type, metadata
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000085',
      '9ef10100-0000-4000-8000-000000000001',
      'provider_refund_outside_cancellation', '{}'::jsonb);
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    '9ef12000-0000-4000-8000-000000000113', 'processed', 424252, 10000, 'NGN'
  ) INTO v_verdict;
  SELECT status INTO v_status
    FROM public.order_cancellation_side_effects
   WHERE order_id = '9ef11000-0000-4000-8000-000000000085'
     AND step = 'refund';
  IF v_status <> 'delivery_uncertain' THEN
    RAISE EXCEPTION 'reconciliation completed despite an open review, got %',
      v_status;
  END IF;
END;
$reconciliation_manual_coverage$;

RESET ROLE;

ROLLBACK;
