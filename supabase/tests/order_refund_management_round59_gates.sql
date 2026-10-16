-- REGRESSION TEST: round-59 status-trigger backfill, round-60
-- pending/anomaly gates.
--
-- The status sync trigger only fires for terminal rows landing
-- after its migration: cancelled orders whose terminal refund
-- evidence predates it keep a stale paid-family label for reports
-- and other database consumers even though the status read
-- computes refunded. The migration-time backfill repairs them
-- with the trigger's own coverage predicate. Round 60 adds the
-- aggregate pending/anomaly gates to both: a fully covered order
-- keeps its paid-family label while any in-flight, unverified,
-- currency-mismatched, or invalid-link refund survives, matching
-- the manager and the finalizer. Self-contained fixtures use the
-- b591 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round59_gates.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := 'b5910000-0000-4000-8000-000000000001';
  v_merchant_id uuid := 'b5910100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'backfill-owner@example.test',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'backfill-owner@example.test',
      'Backfill Fixture', 'backfill-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('b5911000-0000-4000-8000-000000000091', v_merchant_id, 'FILL-091',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5911000-0000-4000-8000-000000000092', v_merchant_id, 'FILL-092',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5911000-0000-4000-8000-000000000093', v_merchant_id, 'FILL-093',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5911000-0000-4000-8000-000000000094', v_merchant_id, 'FILL-094',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5911000-0000-4000-8000-000000000095', v_merchant_id, 'FILL-095',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5911000-0000-4000-8000-000000000096', v_merchant_id, 'FILL-096',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5911000-0000-4000-8000-000000000097', v_merchant_id, 'FILL-097',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  -- Simulate evidence predating the migration: with the sync
  -- trigger disabled the inserts leave the labels stale.
  ALTER TABLE public.transactions
    DISABLE TRIGGER sync_cancelled_order_refund_status;
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('b5912000-0000-4000-8000-000000000091', v_merchant_id,
      'b5911000-0000-4000-8000-000000000091', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-91', '{}'::jsonb),
    ('b5912000-0000-4000-8000-000000000092', v_merchant_id,
      'b5911000-0000-4000-8000-000000000091', 'refund', 100, 'NGN',
      'completed', 'manual', 'fill-91-1',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000091')),
    ('b5912000-0000-4000-8000-000000000093', v_merchant_id,
      'b5911000-0000-4000-8000-000000000092', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-92', '{}'::jsonb),
    -- Full coverage beside an in-flight sibling refund.
    ('b5912000-0000-4000-8000-000000000094', v_merchant_id,
      'b5911000-0000-4000-8000-000000000093', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-93', '{}'::jsonb),
    ('b5912000-0000-4000-8000-000000000095', v_merchant_id,
      'b5911000-0000-4000-8000-000000000093', 'refund', 100, 'NGN',
      'completed', 'manual', 'fill-93-1',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000094')),
    ('b5912000-0000-4000-8000-000000000096', v_merchant_id,
      'b5911000-0000-4000-8000-000000000093', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', 'fill-93-2',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000094')),
    -- Verified coverage beside an unverified Paystack sibling.
    ('b5912000-0000-4000-8000-000000000097', v_merchant_id,
      'b5911000-0000-4000-8000-000000000094', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-94', '{}'::jsonb),
    ('b5912000-0000-4000-8000-000000000098', v_merchant_id,
      'b5911000-0000-4000-8000-000000000094', 'refund', 100, 'NGN',
      'completed', 'paystack', 'fill-94-1',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000097',
        'provider_refund_status', 'processed')),
    ('b5912000-0000-4000-8000-000000000099', v_merchant_id,
      'b5911000-0000-4000-8000-000000000094', 'refund', 100, 'NGN',
      'completed', 'paystack', 'fill-94-2',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000097')),
    -- Full coverage beside an invalid-link terminal refund.
    ('b5912000-0000-4000-8000-000000000100', v_merchant_id,
      'b5911000-0000-4000-8000-000000000095', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-95', '{}'::jsonb),
    ('b5912000-0000-4000-8000-000000000101', v_merchant_id,
      'b5911000-0000-4000-8000-000000000095', 'refund', 100, 'NGN',
      'completed', 'manual', 'fill-95-1',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000100')),
    ('b5912000-0000-4000-8000-000000000102', v_merchant_id,
      'b5911000-0000-4000-8000-000000000095', 'refund', 100, 'NGN',
      'completed', 'manual', 'fill-95-2',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000999')),
    -- Full coverage beside a foreign-currency terminal refund.
    ('b5912000-0000-4000-8000-000000000103', v_merchant_id,
      'b5911000-0000-4000-8000-000000000096', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-96', '{}'::jsonb),
    ('b5912000-0000-4000-8000-000000000104', v_merchant_id,
      'b5911000-0000-4000-8000-000000000096', 'refund', 100, 'NGN',
      'completed', 'manual', 'fill-96-1',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000103')),
    ('b5912000-0000-4000-8000-000000000105', v_merchant_id,
      'b5911000-0000-4000-8000-000000000096', 'refund', 100, 'USD',
      'completed', 'manual', 'fill-96-2', '{}'::jsonb),
    -- Trigger-side case: the covering manual lands below with the
    -- trigger enabled while an in-flight sibling already exists.
    ('b5912000-0000-4000-8000-000000000106', v_merchant_id,
      'b5911000-0000-4000-8000-000000000097', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-97', '{}'::jsonb),
    ('b5912000-0000-4000-8000-000000000107', v_merchant_id,
      'b5911000-0000-4000-8000-000000000097', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', 'fill-97-1',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000106'));
  ALTER TABLE public.transactions
    ENABLE TRIGGER sync_cancelled_order_refund_status;
END;
$fixtures$;

DO $refund_round59_gates$
DECLARE
  v_status text;
  v_oid uuid;
BEGIN
  -- The predated inserts left both labels stale.
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = 'b5911000-0000-4000-8000-000000000091';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'predated setup flipped early, got %', v_status;
  END IF;

  PERFORM private.backfill_cancelled_order_refund_status();

  -- The fully covered order flips; the uncovered control stays put.
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = 'b5911000-0000-4000-8000-000000000091';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'backfill missed covered order, got %', v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = 'b5911000-0000-4000-8000-000000000092';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'backfill flipped uncovered order, got %', v_status;
  END IF;

  -- Covered orders with surviving pending/anomaly evidence keep
  -- their paid-family label: the manager still reports processing
  -- and the finalizer still refuses them.
  FOR v_oid IN
    SELECT unnest(ARRAY[
      'b5911000-0000-4000-8000-000000000093',
      'b5911000-0000-4000-8000-000000000094',
      'b5911000-0000-4000-8000-000000000095',
      'b5911000-0000-4000-8000-000000000096'
    ]::uuid[])
  LOOP
    SELECT payment_status INTO v_status FROM public.orders
    WHERE id = v_oid;
    IF v_status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'backfill flipped gated order %, got %',
        v_oid, v_status;
    END IF;
  END LOOP;

  -- The live trigger obeys the same gates: the covering manual
  -- lands with the trigger enabled but the label holds while the
  -- in-flight sibling survives.
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('b5912000-0000-4000-8000-000000000108',
      'b5910100-0000-4000-8000-000000000001',
      'b5911000-0000-4000-8000-000000000097', 'refund', 100, 'NGN',
      'completed', 'manual', 'fill-97-2',
      jsonb_build_object(
        'payment_transaction_id', 'b5912000-0000-4000-8000-000000000106'));
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = 'b5911000-0000-4000-8000-000000000097';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'trigger flipped gated order, got %', v_status;
  END IF;
END;
$refund_round59_gates$;

ROLLBACK;
