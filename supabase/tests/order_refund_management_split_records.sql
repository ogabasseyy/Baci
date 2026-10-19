-- REGRESSION TEST: multi-leg manual records.
--
-- Covers split allocations with unique ledger identifiers,
-- legacy refunded rows, and padded-reference trimming.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_split_records.sql

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
    ('9ef11000-0000-4000-8000-000000000002', v_merchant_id, 'REFUND-002',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000003', v_merchant_id, 'REFUND-003',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000002',
      '9ef11000-0000-4000-8000-000000000003');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000002', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000002', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-2a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000003', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000002', 'payment', 40, 'NGN',
      'completed', 'paystack', 'cap-2b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000004', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000003', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-3', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000005', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000003', 'refund', 30, 'NGN',
      'refunded', 'paystack', 'legacy-3',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000004',
        'provider_refund_status', 'processed'));

END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_split_records$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
  -- Replay identity includes the refund instant: the idempotent
  -- retry below must present the same instant, not two clock
  -- reads microseconds apart.
  v_refunded_at timestamptz := pg_catalog.now();
BEGIN
  -- One manual transfer spans both legs with unique ledger identifiers
  -- while the merchant reference stays queryable on every leg.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000002', 'manual', 100,
    v_refunded_at, 'bank_transfer', 'split-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 2 THEN
    RAISE EXCEPTION 'split manual did not span both legs';
  END IF;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'split manual did not clear remaining';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000002', 'manual', 100,
    v_refunded_at, 'bank_transfer', 'split-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 2 THEN
    RAISE EXCEPTION 'split manual replay duplicated rows';
  END IF;

  -- Legacy refunded rows count as returned without blocking manual use,
  -- and provider rows without a merchant timestamp serialize ISO dates.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000003'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 30 THEN
    RAISE EXCEPTION 'legacy refunded row not counted as returned';
  END IF;
  IF (v_result->>'pending')::numeric <> 0 THEN
    RAISE EXCEPTION 'legacy refunded row counted as pending';
  END IF;
  IF (v_result->>'remaining')::numeric <> 70 THEN
    RAISE EXCEPTION 'legacy refunded row did not reduce remaining';
  END IF;
  IF NOT (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual unavailable beside legacy rows';
  END IF;
  IF (v_result->'history'->0->>'date') !~ '^\d{4}-\d{2}-\d{2}T' THEN
    RAISE EXCEPTION 'provider history date is not ISO-8601: %',
      v_result->'history'->0->>'date';
  END IF;

  -- Overlong padded references validate and store trimmed.
  PERFORM public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000003', 'manual', 10,
    v_refunded_at, 'bank_transfer',
    '  ' || pg_catalog.repeat('p', 100) || '  ',NULL,true);

END;
$refund_split_records$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_split_asserts$
DECLARE
  v_split_refs integer;
  v_split_merchant_refs integer;
  v_padded_ok boolean;
  v_internal_ok boolean;
  v_o4_status text;
BEGIN
  -- Each split allocation row carries a unique ledger identifier while
  -- the merchant reference stays queryable on every leg.
  SELECT count(DISTINCT gateway_reference) INTO v_split_refs
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000002'
    AND transaction_type = 'refund';
  IF v_split_refs <> 2 THEN
    RAISE EXCEPTION 'split ledger identifiers are not unique';
  END IF;
  SELECT count(*) INTO v_split_merchant_refs
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000002'
    AND transaction_type = 'refund'
    AND metadata->>'reference' = 'split-1';
  IF v_split_merchant_refs <> 2 THEN
    RAISE EXCEPTION 'merchant reference missing from a split leg';
  END IF;

  -- The overlong padded reference stored trimmed in both columns.
  SELECT metadata->>'reference' = pg_catalog.repeat('p', 100)
    AND gateway_reference = pg_catalog.repeat('p', 100) || '#1'
    INTO v_padded_ok
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000003'
    AND transaction_type = 'refund' AND gateway = 'manual';
  IF v_padded_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'padded reference not stored trimmed';
  END IF;

END;
$refund_split_asserts$;
ROLLBACK;
