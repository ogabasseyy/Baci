-- REGRESSION TEST: repeated Paystack payable refreshes retain the historical
-- alias snapshots and update only the currently active alias.
--
-- USAGE:
--   supabase test db supabase/tests/paystack_order_dva_balance_refresh_history.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '3d7a1001-0000-4000-8000-000000000001';
  v_viewer_id uuid := '3d7a1001-0000-4000-8000-000000000002';
  v_merchant_id uuid := '3d7a1100-0000-4000-8000-000000000001';
  v_order_id uuid := '3d7a1200-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dva-history-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb),
    (v_viewer_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dva-history-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (
    v_merchant_id, v_owner_id, 'dva-history-owner@example.test',
    'DVA History Fixture', 'dva-history-fixture'
  );

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES (
    v_merchant_id, v_viewer_id, 'dva-history-viewer@example.test',
    'DVA History Viewer', 'accountant',
    '{"orders":{"view":true,"edit":false}}'::jsonb, 'active'
  );

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid, wallet_amount_used,
    payment_status, shipping_status
  ) VALUES (
    v_order_id, v_merchant_id, 'DVA-HISTORY-001', 5000, 1000, 500,
    'unpaid', 'pending'
  );

  INSERT INTO public.order_payment_accounts (
    order_id, account_number, bank_name, account_name, provider,
    payable_amount, assigned_at, expires_at
  ) VALUES (
    v_order_id, '9876543210', 'Wema Bank', 'DVA History Fixture',
    'paystack', 0, pg_catalog.now(),
    pg_catalog.now() + pg_catalog.make_interval(mins => 90)
  );
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '3d7a1001-0000-4000-8000-000000000002',
  true
);

-- Establish the first active snapshot before changing the order balance.
DO $first_refresh$
DECLARE
  v_payable_amount numeric;
BEGIN
  SELECT public.refresh_paystack_order_payable_amount(
    '3d7a1200-0000-4000-8000-000000000001'
  ) INTO v_payable_amount;

  IF v_payable_amount IS DISTINCT FROM 4000::numeric THEN
    RAISE EXCEPTION
      'first refresh expected payable amount 4000, got %', v_payable_amount;
  END IF;
END;
$first_refresh$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
UPDATE public.orders
SET total = 6000
WHERE id = '3d7a1200-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '3d7a1001-0000-4000-8000-000000000002',
  true
);

DO $refresh_history$
DECLARE
  v_payable_amount numeric;
  v_expired_original_count integer;
  v_expired_first_refresh_count integer;
  v_active_second_refresh_count integer;
BEGIN
  SELECT public.refresh_paystack_order_payable_amount(
    '3d7a1200-0000-4000-8000-000000000001'
  ) INTO v_payable_amount;

  IF v_payable_amount IS DISTINCT FROM 5000::numeric THEN
    RAISE EXCEPTION
      'second refresh expected payable amount 5000, got %', v_payable_amount;
  END IF;

  SELECT count(*) INTO v_expired_original_count
  FROM public.order_payment_accounts
  WHERE order_id = '3d7a1200-0000-4000-8000-000000000001'
    AND provider = 'paystack'
    AND payable_amount = 0
    AND expires_at <= pg_catalog.now();

  SELECT count(*) INTO v_expired_first_refresh_count
  FROM public.order_payment_accounts
  WHERE order_id = '3d7a1200-0000-4000-8000-000000000001'
    AND provider = 'paystack'
    AND payable_amount = 4000
    AND expires_at <= pg_catalog.now();

  SELECT count(*) INTO v_active_second_refresh_count
  FROM public.order_payment_accounts
  WHERE order_id = '3d7a1200-0000-4000-8000-000000000001'
    AND provider = 'paystack'
    AND payable_amount = 5000
    AND expires_at > pg_catalog.now();

  IF v_expired_original_count <> 1
    OR v_expired_first_refresh_count <> 1
    OR v_active_second_refresh_count <> 1 THEN
    RAISE EXCEPTION
      'repeated refresh did not preserve payable snapshots: original %, first %, active %',
      v_expired_original_count,
      v_expired_first_refresh_count,
      v_active_second_refresh_count;
  END IF;
END;
$refresh_history$;

ROLLBACK;
