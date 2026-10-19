-- REGRESSION TEST: merchant-owner refund capabilities.
--
-- Covers owner self-service reads and the authenticated
-- ledger-insert boundary (privilege grants plus RLS). Status
-- reads are view-level for any order of the caller's merchant —
-- the refund ledger is staff-visible like the order page, and
-- only mutations are cancelled-only.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_owner.sql

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
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'REFUND-001',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000009', v_m2_id, 'REFUND-009',
      10, 10, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000009');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-1', '{}'::jsonb);

  -- A live (non-cancelled) order carrying a completed provider
  -- refund: view staff read its refund ledger through status,
  -- exactly like the order page shows its transactions.
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000010', v_merchant_id, 'REFUND-010',
      50, 50, 'paid', 'processing');
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000010', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000010', 'payment', 50, 'NGN',
      'completed', 'paystack', 'cap-10', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000011', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000010', 'refund', 50, 'NGN',
      'completed', 'paystack', 'live-ref-1',
      pg_catalog.jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000010',
        'provider_refund_status', 'processed'));

  INSERT INTO public.order_refund_events
    (order_id, merchant_id, action, created_at)
  VALUES ('9ef11000-0000-4000-8000-000000000001',
    '9ef10100-0000-4000-8000-000000000001', 'seed', pg_catalog.now());
  -- The insert-boundary assertions below run as authenticated, so the
  -- table grants exist in-transaction (rolled back with the check): any
  -- rejection then comes from the WITH CHECK policy, not a missing grant.
  GRANT INSERT ON public.transactions TO authenticated;
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
  -- Refund-state payment rows are trusted-provider territory: forged
  -- legs would poison the pending aggregate or the sync trigger.
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway, gateway_reference
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000001', 'payment', 10, 'NGN',
      'refunded', 'paystack', 'policy-forge-1');
    RAISE EXCEPTION 'forged refunded payment insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway, gateway_reference
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000001', 'payment', 10, 'NGN',
      'refund_pending', 'paystack', 'policy-forge-2');
    RAISE EXCEPTION 'forged refund-pending payment insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
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

-- View-only staff read the refund ledger of a live order of their
-- own merchant through status (mutations stay cancelled-only);
-- staff without orders.view get the forbidden gate instead.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000003',
  true
);
DO $refund_live_status$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000010'
  ) INTO v_result;
  IF v_result->>'status' IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'live-order status read got %', v_result->>'status';
  END IF;
  IF jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'live-order status hid the refund ledger';
  END IF;
  IF (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'view staff can manage refunds';
  END IF;
END;
$refund_live_status$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000004',
  true
);
DO $refund_live_denied$
BEGIN
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000010'
    );
    RAISE EXCEPTION 'denied staff read the live refund ledger';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'refund_forbidden' THEN RAISE; END IF;
  END;
END;
$refund_live_denied$;

ROLLBACK;
