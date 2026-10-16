-- REGRESSION TEST: NULL amount_paid derives from funded legs.
--
-- amount_paid is defaulted but nullable since baseline. A cancelled
-- legacy order with a NULL total beside a completed funded leg used
-- to coerce the paid total to zero: zero remaining, no manual
-- recording, and already_refunded on every mutation, stranding real
-- money the panel itself surfaces. The manager now derives the paid
-- total from authoritative external funded legs when NULL.
-- Fixtures use the 9ef5 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_null_paid.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $null_paid_fixtures$
DECLARE
  v_owner_id uuid := '9ef50000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef50000-0000-4000-8000-000000000002';
  v_merchant_id uuid := '9ef50100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'nullpaid-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'nullpaid-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'nullpaid@example.test',
      'Null Paid Fixture', 'null-paid-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef51000-0000-4000-8000-000000000001', v_merchant_id, 'NULLPAID-001',
      100, NULL, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef51000-0000-4000-8000-000000000002', v_merchant_id, 'NULLPAID-002',
      75, NULL, 'paid', 'cancelled', pg_catalog.now()),
    -- Fully manual-covered NULL-paid order: the claim derives
    -- paid from funded legs like the manager and finalizes.
    ('9ef51000-0000-4000-8000-000000000004', v_merchant_id, 'NULLPAID-004',
      100, NULL, 'paid', 'cancelled', pg_catalog.now()),
    -- Self-terminalized provider leg: the flag stays on so the
    -- panel keeps polling behind it.
    ('9ef51000-0000-4000-8000-000000000005', v_merchant_id, 'NULLPAID-005',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef52000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef51000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'np-1', '{}'::jsonb),
    ('9ef52000-0000-4000-8000-000000000002', v_merchant_id,
      '9ef51000-0000-4000-8000-000000000002', 'payment', 75, 'NGN',
      'completed', 'cash', 'np-2', '{}'::jsonb),
    ('9ef52000-0000-4000-8000-000000000005', v_merchant_id,
      '9ef51000-0000-4000-8000-000000000004', 'payment', 100, 'NGN',
      'completed', 'paystack', 'np-4', '{}'::jsonb),
    ('9ef52000-0000-4000-8000-000000000006', v_merchant_id,
      '9ef51000-0000-4000-8000-000000000004', 'refund', 100, 'NGN',
      'completed', 'manual', 'np-4#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef52000-0000-4000-8000-000000000005',
        'method', 'bank_transfer', 'reference', 'np-4',
        'confirmed', 'true')),
    ('9ef52000-0000-4000-8000-000000000007', v_merchant_id,
      '9ef51000-0000-4000-8000-000000000005', 'payment', 100, 'NGN',
      'refunded', 'paystack', 'np-5', '{}'::jsonb);
END;
$null_paid_fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef50000-0000-4000-8000-000000000001',
  true
);

DO $null_paid_derivation$
DECLARE
  v_result jsonb;
BEGIN
  -- The owner reads status: no staff row exists in this fixture.
  SELECT public.manage_order_refund(
    '9ef51000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'NULL-paid remaining = %, want 100',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'amountPaid')::numeric <> 100 THEN
    RAISE EXCEPTION 'NULL-paid amountPaid = %, want 100',
      v_result->>'amountPaid';
  END IF;
  IF (v_result->>'canRecordManual')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'NULL-paid order not manually recordable';
  END IF;
  -- Durable provider-backed polling signal: true while a completed
  -- Paystack capture exists, independent of the outstanding list.
  IF (v_result->>'hasPaystackPayment')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'paystack order missing provider-backed flag';
  END IF;
  -- Cash-like legs refund through the manual allocator, not the
  -- wallet/savings ledgers, so a cash-only NULL-paid order derives
  -- its balance too instead of stranding at zero.
  SELECT public.manage_order_refund(
    '9ef51000-0000-4000-8000-000000000002'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 75 THEN
    RAISE EXCEPTION 'NULL-paid cash remaining = %, want 75',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'hasPaystackPayment')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'cash-only order wrongly flagged provider-backed';
  END IF;
  SELECT public.manage_order_refund(
    '9ef51000-0000-4000-8000-000000000005'
  ) INTO v_result;
  IF (v_result->>'hasPaystackPayment')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'self-terminalized leg dropped the provider flag';
  END IF;
END;
$null_paid_derivation$;

DO $null_paid_claim$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  -- Fully covered NULL-paid order: the claim derives paid from
  -- funded legs (100) and finalizes against real returned money,
  -- never against a coalesced zero.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef51000-0000-4000-8000-000000000004', 'refund',
    '9ef53000-0000-4000-8000-000000000004');
  IF v_won OR v_status <> 'completed' THEN
    RAISE EXCEPTION 'null-paid covered claim won=% status=%, want f completed',
      v_won, v_status;
  END IF;
  -- Uncovered NULL-paid cash order: no zero-paid shortcut into
  -- finalization — the claim raises for merchant recording instead
  -- of completing against a coalesced zero.
  BEGIN
    PERFORM public.claim_order_cancellation_side_effect(
      '9ef51000-0000-4000-8000-000000000002', 'refund',
      '9ef53000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'null-paid uncovered cash claim did not raise';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_not_required' THEN RAISE; END IF;
  END;
END;
$null_paid_claim$;

ROLLBACK;
