-- REGRESSION TEST: cross-gateway refund attribution.
--
-- Covers unlinked-row pending, sole-leg gateway matching,
-- live-remainder guards, and Paystack-declared manuals.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_gateway_attribution.sql

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
    ('9ef11000-0000-4000-8000-000000000023', v_merchant_id, 'REFUND-023',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000024', v_merchant_id, 'REFUND-024',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000025', v_merchant_id, 'REFUND-025',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000026', v_merchant_id, 'REFUND-026',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000027', v_merchant_id, 'REFUND-027',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000023',
      '9ef11000-0000-4000-8000-000000000024',
      '9ef11000-0000-4000-8000-000000000025',
      '9ef11000-0000-4000-8000-000000000026',
      '9ef11000-0000-4000-8000-000000000027');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000036', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000023', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-23', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000037', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000023', 'refund', 100, 'NGN',
      'completed', 'korapay', 'unlinked-23', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000038', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000024', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-24', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000039', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000024', 'refund', 100, 'NGN',
      'completed', 'manual', 'man-24', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000040', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000025', 'payment', 110, 'NGN',
      'completed', 'paystack', 'cap-25', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000041', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000025', 'refund', 20, 'NGN',
      'completed', 'paystack', 'pp-25',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000040',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000042', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000026', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-26', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000043', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000026', 'refund', 100, 'NGN',
      'completed', 'korapay', 'kora-26',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000042')),
    ('9ef12000-0000-4000-8000-000000000044', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000027', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-27', '{}'::jsonb);

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

DO $refund_gateway_attribution$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
BEGIN
  -- Sole-leg attribution still requires the claim's gateway match:
  -- a foreign-gateway row and an unlinked manual row both wait in
  -- pending without flipping the label.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000023'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign-gateway row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000023';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'foreign-gateway row flipped payment label to %', v_label;
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000024'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'unlinked manual row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;

  -- The overfunded guard compares against the live remainder: partial
  -- coverage of 20 leaves 80 recordable against 90 outstanding, so
  -- recording would strand finalization with a zero balance.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000025', 'manual', 80,
      pg_catalog.now(), 'bank_transfer', 'overfunded-partial',NULL,true);
    RAISE EXCEPTION 'manual accepted on a partially covered overfunded leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- A linked row from another gateway is not coverage: the claim
  -- rejects the mismatch, so it waits in pending with the label
  -- held and manual recording blocked until review.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000026'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'cross-gateway row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual allowed beside cross-gateway evidence';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000026';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'cross-gateway row flipped payment label to %', v_label;
  END IF;
  -- Per-leg coverage assertions (028+) live in
  -- order_refund_management_per_leg_coverage.sql.

  -- A full manual declared as a direct Paystack refund records but
  -- stays in-flight without provider confirmation: the response is
  -- processing (pending, recording blocked) and the order label
  -- stays paid — never refunded while the claim still sees the
  -- leg uncovered. The claim test below asserts it defers to the
  -- worker instead.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000027', 'manual', 100,
    pg_catalog.now(), 'paystack', 'direct-paystack-1', NULL, true
  ) INTO v_result;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'unverified paystack manual not processing, got %',
      v_result->>'status';
  END IF;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'unverified paystack manual pending = %, want 100',
      v_result->>'pending';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'unverified paystack manual remaining = %, want 100',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'unverified paystack manual allows double-record';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000027';
  IF v_label = 'refunded' THEN
    RAISE EXCEPTION 'unverified paystack manual flipped the order label';
  END IF;

END;
$refund_gateway_attribution$;
ROLLBACK;
