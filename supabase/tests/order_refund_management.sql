-- REGRESSION TEST: merchant cancellation-refund management RPC.
--
-- Covers public.manage_order_refund (status/retry/manual), the refund
-- audit/sync triggers, and the authenticated refund-insert boundary.
-- Runs against the migrated replay database: fixtures use real tables
-- and roll back with the check.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management.sql

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

  INSERT INTO public.products (id, merchant_id, name, price, status) VALUES
    (v_product_id, v_merchant_id, 'Refund Fixture Product', 100, 'active');

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id, v_product_id,
    'Refund Fixture Goal', 100, 10, 'weekly', '2026-01-01', '2026-12-31',
    'manual', pg_catalog.now(), pg_catalog.now()
  );

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'REFUND-001',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000002', v_merchant_id, 'REFUND-002',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000003', v_merchant_id, 'REFUND-003',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000004', v_merchant_id, 'REFUND-004',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000005', v_merchant_id, 'REFUND-005',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000006', v_merchant_id, 'REFUND-006',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000007', v_merchant_id, 'REFUND-007',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000008', v_merchant_id, 'REFUND-008',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000009', v_m2_id, 'REFUND-009',
      10, 10, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000010', v_merchant_id, 'REFUND-010',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000011', v_merchant_id, 'REFUND-011',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000012', v_merchant_id, 'REFUND-012',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000013', v_merchant_id, 'REFUND-013',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000014', v_merchant_id, 'REFUND-014',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000015', v_merchant_id, 'REFUND-015',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000016', v_merchant_id, 'REFUND-016',
      100, 100, 'paid', 'cancelled');

  -- Cancelled orders carry their cancellation timestamp; REFUND-012 is
  -- the legacy exception proving the manual gate requires it.
  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id <> '9ef11000-0000-4000-8000-000000000012'
    AND id IN (
      '9ef11000-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000002',
      '9ef11000-0000-4000-8000-000000000003',
      '9ef11000-0000-4000-8000-000000000004',
      '9ef11000-0000-4000-8000-000000000005',
      '9ef11000-0000-4000-8000-000000000006',
      '9ef11000-0000-4000-8000-000000000007',
      '9ef11000-0000-4000-8000-000000000008',
      '9ef11000-0000-4000-8000-000000000009',
      '9ef11000-0000-4000-8000-000000000010',
      '9ef11000-0000-4000-8000-000000000011',
      '9ef11000-0000-4000-8000-000000000013',
      '9ef11000-0000-4000-8000-000000000014',
      '9ef11000-0000-4000-8000-000000000015',
      '9ef11000-0000-4000-8000-000000000016');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-1', '{}'::jsonb),
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
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000004')),
    ('9ef12000-0000-4000-8000-000000000006', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000004', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-4', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000007', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000005', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-5', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000008', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000005', 'refund', 10, 'NGN',
      'completed', 'paystack', '777005', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000009', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000006', 'payment', 40, 'NGN',
      'completed', 'wallet', 'w-6', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000010', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000006', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-6', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000011', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000007', 'payment', 100, 'NGN',
      'completed', 'wallet', 'w-7', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000012', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000008', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-8', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000013', v_m2_id,
      '9ef11000-0000-4000-8000-000000000009', 'payment', 10, 'NGN',
      'completed', 'paystack', 'cap-9', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000014', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000010', 'payment', 100, 'ngn',
      'completed', 'paystack', 'cap-10', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000015', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000011', 'payment', 100, 'USD',
      'completed', 'paystack', 'cap-11', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000016', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000012', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-12', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000017', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000013', 'payment', 100, 'NGN',
      'refunded', 'paypal', 'pp-13', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000018', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000014', 'payment', 100, 'NGN',
      'refund_pending', 'paypal', 'pp-14', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000019', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000015', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-15', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000020', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000015', 'refund', 30, 'USD',
      'completed', 'paystack', 'fx-15',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000019')),
    ('9ef12000-0000-4000-8000-000000000021', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000016', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-16', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000022', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000016', 'refund', 100, 'NGN',
      'refunded', 'paystack', 'legacy-16',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000021',
        'provider_refund_status', 'processed'));

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000001', 5,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000008', v_merchant_id, 'refund',
      'claimed', '9ef13000-0000-4000-8000-000000000008', 1, NULL);

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id);

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id,
      'adjustment', 40, 40, 'order_reversal',
      '9ef11000-0000-4000-8000-000000000004'),
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id,
      'adjustment', 40, 80, 'order_reversal',
      '9ef11000-0000-4000-8000-000000000006');

  UPDATE public.orders SET customer_id = v_customer_id
  WHERE id = '9ef11000-0000-4000-8000-000000000004';

  INSERT INTO public.order_items (order_id, product_id, name, price, quantity)
  VALUES ('9ef11000-0000-4000-8000-000000000004', v_product_id,
    'Refund Fixture Product', 100, 1);

  INSERT INTO public.customer_savings_redemptions (
    goal_id, merchant_id, customer_id, order_id, amount, idempotency_key,
    metadata
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id,
    '9ef11000-0000-4000-8000-000000000004', 10, 'refund-fixture-004',
    '{"reversed_at":"2026-10-01T00:00:00Z"}'::jsonb
  );

  -- A long-pending refund accumulates audit events; the status response
  -- must bound them instead of growing every poll.
  INSERT INTO public.order_refund_events (order_id, merchant_id, action, created_at)
  SELECT '9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'seed',
    pg_catalog.now() - (s || ' minutes')::interval
  FROM pg_catalog.generate_series(1, 60) AS s;

  -- The insert-boundary assertions below run as authenticated, so the
  -- table grants exist in-transaction (rolled back with the check): any
  -- rejection then comes from the WITH CHECK policy, not a missing grant.
  GRANT INSERT ON public.transactions TO authenticated;
  GRANT SELECT ON public.orders TO authenticated;
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_manager$
DECLARE
  v_result jsonb;
  v_rejected boolean;
