-- REGRESSION TEST: null-merchant reviews block sweep finalization.
--
-- The sweep/verifier review gates must treat an order-scoped
-- reconciliation_review with merchant_id NULL as belonging to the
-- order: current writers still omit the column, and excluding nulls
-- would let a processed verdict complete a delivery_uncertain step
-- while human work stays open. The control order (no review)
-- completes, proving the gate — not an unreachable path — holds
-- the guarded order back. Fixtures use the 9efa namespace and
-- roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_null_merchant_review_gate.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $review_gate_fixtures$
DECLARE
  v_owner_id uuid := '9efa0000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9efa0100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'nrgate@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'nrgate@example.test',
      'Null Review Fixture', 'null-review-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9efa1000-0000-4000-8000-000000000001', v_merchant_id, 'NRG-001',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9efa1000-0000-4000-8000-000000000002', v_merchant_id, 'NRG-002',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9efa2000-0000-4000-8000-000000000001', v_merchant_id,
      '9efa1000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'nrgate-leg-1', '{}'::jsonb),
    ('9efa2000-0000-4000-8000-000000000002', v_merchant_id,
      '9efa1000-0000-4000-8000-000000000001', 'refund', 100, 'NGN',
      'completed', 'paystack', '7001', '{}'::jsonb),
    ('9efa2000-0000-4000-8000-000000000003', v_merchant_id,
      '9efa1000-0000-4000-8000-000000000002', 'payment', 100, 'NGN',
      'completed', 'paystack', 'nrgate-leg-2', '{}'::jsonb),
    ('9efa2000-0000-4000-8000-000000000004', v_merchant_id,
      '9efa1000-0000-4000-8000-000000000002', 'refund', 100, 'NGN',
      'completed', 'paystack', '7002', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9efa1000-0000-4000-8000-000000000001', v_merchant_id, 'refund',
      'delivery_uncertain', gen_random_uuid(), 2, 'Quarantine: review open'),
    ('9efa1000-0000-4000-8000-000000000002', v_merchant_id, 'refund',
      'delivery_uncertain', gen_random_uuid(), 2, 'Quarantine: control');

  -- Order-scoped review in the legacy shape: no merchant_id.
  INSERT INTO public.reconciliation_review (
    issue_type, order_id, reason, merchant_id
  ) VALUES
    ('payment_match_ambiguous',
      '9efa1000-0000-4000-8000-000000000001',
      'Null-merchant gate fixture', NULL);
END;
$review_gate_fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $review_gate_assert$
DECLARE
  v_status_1 text;
  v_status_2 text;
BEGIN
  PERFORM public.record_verified_paystack_cancellation_refund_v1(
    '9efa2000-0000-4000-8000-000000000002', 'processed', 7001, 10000,
    'NGN'
  );
  PERFORM public.record_verified_paystack_cancellation_refund_v1(
    '9efa2000-0000-4000-8000-000000000004', 'processed', 7002, 10000,
    'NGN'
  );
  SELECT status INTO v_status_1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9efa1000-0000-4000-8000-000000000001'
      AND step = 'refund';
  SELECT status INTO v_status_2 FROM public.order_cancellation_side_effects
    WHERE order_id = '9efa1000-0000-4000-8000-000000000002'
      AND step = 'refund';
  IF v_status_1 <> 'delivery_uncertain' THEN
    RAISE EXCEPTION 'null-merchant review ignored, step %', v_status_1;
  END IF;
  IF v_status_2 <> 'completed' THEN
    RAISE EXCEPTION 'control order did not finalize, step %', v_status_2;
  END IF;
END;
$review_gate_assert$;

ROLLBACK;
