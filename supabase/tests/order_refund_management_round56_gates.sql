-- REGRESSION TEST: round-56 manual-record capability.
--
-- canRecordManual advertised recovery whenever the remainder was
-- positive, but recording allocates only to the record helper's
-- allocatable legs (completed non-wallet/savings, or refunded
-- cash-like) with outstanding capacity: a wallet/savings-only
-- remainder offered a manual form whose every submission ended in
-- payment_ledger_requires_review. The flag now requires an
-- allocatable leg with capacity. Self-contained fixtures use the
-- b561 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round56_gates.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := 'b5610000-0000-4000-8000-000000000001';
  v_manager_id uuid := 'b5610000-0000-4000-8000-000000000002';
  v_merchant_id uuid := 'b5610100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'cap-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'cap-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'cap-owner@example.test',
      'Capability Fixture', 'capability-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'cap-manager@example.test',
      'Capability Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('b5611000-0000-4000-8000-000000000091', v_merchant_id, 'CAP-091',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5611000-0000-4000-8000-000000000092', v_merchant_id, 'CAP-092',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('b5611000-0000-4000-8000-000000000093', v_merchant_id, 'CAP-093',
      150, 150, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    -- Wallet-only remainder with no reversal: nothing allocatable.
    ('b5612000-0000-4000-8000-000000000091', v_merchant_id,
      'b5611000-0000-4000-8000-000000000091', 'payment', 100, 'NGN',
      'completed', 'wallet', 'w-91', '{}'::jsonb),
    -- Cash leg with full capacity: the control.
    ('b5612000-0000-4000-8000-000000000092', v_merchant_id,
      'b5611000-0000-4000-8000-000000000092', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-92', '{}'::jsonb),
    -- Covered cash leg beside an unreversed wallet leg: the cash
    -- capacity is spent and the wallet remainder is not allocatable.
    ('b5612000-0000-4000-8000-000000000093', v_merchant_id,
      'b5611000-0000-4000-8000-000000000093', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-93', '{}'::jsonb),
    ('b5612000-0000-4000-8000-000000000094', v_merchant_id,
      'b5611000-0000-4000-8000-000000000093', 'payment', 50, 'NGN',
      'completed', 'wallet', 'w-93', '{}'::jsonb),
    ('b5612000-0000-4000-8000-000000000095', v_merchant_id,
      'b5611000-0000-4000-8000-000000000093', 'refund', 100, 'NGN',
      'completed', 'manual', 'cap-93-1',
      jsonb_build_object(
        'payment_transaction_id', 'b5612000-0000-4000-8000-000000000093'));
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'b5610000-0000-4000-8000-000000000002',
  true
);

DO $refund_round56_gates$
DECLARE
  v_result jsonb;
BEGIN
  -- A wallet-only remainder offers no manual recovery: recording
  -- would allocate to no leg and end in review.
  SELECT public.manage_order_refund(
    'b5611000-0000-4000-8000-000000000091'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'wallet remainder wrong, got %',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'canRecordManual')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'wallet-only remainder advertised manual, got %',
      v_result->>'canRecordManual';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      'b5611000-0000-4000-8000-000000000091', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'cap-91-1', NULL, true);
    RAISE EXCEPTION 'manual allocated to a wallet-only order';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- A cash leg with capacity still advertises manual recording.
  SELECT public.manage_order_refund(
    'b5611000-0000-4000-8000-000000000092'
  ) INTO v_result;
  IF (v_result->>'canRecordManual')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'cash leg hid manual recovery, got %',
      v_result->>'canRecordManual';
  END IF;

  -- A spent cash leg beside an unreversed wallet leg: the cash
  -- capacity is gone and the wallet remainder is not allocatable.
  SELECT public.manage_order_refund(
    'b5611000-0000-4000-8000-000000000093'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 50 THEN
    RAISE EXCEPTION 'mixed remainder wrong, got %',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'canRecordManual')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'spent-leg remainder advertised manual, got %',
      v_result->>'canRecordManual';
  END IF;
END;
$refund_round56_gates$;

ROLLBACK;
