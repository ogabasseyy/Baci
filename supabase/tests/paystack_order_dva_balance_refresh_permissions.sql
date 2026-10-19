-- REGRESSION TEST: order viewers can refresh an existing Paystack invoice
-- account balance, while staff without order access remain forbidden.
--
-- USAGE:
--   supabase test db supabase/tests/paystack_order_dva_balance_refresh_permissions.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The local
-- auth schema intentionally does not grant service_role direct writes to
-- auth.users; the assertions below switch to authenticated explicitly.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '3d7a0001-0000-4000-8000-000000000001';
  v_viewer_id uuid := '3d7a0001-0000-4000-8000-000000000002';
  v_denied_id uuid := '3d7a0001-0000-4000-8000-000000000003';
  v_merchant_id uuid := '3d7a0100-0000-4000-8000-000000000001';
  v_order_id uuid := '3d7a0200-0000-4000-8000-000000000001';
  v_status_customer_id uuid := '3d7a0300-0000-4000-8000-000000000001';
  v_receiver_customer_id uuid := '3d7a0300-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dva-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_viewer_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dva-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_denied_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dva-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (
    id, user_id, email, business_name, slug
  ) VALUES (
    v_merchant_id, v_owner_id, 'dva-owner@example.test',
    'DVA Permission Fixture', 'dva-permission-fixture'
  );

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_viewer_id, 'dva-viewer@example.test',
      'DVA Viewer', 'accountant',
      '{"orders":{"view":true,"edit":false}}'::jsonb, 'active'),
    (v_merchant_id, v_denied_id, 'dva-denied@example.test',
      'DVA Denied', 'accountant',
      '{"orders":{"view":false,"edit":false}}'::jsonb, 'active');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid, wallet_amount_used,
    payment_status, shipping_status
  ) VALUES (
    v_order_id, v_merchant_id, 'DVA-PERMISSION-001', 5000, 1000, 500,
    'unpaid', 'pending'
  );

  INSERT INTO public.order_payment_accounts (
    order_id, account_number, bank_name, account_name, provider,
    payable_amount, assigned_at, expires_at
  ) VALUES (
    v_order_id, '9876543210', 'Wema Bank', 'DVA Permission Fixture',
    'paystack', 0, pg_catalog.now(),
    pg_catalog.now() + pg_catalog.make_interval(mins => 90)
  );

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_status_customer_id, v_merchant_id, 'dva-wallet-status@example.test',
      'DVA Wallet Status Fixture'),
    (v_receiver_customer_id, v_merchant_id, 'dva-wallet-receiver@example.test',
      'DVA Wallet Receiver Fixture');

  -- A disabled wallet may retain a receiver that is currently used by an
  -- invoice. Activating it must still run the cross-flow guard.
  INSERT INTO public.customer_wallet_payment_accounts (
    id, merchant_id, customer_id, provider, provider_customer_code,
    provider_subaccount_code, account_number, account_name, bank_name,
    status, consented_at
  ) VALUES (
    '3d7a0400-0000-4000-8000-000000000001', v_merchant_id,
    v_status_customer_id, 'paystack', 'CUS_DVA_STATUS', 'ACCT_DVA_STATUS',
    '9876543210', 'DVA Status Fixture', 'Wema Bank', 'disabled',
    pg_catalog.now()
  );

  -- An active wallet receiver change must be checked as well.
  INSERT INTO public.customer_wallet_payment_accounts (
    id, merchant_id, customer_id, provider, provider_customer_code,
    provider_subaccount_code, account_number, account_name, bank_name,
    status, consented_at
  ) VALUES (
    '3d7a0400-0000-4000-8000-000000000002', v_merchant_id,
    v_receiver_customer_id, 'paystack', 'CUS_DVA_RECEIVER',
    'ACCT_DVA_RECEIVER', '1234567890', 'DVA Receiver Fixture', 'Wema Bank',
    'active', pg_catalog.now()
  );
END;
$fixtures$;

DO $wallet_update_guards$
DECLARE
  v_status_conflict boolean := false;
  v_receiver_conflict boolean := false;