BEGIN
  -- Failed refunds are retryable, and a retry requeues exhausted work.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF NOT (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'failed refund is not retryable';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'expected remaining 100, got %', v_result->>'remaining';
  END IF;
  IF NOT (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'refund manager cannot manage refunds';
  END IF;

  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 101,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'excess-1',NULL,true);
    RAISE EXCEPTION 'excess refund accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;

  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'retry'
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'retry did not requeue, got %', v_result->>'status';
  END IF;
  IF (v_result->>'retryRequests')::integer <> 1 THEN
    RAISE EXCEPTION 'retry request was not counted';
  END IF;

  -- Partial manual coverage disables retry: the worker's gateway
  -- matcher would quarantine the step and strand the balance.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 80 THEN
    RAISE EXCEPTION 'partial refund did not reduce remaining';
  END IF;
  IF (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'retry still advertised after partial manual refund';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'retry');
    RAISE EXCEPTION 'retry accepted after partial manual refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_completion_required' THEN RAISE; END IF;
  END;

  -- Replaying the identical manual record is idempotent, while a
  -- conflicting reuse of the reference is rejected.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'manual replay duplicated the ledger row';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 25,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true);
    RAISE EXCEPTION 'conflicting reference reuse accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_reference_conflict' THEN RAISE; END IF;
  END;

  -- Recording attests money already moved: direct RPC callers must
  -- attest too, and the ledger row keeps the proof.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'unconfirmed-1', NULL, false);
    RAISE EXCEPTION 'unattested manual refund accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'refund_confirmation_required' THEN RAISE; END IF;
  END;
  PERFORM public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'attested-1', NULL, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND gateway_reference = 'attested-1#1'
      AND metadata->>'confirmed' = 'true'
  ) THEN
    RAISE EXCEPTION 'merchant attestation not persisted on manual row';
  END IF;

  -- Claimed refunds block manual writes and management.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000008'
  ) INTO v_result;
  IF (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'claimed refund still manageable';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000008', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'claimed-1',NULL,true);
    RAISE EXCEPTION 'manual write accepted during claimed refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- Other merchants' orders are invisible to the manager.
  v_rejected := false;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000009');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'cross-merchant refund read accepted';
  END IF;

  -- One manual transfer spans both legs with unique ledger identifiers
  -- while the merchant reference stays queryable on every leg.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000002', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'split-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 2 THEN
    RAISE EXCEPTION 'split manual did not span both legs';
  END IF;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'split manual did not clear remaining';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000002', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'split-1',NULL,true
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
    '2026-09-28T12:00:00Z', 'bank_transfer',
    '  ' || pg_catalog.repeat('p', 100) || '  ',NULL,true);

  -- Wallet and savings reversals reduce the outstanding balance, and a
  -- reversal-adjusted manual completes the order.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000004'
  ) INTO v_result;
  IF (v_result->>'reversedInternal')::numeric <> 50 THEN
    RAISE EXCEPTION 'internal reversals not accounted';
  END IF;
  IF (v_result->>'remaining')::numeric <> 50 THEN
    RAISE EXCEPTION 'reversed money still outstanding';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000004', 'manual', 51,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'over-after-reversal',NULL,true);
    RAISE EXCEPTION 'manual exceeded reversal-adjusted remaining';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000004', 'manual', 50,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'reversal-adjusted',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'reversal-adjusted manual did not complete the order';
  END IF;

  -- Unlinked completed refunds block manual allocation for review.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000005', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'unlinked-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside unallocated refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'unallocated_refund_requires_review' THEN RAISE; END IF;
  END;

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
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'split-internal manual did not complete the order';
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
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'lowercase currency leg was not refundable';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000011', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'usd-1',NULL,true);
    RAISE EXCEPTION 'manual accepted on foreign-currency leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_currency_requires_review' THEN RAISE; END IF;
  END;

  -- Legacy rows without a cancellation timestamp route to review: the
  -- trusted finalization cannot run without one.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000012', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'legacy-1',NULL,true);
    RAISE EXCEPTION 'manual accepted without cancellation timestamp';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- Self-terminal payment legs count toward their side: a refunded
  -- PayPal leg is returned money, an in-flight one blocks recording.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000013'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 100 THEN
    RAISE EXCEPTION 'refunded payment leg not counted as returned';
  END IF;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'refunded payment leg still outstanding';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual offered on a self-terminally refunded order';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000014'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'in-flight payment leg not counted as pending';
  END IF;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'in-flight payment leg not processing';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual offered beside an in-flight payment leg';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000014', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'inflight-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside an in-flight payment leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- Foreign-currency refund rows stay visible but out of coverage: the
  -- full matching-money balance remains recordable.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000015'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0 THEN
    RAISE EXCEPTION 'foreign-currency row counted as returned';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign-currency row reduced remaining';
  END IF;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'foreign-currency row hidden from history';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000015', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'fx-cover',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'matching-money manual blocked by foreign row';
  END IF;

  -- Missing and foreign orders are indistinguishable to callers.
  v_rejected := false;
  BEGIN
    PERFORM public.manage_order_refund('9ef1ffff-0000-4000-8000-000000000099');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'missing order distinguishable from forbidden';
  END IF;

  -- Audit history stays bounded no matter how long a refund pends.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'events') <> 50 THEN
    RAISE EXCEPTION 'refund events unbounded, got %',
      pg_catalog.jsonb_array_length(v_result->'events');
  END IF;
