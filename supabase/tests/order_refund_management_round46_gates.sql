-- REGRESSION TEST: refunded-leg allocation and replay normalization.
--
-- Covers rescue records on refunded cash-like legs (allocator
-- admission with external/unknown-gateway exclusion) and
-- idempotent replays of legacy manual spellings.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round46_gates.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
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
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000061', v_merchant_id, 'REFUND-061',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000062', v_merchant_id, 'REFUND-062',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000063', v_merchant_id, 'REFUND-063',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000064', v_merchant_id, 'REFUND-064',
      200, 200, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000061', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000061', 'payment', 100, 'NGN',
      'refunded', 'cash', 'r46-61', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000062', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000062', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r46-62a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000063', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000062', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r46-62b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000071', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000063', 'payment', 100, 'NGN',
      'refunded', 'paystack', 'r46-63r', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000072', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000063', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r46-63c', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000073', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000064', 'payment', 100, 'NGN',
      'refunded', NULL, 'r46-64r', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000074', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000064', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r46-64c', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000066', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000062', 'refund', 30, 'NGN',
      'completed', 'Manual', 'legacy-old-1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000062',
        'method', 'bank_transfer', 'reference', 'legacy-1',
        'refunded_at', '2026-09-28T12:00:00Z')),
    ('9ef12000-0000-4000-8000-000000000067', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000062', 'refund', 20, 'NGN',
      'completed', 'manual', 'pad-old-1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000063',
        'method', 'bank_transfer', 'reference', 'pad-1 ',
        'refunded_at', '2026-09-28T12:00:00Z'));
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round46_gates$
DECLARE
  v_result jsonb;
BEGIN
  -- A refunded cash leg without its linked manual still takes the
  -- rescue record: the allocator admits refunded cash-like legs,
  -- so the proof the completion gates require can be supplied.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000061'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'refunded cash outstanding = %, want 100',
      v_result->>'remaining';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000061', 'manual', 100,
    '2026-09-28T12:00:00Z', 'cash', 'rescue-61', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 0
    OR pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'rescue record failed, remaining % history %',
      v_result->>'remaining', v_result->'history';
  END IF;
  -- A legacy 'Manual' spelling replays idempotently: the coverage
  -- helpers count the row, so the replay lookup must find it too
  -- instead of allocating a duplicate beside it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000062', 'manual', 30,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'legacy-1', 'teller 5', true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 150
    OR pg_catalog.jsonb_array_length(v_result->'history') <> 2 THEN
    RAISE EXCEPTION 'legacy-spelling replay duplicated, remaining % history %',
      v_result->>'remaining', v_result->'history';
  END IF;
  -- A padded legacy reference is the same transfer trimmed.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000062', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'pad-1', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 150
    OR pg_catalog.jsonb_array_length(v_result->'history') <> 2 THEN
    RAISE EXCEPTION 'padded-reference replay duplicated, remaining % history %',
      v_result->>'remaining', v_result->'history';
  END IF;
  -- A self-terminal refunded external leg stays out: provider money
  -- may already be home, so the manual skips it for the completed
  -- sibling even though FIFO reaches it first.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000063', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'external-63', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 0
    OR pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'mixed external manual failed, remaining % history %',
      v_result->>'remaining', v_result->'history';
  END IF;
  -- Unknown provenance fails closed too: a refunded leg with no
  -- gateway cannot prove drift over a provider terminalization.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000064', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'unknown-64', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 0
    OR pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'mixed unknown-gateway manual failed, remaining % history %',
      v_result->>'remaining', v_result->'history';
  END IF;
END;
$refund_round46_gates$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round46_claim$
DECLARE
  v_won boolean;
  v_status text;
  v_link text;
  v_note text;
  v_label text;
BEGIN
  -- The rescue row links the refunded leg and flips the label.
  SELECT metadata->>'payment_transaction_id' INTO v_link
    FROM public.transactions
   WHERE order_id = '9ef11000-0000-4000-8000-000000000061'
     AND transaction_type = 'refund';
  IF v_link <> '9ef12000-0000-4000-8000-000000000061' THEN
    RAISE EXCEPTION 'rescue row linked %, want leg 061', v_link;
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
   WHERE id = '9ef11000-0000-4000-8000-000000000061';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'rescue record left label %, want refunded', v_label;
  END IF;
  -- Mixed-order manuals skipped the refunded legs for the
  -- completed siblings.
  SELECT metadata->>'payment_transaction_id' INTO v_link
    FROM public.transactions
   WHERE order_id = '9ef11000-0000-4000-8000-000000000063'
     AND transaction_type = 'refund';
  IF v_link <> '9ef12000-0000-4000-8000-000000000072' THEN
    RAISE EXCEPTION 'external exclusion missed, linked %', v_link;
  END IF;
  SELECT metadata->>'payment_transaction_id' INTO v_link
    FROM public.transactions
   WHERE order_id = '9ef11000-0000-4000-8000-000000000064'
     AND transaction_type = 'refund';
  IF v_link <> '9ef12000-0000-4000-8000-000000000074' THEN
    RAISE EXCEPTION 'unknown-gateway exclusion missed, linked %', v_link;
  END IF;
  -- The replay note correction landed on the legacy spelling row.
  SELECT metadata->>'note' INTO v_note FROM public.transactions
   WHERE order_id = '9ef11000-0000-4000-8000-000000000062'
     AND transaction_type = 'refund'
     AND metadata->>'reference' = 'legacy-1';
  IF v_note <> 'teller 5' THEN
    RAISE EXCEPTION 'note correction missed the legacy row, got %', v_note;
  END IF;
  -- The rescue proof unblocks finalization: the claim completes.
  SELECT we_won, current_status INTO v_won, v_status
    FROM public.claim_order_cancellation_side_effect(
      '9ef11000-0000-4000-8000-000000000061', 'refund',
      '9ef13000-0000-4000-8000-000000000061');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'rescue proof did not finalize, got %', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000061'
      AND step = 'refund' AND status = 'completed') THEN
    RAISE EXCEPTION 'claim did not complete the rescue order';
  END IF;
END;
$refund_round46_claim$;
ROLLBACK;
