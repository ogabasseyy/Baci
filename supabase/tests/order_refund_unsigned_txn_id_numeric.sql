-- REGRESSION TEST: unsigned 64-bit provider transaction IDs.
--
-- record_verified_paystack_cancellation_refund_v1 took the provider
-- transaction id as bigint while Paystack IDs are unsigned 64-bit
-- carried as decimal text end to end. PostgREST coerces the argument
-- before the function runs, so any ID above 9223372036854775807
-- failed out of range and left the refund unverified/retrying. The
-- parameter is now numeric: a 20-digit ID must verify, and
-- non-numeric input must still fail closed at coercion. An in-range
-- control proves ordinary IDs are unaffected. Self-contained
-- fixtures use the b532 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_unsigned_txn_id_numeric.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := 'b5320000-0000-4000-8000-000000000001';
  v_merchant_id uuid := 'b5320100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'utxn-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'utxn-owner@example.test',
      'Unsigned Fixture', 'unsigned-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('b5321000-0000-4000-8000-000000000091', v_merchant_id, 'UTXN-091',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5321000-0000-4000-8000-000000000092', v_merchant_id, 'UTXN-092',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('b5322000-0000-4000-8000-000000000091', v_merchant_id,
      'b5321000-0000-4000-8000-000000000091', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-utxn-91', '{}'::jsonb),
    ('b5322000-0000-4000-8000-000000000092', v_merchant_id,
      'b5321000-0000-4000-8000-000000000091', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '123456',
      jsonb_build_object(
        'payment_transaction_id', 'b5322000-0000-4000-8000-000000000091',
        'provider_payment_transaction_id', '18446744073709551615')),
    ('b5322000-0000-4000-8000-000000000093', v_merchant_id,
      'b5321000-0000-4000-8000-000000000092', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-utxn-92', '{}'::jsonb),
    ('b5322000-0000-4000-8000-000000000094', v_merchant_id,
      'b5321000-0000-4000-8000-000000000092', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '123457',
      jsonb_build_object(
        'payment_transaction_id', 'b5322000-0000-4000-8000-000000000093',
        'provider_payment_transaction_id', '987654321'));
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $unsigned_txn_id_numeric$
DECLARE
  v_verdict text;
  v_status text;
  v_rejected boolean := false;
BEGIN
  -- A 20-digit ID (2^64 - 1, above int64max) verifies: pre-fix the
  -- bigint parameter rejected the call before the body ran.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b5322000-0000-4000-8000-000000000092', 'processed',
    18446744073709551615, 10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'unsigned verdict misreported, got %', v_verdict;
  END IF;
  SELECT status INTO v_status FROM public.transactions
  WHERE id = 'b5322000-0000-4000-8000-000000000092';
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'unsigned refund not completed, got %', v_status;
  END IF;

  -- In-range IDs verify exactly as before the widening.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'b5322000-0000-4000-8000-000000000094', 'processed', 987654321,
    10000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'control verdict misreported, got %', v_verdict;
  END IF;

  -- Non-numeric input fails closed at argument coercion instead of
  -- reaching the body.
  BEGIN
    PERFORM public.record_verified_paystack_cancellation_refund_v1(
      'b5322000-0000-4000-8000-000000000094', 'processed', 'not-a-number',
      10000, 'NGN'
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'non-numeric transaction id was not rejected';
  END IF;
END;
$unsigned_txn_id_numeric$;

ROLLBACK;