END;
$refund_manager$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000003',
  true
);

DO $refund_viewer$
DECLARE
  v_result jsonb;
  v_rejected boolean;
BEGIN
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF v_result->>'status' IS NULL THEN
    RAISE EXCEPTION 'view-authorized staff cannot read refund status';
  END IF;
  IF (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'staff without refund permission is flagged manageable';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'staff-1',NULL,true);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'view-authorized staff recorded a manual refund';
  END IF;
END;
$refund_viewer$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000004',
  true
);

DO $refund_denied$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'denied staff read refund status';
  END IF;
END;
$refund_denied$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000001',
  true
);

DO $refund_owner$
DECLARE
  v_result jsonb;
  v_event_count integer;
BEGIN
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF NOT (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'owner cannot manage refunds';
  END IF;

  -- Owners read the audit trail but cannot forge entries.
  SELECT count(*) INTO v_event_count FROM public.order_refund_events;
  IF v_event_count = 0 THEN
    RAISE EXCEPTION 'owner sees no refund audit events';
  END IF;
  BEGIN
    INSERT INTO public.order_refund_events (order_id, merchant_id, action)
    VALUES ('9ef11000-0000-4000-8000-000000000001',
      '9ef10100-0000-4000-8000-000000000001', 'forged');
    RAISE EXCEPTION 'direct audit write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Refund rows enter the ledger only through the RPC: authenticated
  -- direct inserts are rejected while linked payments still pass.
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000001', 'refund', 10, 'NGN',
      'completed', 'manual');
    RAISE EXCEPTION 'authenticated refund insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference
  ) VALUES ('9ef10100-0000-4000-8000-000000000001',
    '9ef11000-0000-4000-8000-000000000001', 'payment', 10, 'NGN',
    'completed', 'paystack', 'policy-pay-1');
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000009', 'payment', 10, 'NGN',
      'completed', 'paystack');
    RAISE EXCEPTION 'cross-merchant order linkage allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$refund_owner$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_claim_finalize$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  -- A fully manual refund routes through the trusted aggregate
  -- finalization: the next claim sees manual-row coverage and runs
  -- settlement reversal, notifications, and review close.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000002', 'refund',
    '9ef13000-0000-4000-8000-000000000002');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'full manual coverage did not finalize, got %', v_status;
  END IF;
  -- A partial manual refund leaves the legs uncovered for the worker.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000001', 'refund',
    '9ef13000-0000-4000-8000-000000000001');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'partial manual coverage finalized early, got %', v_status;
  END IF;
  -- A legacy refunded row is terminal evidence like a completed one:
  -- full coverage finalizes instead of running the worker.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000016', 'refund',
    '9ef13000-0000-4000-8000-000000000016');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'refunded-row coverage did not finalize, got %', v_status;
  END IF;
