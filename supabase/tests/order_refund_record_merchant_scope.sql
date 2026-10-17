-- REGRESSION TEST: record-helper coverage scans scope by merchant.
--
-- The record helper's unallocated-refund, currency, and per-leg
-- remaining scans must ignore cross-merchant rows sharing the
-- order id (forged, corrupted, or written by a future
-- service-role path): without the merchant predicate a rogue row
-- forces unallocated_refund_requires_review /
-- payment_currency_requires_review or zeroes a leg's remaining
-- and strands the record. Fixtures use the 9ef8 namespace and
-- roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_record_merchant_scope.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $scope_fixtures$
DECLARE
  v_owner_a uuid := '9ef80000-0000-4000-8000-000000000001';
  v_owner_b uuid := '9ef80000-0000-4000-8000-000000000002';
  v_merchant_a uuid := '9ef80100-0000-4000-8000-000000000001';
  v_merchant_b uuid := '9ef80100-0000-4000-8000-000000000002';
  v_order_id uuid := '9ef81000-0000-4000-8000-000000000001';
  v_leg_id uuid := '9ef82000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'scope-a@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_owner_b, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'scope-b@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_a, v_owner_a, 'scope-a@example.test',
      'Scope Fixture A', 'scope-fixture-a'),
    (v_merchant_b, v_owner_b, 'scope-b@example.test',
      'Scope Fixture B', 'scope-fixture-b');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    (v_order_id, v_merchant_a, 'SCOPE-001', 100, 100,
      'paid', 'cancelled', pg_catalog.now());

  -- Legitimate cash capture for merchant A.
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    (v_leg_id, v_merchant_a, v_order_id, 'payment', 100, 'NGN',
      'completed', 'cash', 'scope-leg-a', '{}'::jsonb);

  -- Rogue cross-merchant rows sharing the order id. Each trips one
  -- unscoped scan: the unallocated refund, the USD payment, and the
  -- leg-draining refund pinned to A's capture.
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef82000-0000-4000-8000-000000000002', v_merchant_b, v_order_id,
      'refund', 10, 'NGN', 'completed', 'manual', 'scope-rogue-refund',
      '{}'::jsonb),
    ('9ef82000-0000-4000-8000-000000000003', v_merchant_b, v_order_id,
      'payment', 50, 'USD', 'completed', 'cash', 'scope-rogue-payment',
      '{}'::jsonb),
    ('9ef82000-0000-4000-8000-000000000004', v_merchant_b, v_order_id,
      'refund', 100, 'NGN', 'completed', 'manual', 'scope-rogue-drain',
      jsonb_build_object('payment_transaction_id', v_leg_id::text));

END;
$scope_fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef80000-0000-4000-8000-000000000001',
  true
);

DO $scope_assert$
DECLARE
  v_result jsonb;
BEGIN
  -- Through the production manager path (DEFINER-side writes): the
  -- rogue rows are invisible to the merchant-scoped scans, so the
  -- full manual record succeeds instead of routing to review.
  SELECT public.manage_order_refund(
    '9ef81000-0000-4000-8000-000000000001', 'manual', 100,
    pg_catalog.now(), 'bank_transfer', 'scope-rec-1', NULL, true
  ) INTO v_result;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'scoped record returned null';
  END IF;
END;
$scope_assert$;

ROLLBACK;
