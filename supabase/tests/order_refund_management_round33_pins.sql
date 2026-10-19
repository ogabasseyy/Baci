-- REGRESSION TEST: explicit leg pins.
--
-- Covers missing/oversized pins, pinned attestations, spillover
-- allocation, and pin-linkage ledger assertions.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round33_pins.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_label text;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    ('9ef10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000001', 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    ('9ef10100-0000-4000-8000-000000000002', '9ef10000-0000-4000-8000-000000000005', 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000002', 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active'),
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000003', 'refund-viewer@example.test',
      'Refund Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active'),
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000004', 'refund-denied@example.test',
      'Refund Denied', 'accountant',
      '{"orders":{"view":false,"refund":false}}'::jsonb, 'active');


  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    ('9ef10200-0000-4000-8000-000000000001', '9ef10100-0000-4000-8000-000000000001', 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000043',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-043',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000044',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-044',
      200, 200, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000057',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000043', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-43a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000058',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000043', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-43b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000059',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000044', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-44a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000060',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000044', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-44b', '{}'::jsonb);

END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round33_pins$
DECLARE
  v_result jsonb;
  v_label text;
  v_attempts integer;
  -- Replay identity includes the refund instant: the pin-divergent
  -- retry below must present the same instant as the record call.
  v_pin_replay_at timestamptz := pg_catalog.now();
BEGIN
  -- A Paystack attestation without a leg pin routes to review when
  -- several external legs still need money: FIFO would link the
  -- wrong capture and verification would quarantine a valid refund.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
      pg_catalog.now(), 'paystack', 'ambiguous-43', NULL, true);
    RAISE EXCEPTION 'ambiguous paystack record was FIFO-linked';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;
  -- The status response names the pin candidates: both captures
  -- with their outstanding amounts, oldest first.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000043'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'legs') <> 2
    OR v_result->'legs'->0->>'id' <> '9ef12000-0000-4000-8000-000000000057'
    OR (v_result->'legs'->0->>'outstanding')::numeric <> 100
    OR v_result->'legs'->1->>'id' <> '9ef12000-0000-4000-8000-000000000058'
    OR (v_result->'legs'->1->>'outstanding')::numeric <> 100 THEN
    RAISE EXCEPTION 'pin candidates mislisted: %', v_result->'legs';
  END IF;
  -- A pin to a missing leg is rejected as invalid input.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
      pg_catalog.now(), 'bank_transfer', 'bad-pin-43', NULL, true,
      p_payment_transaction_id => 'ffffffff-0000-4000-8000-000000000000');
    RAISE EXCEPTION 'dangling leg pin was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid_manual_refund' THEN RAISE; END IF;
  END;
  -- A paystack attestation larger than its pinned leg is rejected:
  -- attestations never spill across captures.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 150,
      pg_catalog.now(), 'paystack', 'over-pin-43', NULL, true,
      p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000057');
    RAISE EXCEPTION 'oversized pinned attestation was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;
  -- A pinned Paystack attestation lands on its leg as in-flight
  -- money: the claim pends provider verification, so the balance
  -- stays open while pending carries it (link asserted below).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
    pg_catalog.now(), 'paystack', 'pin-2', NULL, true,
    p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000058'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 200 THEN
    RAISE EXCEPTION 'pinned attestation left pending % remaining %',
      v_result->>'pending', v_result->>'remaining';
  END IF;
  -- The covered leg drops out of the pin candidates.
  IF pg_catalog.jsonb_array_length(v_result->'legs') <> 1
    OR v_result->'legs'->0->>'id' <> '9ef12000-0000-4000-8000-000000000057' THEN
    RAISE EXCEPTION 'covered leg still listed: %', v_result->'legs';
  END IF;
  -- The unverified attestation pends further records until the
  -- provider confirms it: the processing guard layers over the pin.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
      pg_catalog.now(), 'paystack', 'pin-1', NULL, true,
      p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000057');
    RAISE EXCEPTION 'second pin slipped past pending evidence';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- A non-paystack pin allocates pinned-first, then spills FIFO.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000044', 'manual', 150,
    pg_catalog.now(), 'bank_transfer', 'spill-1', NULL, true,
    p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000060'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 50 THEN
    RAISE EXCEPTION 'spillover record left remaining %', v_result->>'remaining';
  END IF;
  -- Replay ignores the leg pin: the same reference re-presented
  -- pinned to a different leg resucceeds idempotently (no new rows,
  -- no conflict) instead of moving the transfer.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000044', 'manual', 50,
    v_pin_replay_at, 'bank_transfer', 'replay-pin-1', NULL, true,
    p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000059'
  ) INTO v_result;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000044', 'manual', 50,
    v_pin_replay_at, 'bank_transfer', 'replay-pin-1', NULL, true,
    p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000060'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'pin-divergent replay left remaining %', v_result->>'remaining';
  END IF;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 3 THEN
    RAISE EXCEPTION 'pin-divergent replay duplicated rows';
  END IF;
END;
$refund_round33_pins$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round36_pins$
DECLARE
  v_link text;
  v_count integer;
BEGIN
  -- The pinned row links its named leg.
  SELECT metadata->>'payment_transaction_id' INTO v_link
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000043'
  AND gateway_reference = 'pin-2#1';
  IF v_link <> '9ef12000-0000-4000-8000-000000000058' THEN
    RAISE EXCEPTION 'pin-2 linked %, want leg 058', v_link;
  END IF;
  -- The spillover split pinned-first: 100 to leg 060, 50 to leg 059.
  SELECT COUNT(*) INTO v_count FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000044'
  AND gateway_reference = 'spill-1#1'
  AND metadata->>'payment_transaction_id' = '9ef12000-0000-4000-8000-000000000060'
  AND amount = 100;
  IF v_count <> 1 THEN RAISE EXCEPTION 'spillover first slice mislinked'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000044'
  AND gateway_reference = 'spill-1#2'
  AND metadata->>'payment_transaction_id' = '9ef12000-0000-4000-8000-000000000059'
  AND amount = 50;
  IF v_count <> 1 THEN RAISE EXCEPTION 'spillover second slice mislinked'; END IF;
  -- The pin-divergent retry recorded nothing new and moved nothing:
  -- one row, still on the originally pinned leg.
  SELECT COUNT(*) INTO v_count FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000044'
  AND metadata->>'reference' = 'replay-pin-1'
  AND metadata->>'payment_transaction_id' = '9ef12000-0000-4000-8000-000000000059';
  IF v_count <> 1 THEN RAISE EXCEPTION 'pin-divergent replay moved rows'; END IF;
END;
$refund_round36_pins$;
ROLLBACK;
