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
  v_ps_order_id uuid := '9ef81000-0000-4000-8000-000000000002';
  v_ps_leg_id uuid := '9ef82000-0000-4000-8000-000000000005';
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
      'paid', 'cancelled', pg_catalog.now()),
    (v_ps_order_id, v_merchant_a, 'SCOPE-002', 100, 100,
      'paid', 'cancelled', pg_catalog.now());

  -- Legitimate cash capture for merchant A, plus a lone Paystack
  -- capture on the second order (the self-pin case: exactly one
  -- outstanding external leg).
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    (v_leg_id, v_merchant_a, v_order_id, 'payment', 100, 'NGN',
      'completed', 'cash', 'scope-leg-a', '{}'::jsonb),
    (v_ps_leg_id, v_merchant_a, v_ps_order_id, 'payment', 100, 'NGN',
      'completed', 'paystack', 'scope-leg-ps', '{}'::jsonb);

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
      jsonb_build_object('payment_transaction_id', v_leg_id::text)),
    -- Rogue drain pinned to the Paystack capture: unscoped
    -- pin-candidate/outstanding aggregates would read the leg as
    -- fully drained and route the attestation to review.
    ('9ef82000-0000-4000-8000-000000000006', v_merchant_b, v_ps_order_id,
      'refund', 100, 'NGN', 'completed', 'manual', 'scope-rogue-ps',
      jsonb_build_object('payment_transaction_id', v_ps_leg_id::text)),
    -- Rogue payment leg plus a partial manual linked to it: an
    -- unscoped partial scan would report partial-manual state for
    -- merchant A from merchant B's rows alone.
    ('9ef82000-0000-4000-8000-000000000007', v_merchant_b, v_order_id,
      'payment', 100, 'NGN', 'completed', 'cash', 'scope-rogue-leg',
      '{}'::jsonb),
    ('9ef82000-0000-4000-8000-000000000008', v_merchant_b, v_order_id,
      'refund', 40, 'NGN', 'completed', 'manual', 'scope-rogue-partial',
      jsonb_build_object(
        'payment_transaction_id',
        '9ef82000-0000-4000-8000-000000000007'));

  -- Reach the partial helper past the schema boundary (rolled
  -- back): the suite asserts production keeps USAGE denied.
  GRANT USAGE ON SCHEMA private TO authenticated;
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
  v_partial boolean;
  v_note_events integer;
  -- Replay identity includes the refund instant: record and replay
  -- must present the same instant, not two clock reads apart.
  v_refunded_at timestamptz := pg_catalog.now();
BEGIN
  -- Through the production manager path (DEFINER-side writes): the
  -- rogue rows are invisible to the merchant-scoped scans, so the
  -- full manual record succeeds instead of routing to review.
  SELECT public.manage_order_refund(
    '9ef81000-0000-4000-8000-000000000001', 'manual', 100,
    v_refunded_at, 'bank_transfer', 'scope-rec-1', NULL, true
  ) INTO v_result;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'scoped record returned null';
  END IF;
  -- The pin-candidate legs list the capture before anything is
  -- recorded: an unscoped outstanding aggregate would read the
  -- rogue drain and hide it.
  SELECT public.manage_order_refund(
    '9ef81000-0000-4000-8000-000000000002'
  ) INTO v_result;
  IF jsonb_array_length(v_result->'legs') <> 1 THEN
    RAISE EXCEPTION 'rogue drain hid the pin-candidate leg';
  END IF;
  -- Unpinned Paystack attestation beside the rogue drain: the lone
  -- capture self-pins (candidate/outstanding aggregates ignore the
  -- merchant-B row) and the record proceeds to verification.
  SELECT public.manage_order_refund(
    '9ef81000-0000-4000-8000-000000000002', 'manual', 100,
    pg_catalog.now(), 'paystack', 'scope-rec-ps', NULL, true
  ) INTO v_result;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'scoped paystack record returned null';
  END IF;
  -- Partial-manual state ignores the rogue leg pair: merchant A has
  -- no partial coverage (order 1 fully recorded), so only an
  -- unscoped scan could report partial here. (True-behavior is
  -- pinned by the retry-gating suites.)
  SELECT private.manual_refund_partial_v1(
    '9ef81000-0000-4000-8000-000000000001', 100
  ) INTO v_partial;
  IF v_partial IS NOT FALSE THEN
    RAISE EXCEPTION 'rogue rows reported partial-manual state';
  END IF;
  -- Replaying the transfer with a corrected note audits the
  -- rewrite: the metadata-only update fires no status trigger.
  SELECT public.manage_order_refund(
    '9ef81000-0000-4000-8000-000000000001', 'manual', 100,
    v_refunded_at, 'bank_transfer', 'scope-rec-1', 'Corrected note',
    true
  ) INTO v_result;
  SELECT count(*) INTO v_note_events FROM public.order_refund_events
    WHERE order_id = '9ef81000-0000-4000-8000-000000000001'
      AND action = 'note_corrected';
  IF v_note_events <> 1 THEN
    RAISE EXCEPTION 'note rewrite logged % events, want 1', v_note_events;
  END IF;
END;
$scope_assert$;

ROLLBACK;