BEGIN
  BEGIN
    UPDATE public.customer_wallet_payment_accounts
    SET status = 'active'
    WHERE id = '3d7a0400-0000-4000-8000-000000000001';
  EXCEPTION WHEN raise_exception THEN
    v_status_conflict := SQLSTATE = 'P0001'
      AND SQLERRM = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END;

  IF NOT v_status_conflict THEN
    RAISE EXCEPTION
      'activating a conflicting wallet receiver was not rejected';
  END IF;

  BEGIN
    UPDATE public.customer_wallet_payment_accounts
    SET account_number = '9876543210'
    WHERE id = '3d7a0400-0000-4000-8000-000000000002';
  EXCEPTION WHEN raise_exception THEN
    v_receiver_conflict := SQLSTATE = 'P0001'
      AND SQLERRM = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END;

  IF NOT v_receiver_conflict THEN
    RAISE EXCEPTION
      'changing an active wallet receiver to an invoice alias was not rejected';
  END IF;
END;
$wallet_update_guards$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '3d7a0001-0000-4000-8000-000000000002',
  true
);

DO $view_only_staff$
DECLARE
  v_payable_amount numeric;
  v_stored_amount numeric;
  v_paystack_alias_count integer;
  v_expired_snapshot_count integer;
  v_active_snapshot_count integer;
BEGIN
  SELECT public.refresh_paystack_order_payable_amount(
    '3d7a0200-0000-4000-8000-000000000001'
  ) INTO v_payable_amount;

  IF v_payable_amount IS DISTINCT FROM 4000::numeric THEN
    RAISE EXCEPTION
      'view-only staff expected payable amount 4000, got %',
      v_payable_amount;
  END IF;

  SELECT payable_amount INTO v_stored_amount
  FROM public.order_payment_accounts
  WHERE order_id = '3d7a0200-0000-4000-8000-000000000001'
    AND provider = 'paystack';

  IF v_stored_amount IS DISTINCT FROM 4000::numeric THEN
    RAISE EXCEPTION
      'view-only refresh expected stored payable amount 4000, got %',
      v_stored_amount;
  END IF;

  SELECT count(*) INTO v_paystack_alias_count
  FROM public.order_payment_accounts
  WHERE order_id = '3d7a0200-0000-4000-8000-000000000001'
    AND provider = 'paystack';

  IF v_paystack_alias_count <> 2 THEN
    RAISE EXCEPTION
      'expected one expired and one active Paystack alias snapshot, got %',
      v_paystack_alias_count;
  END IF;

  SELECT count(*) INTO v_expired_snapshot_count
  FROM public.order_payment_accounts
  WHERE order_id = '3d7a0200-0000-4000-8000-000000000001'
    AND provider = 'paystack'
    AND payable_amount = 0
    AND expires_at <= pg_catalog.now();

  IF v_expired_snapshot_count <> 1 THEN
    RAISE EXCEPTION
      'expected the original Paystack alias to remain an expired snapshot';
  END IF;

  SELECT count(*) INTO v_active_snapshot_count
  FROM public.order_payment_accounts
  WHERE order_id = '3d7a0200-0000-4000-8000-000000000001'
    AND provider = 'paystack'
    AND payable_amount = 4000
    AND expires_at > pg_catalog.now();

  IF v_active_snapshot_count <> 1 THEN
    RAISE EXCEPTION
      'expected the refreshed Paystack alias snapshot to remain active';
  END IF;
END;
$view_only_staff$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '3d7a0001-0000-4000-8000-000000000003',
  true
);

DO $denied_staff$
DECLARE
  v_forbidden boolean := false;
BEGIN
  BEGIN
    PERFORM public.refresh_paystack_order_payable_amount(
      '3d7a0200-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN raise_exception THEN
    v_forbidden := SQLERRM = 'forbidden';
  END;

  IF NOT v_forbidden THEN
    RAISE EXCEPTION
      'staff without orders.view or orders.edit was not rejected with forbidden';
  END IF;
END;
$denied_staff$;

ROLLBACK;
