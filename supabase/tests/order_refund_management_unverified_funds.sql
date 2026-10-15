-- REGRESSION TEST: unverified and overfunded money.
--
-- Covers foreign-currency exclusion, unverified Paystack rows,
-- mixed cash balances, error masking, and overfunded guards.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_unverified_funds.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_viewer_id uuid := '9ef10000-0000-4000-8000-000000000003';
  v_denied_id uuid := '9ef10000-0000-4000-8000-000000000004';
  v_m2_owner_id uuid := '9ef10000-0000-4000-8000-000000000005';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_m2_id uuid := '9ef10100-0000-4000-8000-000000000002';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
  v_product_id uuid := '9ef10300-0000-4000-8000-000000000001';
  v_goal_id uuid := '9ef10400-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_viewer_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_denied_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_m2_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    (v_m2_id, v_m2_owner_id, 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active'),
    (v_merchant_id, v_viewer_id, 'refund-viewer@example.test',
      'Refund Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active'),
    (v_merchant_id, v_denied_id, 'refund-denied@example.test',
      'Refund Denied', 'accountant',
      '{"orders":{"view":false,"refund":false}}'::jsonb, 'active');


  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000015', v_merchant_id, 'REFUND-015',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000018', v_merchant_id, 'REFUND-018',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'REFUND-020',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000021', v_merchant_id, 'REFUND-021',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000015',
      '9ef11000-0000-4000-8000-000000000018',
      '9ef11000-0000-4000-8000-000000000020',
      '9ef11000-0000-4000-8000-000000000021');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000019', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000015', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-15', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000020', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000015', 'refund', 30, 'USD',
      'completed', 'paystack', 'fx-15',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000019')),
    ('9ef12000-0000-4000-8000-000000000026', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000018', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-18', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000027', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000018', 'refund', 100, 'NGN',
      'completed', 'paystack', 'legacy-18',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000026')),
    ('9ef12000-0000-4000-8000-000000000029', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-20', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000030', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'refund', 60, 'NGN',
      'completed', 'paystack', 'pp-20',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000029',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000031', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 40, 'NGN',
      'completed', 'cash', 'cash-20', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000032', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000021', 'payment', 120, 'NGN',
      'completed', 'paystack', 'cap-21', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000020', 0,
      'Insufficient balance');

  GRANT SELECT ON public.orders TO authenticated;
  GRANT SELECT ON public.order_cancellation_side_effects TO authenticated;
  CREATE POLICY refund_suite_probe_side_effects
    ON public.order_cancellation_side_effects FOR SELECT TO authenticated
    USING (true);
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_unverified_funds$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
BEGIN
  -- Foreign-currency refund rows stay visible but out of coverage,
  -- and block recording until reconciliation: the manager cannot
  -- convert money, so an unexplained linked row leaves the full
  -- balance owed but not recordable (recording beside it would
  -- double-record if the row turns out to be matching money).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000015'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0 THEN
    RAISE EXCEPTION 'foreign-currency row counted as returned';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign-currency row reduced remaining';
  END IF;
  IF (v_result->>'pending')::numeric <> 30 THEN
    RAISE EXCEPTION 'foreign-currency row not held pending, got %',
      v_result->>'pending';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual recordable beside unreconciled foreign money';
  END IF;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'foreign-currency row hidden from history';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000015', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'fx-cover',NULL,true
    );
    RAISE EXCEPTION 'manual accepted beside unreconciled foreign money';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- An unverified Paystack row is in-flight, not returned: it must
  -- not reduce the remainder (the claim still sees the leg
  -- uncovered), must keep the payment label paid, and must block
  -- manual recording instead of leaving room for a double-record.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000018'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'unverified row miscounted, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'unverified row did not hold processing status';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual recordable beside unverified provider money';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000018';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'unverified row flipped payment label to %', v_label;
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000018', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'unverified-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside unverified provider money';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- A mixed cancellation keeps its outstanding cash balance: the
  -- verified provider money counts, the cash leg stays allocatable,
  -- and the claim below must wait for the merchant, not finalize.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000020'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 60
    OR (v_result->>'remaining')::numeric <> 40 THEN
    RAISE EXCEPTION 'mixed cash balance wrong, got %/%',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  -- The status response masks the failed step's raw worker error
  -- (direct REST callers bypass the route) and derives no Paystack
  -- signal from a provider-less message.
  IF v_result->>'error'
    <> 'The refund ran into a problem. Support has the details.' THEN
    RAISE EXCEPTION 'status response leaked raw worker text: %',
      v_result->>'error';
  END IF;
  IF (v_result->>'needsPaystackCheck')::boolean THEN
    RAISE EXCEPTION 'paystack signal derived from a provider-less error';
  END IF;

  -- An overfunded ledger routes manuals to review: the leg exceeds
  -- the recorded balance, so the remainder could never cover it and
  -- recording would strand finalization with a zero balance.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000021'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'overfunded remaining wrong, got %',
      v_result->>'remaining';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000021', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'overfunded-1',NULL,true);
    RAISE EXCEPTION 'manual accepted on an overfunded ledger';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

END;
$refund_unverified_funds$;
ROLLBACK;