END;
$refund_claim_finalize$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000005',
  true
);

DO $refund_m2_isolation$
DECLARE
  v_event_count integer;
BEGIN
  SELECT count(*) INTO v_event_count FROM public.order_refund_events;
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'refund audit RLS leaks across merchants';
  END IF;
END;
$refund_m2_isolation$;

RESET ROLE;

DO $refund_ledger_asserts$
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

  SELECT payment_status INTO v_o4_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000004';
  IF v_o4_status <> 'refunded' THEN
    RAISE EXCEPTION 'reversal-adjusted completion did not flip payment status';
  END IF;

  -- The aggregate claim completed the fully manual order; the
  -- self-terminal PayPal leg flipped its label on landing.
  IF NOT EXISTS (SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000002'
      AND step = 'refund' AND status = 'completed') THEN
    RAISE EXCEPTION 'claim did not complete the fully manual order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'finalization skipped notifications';
  END IF;
  SELECT payment_status INTO v_o4_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000013';
  IF v_o4_status <> 'refunded' THEN
    RAISE EXCEPTION 'self-terminal payment leg did not flip payment status';
  END IF;

  -- Order-less ledger refunds (e.g. savings exits) still commit: the
  -- sync trigger skips them instead of violating the audit NOT NULL.
  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference
  ) VALUES ('9ef10100-0000-4000-8000-000000000001', NULL, 'refund', 10,
    'NGN', 'completed', 'piggyvest', 'null-order-probe');
  IF EXISTS (SELECT 1 FROM public.order_refund_events
    WHERE details->>'reference' = 'null-order-probe') THEN
    RAISE EXCEPTION 'order-less refund wrote an audit event';
  END IF;

  -- Anonymous callers and direct private access stay denied.
  IF pg_catalog.has_function_privilege('anon',
    'public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'anonymous callers can execute the refund RPC';
  END IF;
  IF pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'private schema boundary open to authenticated';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated',
    'private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'direct private refund RPC allowed';
  END IF;
END;
$refund_ledger_asserts$;

ROLLBACK;
