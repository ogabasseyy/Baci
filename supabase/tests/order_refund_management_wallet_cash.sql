-- REGRESSION TEST: wallet and cash-like manual allocation.
--
-- Covers reversed-leg skipping, wallet-only routing, currency
-- casing, and cash-only record-and-finalize.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_wallet_cash.sql

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

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id);

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id,
      'adjustment', 40, 80, 'order_reversal',
      '9ef11000-0000-4000-8000-000000000006');
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000006', v_merchant_id, 'REFUND-006',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000007', v_merchant_id, 'REFUND-007',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000010', v_merchant_id, 'REFUND-010',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000011', v_merchant_id, 'REFUND-011',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000019', v_merchant_id, 'REFUND-019',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000006',
      '9ef11000-0000-4000-8000-000000000007',
      '9ef11000-0000-4000-8000-000000000010',
      '9ef11000-0000-4000-8000-000000000011',
      '9ef11000-0000-4000-8000-000000000019');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000009', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000006', 'payment', 40, 'NGN',
      'completed', 'wallet', 'w-6', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000010', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000006', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-6', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000011', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000007', 'payment', 100, 'NGN',
      'completed', 'wallet', 'w-7', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000014', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000010', 'payment', 100, 'ngn',
      'completed', 'paystack', 'cap-10', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000015', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000011', 'payment', 100, 'USD',
      'completed', 'paystack', 'cap-11', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000028', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000019', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-19', '{}'::jsonb);

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

DO $refund_wallet_cash$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
BEGIN
  -- Manual money skips already-reversed wallet legs: only the Paystack
  -- leg is allocatable, so one row covers the outstanding 60.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000006'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 60 THEN
    RAISE EXCEPTION 'split-internal remaining wrong, got %',
      v_result->>'remaining';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000006', 'manual', 61,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'internal-over',NULL,true);
    RAISE EXCEPTION 'manual exceeded split-internal remaining';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000006', 'manual', 60,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'internal-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'manual allocated to the reversed wallet leg';
  END IF;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'split-internal manual did not requeue, got %',
      v_result->>'status';
  END IF;

  -- A wallet-only order has no allocatable leg: the wallet path owns
  -- the reversal, so manual recording surfaces for review.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000007', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'wallet-only-1',NULL,true);
    RAISE EXCEPTION 'manual allocated to a wallet-only order';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- Legacy currency casing passes; genuinely foreign legs block.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000010', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'lower-1',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'lowercase currency manual did not requeue, got %',
      v_result->>'status';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000011', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'usd-1',NULL,true);
    RAISE EXCEPTION 'manual accepted on foreign-currency leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_currency_requires_review' THEN RAISE; END IF;
  END;

  -- A cash-only cancellation records and finalizes with no external
  -- leg: the full manual creates the claimable row the claim guard
  -- admits on manual coverage alone.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000019'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'cash leg missing from remaining, got %',
      v_result->>'remaining';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000019', 'manual', 100,
    '2026-09-28T12:00:00Z', 'cash', 'cashonly-1',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'cash-only manual did not requeue, got %',
      v_result->>'status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000019'
      AND step = 'refund' AND status = 'failed' AND attempts = 0
  ) THEN
    RAISE EXCEPTION 'cash-only manual did not create a claimable row';
  END IF;

END;
$refund_wallet_cash$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_wallet_asserts$
DECLARE
  v_split_refs integer;
  v_split_merchant_refs integer;
  v_padded_ok boolean;
  v_internal_ok boolean;
  v_o4_status text;
BEGIN
  -- The split-internal manual row links the Paystack leg only.
  SELECT metadata->>'payment_transaction_id'
      = '9ef12000-0000-4000-8000-000000000010'
    INTO v_internal_ok
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000006'
    AND transaction_type = 'refund' AND gateway = 'manual';
  IF v_internal_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'split-internal manual misallocated';
  END IF;
END;
$refund_wallet_asserts$;
ROLLBACK;
