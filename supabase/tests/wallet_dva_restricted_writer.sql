-- Contract test for the restricted Paystack customer-wallet DVA writer.
-- Run after chronological migration replay:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/wallet_dva_restricted_writer.sql

BEGIN;

DO $privileges$
DECLARE
  v_signature constant text :=
    'wallet_dva_private.record_paystack_customer_wallet_dva(uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamp with time zone)';
BEGIN
  IF NOT pg_catalog.has_function_privilege('baci_wallet_dva_writer', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'wallet writer cannot execute its single operation';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'wallet DVA writer operation has an unauthorized executor';
  END IF;
  IF pg_catalog.has_table_privilege('baci_wallet_dva_writer', 'public.customer_wallet_payment_accounts', 'SELECT')
    OR pg_catalog.has_table_privilege('baci_wallet_dva_writer', 'public.customer_wallet_payment_accounts', 'INSERT')
    OR pg_catalog.has_table_privilege('baci_wallet_dva_writer', 'public.customer_wallet_payment_accounts', 'UPDATE')
    OR pg_catalog.has_table_privilege('baci_wallet_dva_writer', 'public.customer_wallet_payment_accounts', 'DELETE')
  THEN
    RAISE EXCEPTION 'wallet writer role has direct table privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'baci_wallet_dva_writer'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'wallet DVA writer must remain a non-login least-privilege role';
  END IF;
END;
$privileges$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('86110000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wallet-owner-1@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('86110000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wallet-owner-2@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('86110000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wallet-owner-3@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('86110000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wallet-owner-4@example.test', 'test', now(), now(), now(), '{}', '{}');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, paystack_subaccount_code)
  VALUES
    ('86110000-0000-4000-8000-000000000001', 'wallet-dva-1@example.test', 'Wallet DVA One', 'wallet-dva-one', 'ACCT_walletdva1'),
    ('86110000-0000-4000-8000-000000000002', 'wallet-dva-2@example.test', 'Wallet DVA Two', 'wallet-dva-two', 'ACCT_walletdva2');

  INSERT INTO public.customers (id, merchant_id, email, user_id)
  VALUES
    ('86110000-0000-4000-8000-000000000011', '86110000-0000-4000-8000-000000000001', 'wallet-owner-1@example.test', '86110000-0000-4000-8000-000000000101'),
    ('86110000-0000-4000-8000-000000000012', '86110000-0000-4000-8000-000000000001', 'wallet-owner-2@example.test', '86110000-0000-4000-8000-000000000102'),
    ('86110000-0000-4000-8000-000000000013', '86110000-0000-4000-8000-000000000001', 'wallet-owner-4@example.test', '86110000-0000-4000-8000-000000000104'),
    ('86110000-0000-4000-8000-000000000021', '86110000-0000-4000-8000-000000000002', 'wallet-owner-3@example.test', '86110000-0000-4000-8000-000000000103');

  -- trigger_create_merchant_feature_settings already created a default row
  -- for each merchant inserted above, so enable the wallet flag by upsert.
  INSERT INTO public.merchant_feature_settings (merchant_id, wallet_paystack_dva_enabled)
  VALUES
    ('86110000-0000-4000-8000-000000000001', true),
    ('86110000-0000-4000-8000-000000000002', true)
  ON CONFLICT (merchant_id) DO UPDATE
    SET wallet_paystack_dva_enabled = EXCLUDED.wallet_paystack_dva_enabled;

  INSERT INTO public.checkout_sessions (
    id, session_id, merchant_id, payment_provider, status,
    virtual_account_number, virtual_account_expires_at, expires_at
  ) VALUES (
    '86110000-0000-4000-8000-000000000201', 'wallet-dva-alias-session',
    '86110000-0000-4000-8000-000000000002', 'paystack', 'pending',
    '9876543210', now() + interval '30 minutes', now() + interval '1 hour'
  );

  INSERT INTO public.customer_wallet_payment_accounts (
    id, merchant_id, customer_id, provider, provider_customer_code,
    provider_subaccount_code, provider_account_id, account_number,
    account_name, bank_name, bank_slug, currency, status, consented_at
  ) VALUES
    ('86110000-0000-4000-8000-000000000301', '86110000-0000-4000-8000-000000000001',
     '86110000-0000-4000-8000-000000000012', 'paystack', 'CUS_WalletOwner2',
     'ACCT_walletdva1', '200002', '2222222222', 'Pending Owner',
     'Wema Bank', NULL, 'NGN', 'pending_review', now()),
    ('86110000-0000-4000-8000-000000000302', '86110000-0000-4000-8000-000000000002',
     '86110000-0000-4000-8000-000000000021', 'paystack', 'CUS_WalletOwner3',
     'ACCT_walletdva2', '300003', '4444444444', 'Disabled Owner',
     'Wema Bank', NULL, 'NGN', 'disabled', now());
END;
$fixtures$;

RESET ROLE;
DO $writer_login$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_wallet_dva_provisioner') THEN
    RAISE EXCEPTION 'synthetic writer login unexpectedly exists before this disposable test';
  END IF;
  CREATE ROLE baci_wallet_dva_provisioner
    LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  GRANT baci_wallet_dva_writer TO baci_wallet_dva_provisioner;
END;
$writer_login$;

DO $writer_login_privileges$
DECLARE
  v_signature constant text :=
    'wallet_dva_private.record_paystack_customer_wallet_dva(uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamp with time zone)';
BEGIN
  IF NOT pg_catalog.pg_has_role('baci_wallet_dva_provisioner', 'baci_wallet_dva_writer', 'MEMBER')
    OR NOT pg_catalog.has_function_privilege('baci_wallet_dva_provisioner', v_signature, 'EXECUTE')
    OR pg_catalog.has_table_privilege('baci_wallet_dva_provisioner', 'public.customer_wallet_payment_accounts', 'SELECT')
    OR pg_catalog.has_table_privilege('baci_wallet_dva_provisioner', 'public.customer_wallet_payment_accounts', 'INSERT')
    OR pg_catalog.has_table_privilege('baci_wallet_dva_provisioner', 'public.customer_wallet_payment_accounts', 'UPDATE')
    OR pg_catalog.has_table_privilege('baci_wallet_dva_provisioner', 'public.customer_wallet_payment_accounts', 'DELETE')
  THEN
    RAISE EXCEPTION 'synthetic writer login does not have the exact restricted privilege set';
  END IF;
END;
$writer_login_privileges$;

-- The CI replay connection is not a superuser, so SET SESSION AUTHORIZATION to
-- the synthetic login is refused (42501). Exercise the same boundary as the
-- NOLOGIN group role that the login inherits; the catalog checks above already
-- prove the login is a member of it and holds no extra privileges. The
-- self-grant works because the replay user created the group role (migration
-- above) and so holds ADMIN OPTION on it, which PostgreSQL 16+ requires.
GRANT baci_wallet_dva_writer TO CURRENT_USER;
SET LOCAL ROLE baci_wallet_dva_writer;

DO $writer$
DECLARE
  v_first jsonb;
  v_retry jsonb;
  v_conflict boolean;
  v_keys integer;
BEGIN
  v_first := wallet_dva_private.record_paystack_customer_wallet_dva(
    '86110000-0000-4000-8000-000000000101',
    '86110000-0000-4000-8000-000000000011',
    '86110000-0000-4000-8000-000000000001',
    'CUS_WalletOwner1', 'ACCT_walletdva1', '100001',
    '1234567890', 'José Store / Zoë', 'Wéma Bank', 'wema-bank', 'NGN', now()
  );
  SELECT count(*) INTO v_keys FROM jsonb_object_keys(v_first);
  IF v_keys <> 15 OR v_first ? 'created_at' OR v_first ? 'updated_at'
    OR v_first->>'customer_id' <> '86110000-0000-4000-8000-000000000011'
    OR v_first->>'merchant_id' <> '86110000-0000-4000-8000-000000000001'
    OR v_first->>'account_name' <> 'José Store / Zoë'
  THEN
    RAISE EXCEPTION 'writer returned an incorrect projection or owner binding: %', v_first;
  END IF;

  v_retry := wallet_dva_private.record_paystack_customer_wallet_dva(
    '86110000-0000-4000-8000-000000000101',
    '86110000-0000-4000-8000-000000000011',
    '86110000-0000-4000-8000-000000000001',
    'CUS_WalletOwner1', 'ACCT_walletdva1', '100001',
    '3333333333', 'A concurrent result', 'Other Bank', NULL, 'NGN', now()
  );
  IF v_retry->>'id' IS DISTINCT FROM v_first->>'id'
    OR v_retry->>'account_number' IS DISTINCT FROM '1234567890'
  THEN
    RAISE EXCEPTION 'idempotent retry replaced the first owner-slot assignment';
  END IF;

  -- The owner may not be substituted, and tenant/customer mismatch is rejected.
  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000102',
      '86110000-0000-4000-8000-000000000011',
      '86110000-0000-4000-8000-000000000001',
      'CUS_WalletOwner1', 'ACCT_walletdva1', '100001',
      '1234567890', 'Forged Owner', 'Wema', NULL, 'NGN', now()
    );
    RAISE EXCEPTION 'cross-owner write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000102',
      '86110000-0000-4000-8000-000000000012',
      '86110000-0000-4000-8000-000000000002',
      'CUS_WalletOwner2', 'ACCT_walletdva1', '200002',
      '2222222222', 'Wrong Merchant', 'Wema', NULL, 'NGN', now()
    );
    RAISE EXCEPTION 'cross-merchant subaccount write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- A receiver already held by a different customer cannot be returned or reassigned.
  v_conflict := false;
  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000104',
      '86110000-0000-4000-8000-000000000013',
      '86110000-0000-4000-8000-000000000001',
      'CUS_WalletOwner4', 'ACCT_walletdva1', '400004',
      '1234567890', 'Other Owner', 'Wema', NULL, 'NGN', now()
    );
  EXCEPTION WHEN raise_exception THEN
    v_conflict := SQLERRM = 'WALLET_DVA_RECEIVER_CONFLICT';
  END;
  IF NOT v_conflict THEN
    RAISE EXCEPTION 'cross-owner receiver conflict was not refused';
  END IF;

  -- The existing shared trigger/advisory lock blocks active checkout aliases.
  v_conflict := false;
  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000104',
      '86110000-0000-4000-8000-000000000013',
      '86110000-0000-4000-8000-000000000001',
      'CUS_WalletOwner4', 'ACCT_walletdva1', '400004',
      '9876543210', 'Alias Owner', 'Wema', NULL, 'NGN', now()
    );
  EXCEPTION WHEN raise_exception THEN
    v_conflict := SQLERRM = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END;
  IF NOT v_conflict THEN
    RAISE EXCEPTION 'active checkout DVA alias was not refused';
  END IF;

  -- Pending review only reactivates if provider identity is unchanged.
  v_conflict := false;
  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000102',
      '86110000-0000-4000-8000-000000000012',
      '86110000-0000-4000-8000-000000000001',
      'CUS_WalletOwner2', 'ACCT_walletdva1', '200002',
      '5555555555', 'Changed Pending Owner', 'Wema Bank', NULL, 'NGN', now()
    );
  EXCEPTION WHEN raise_exception THEN
    v_conflict := SQLERRM = 'WALLET_DVA_PENDING_REVIEW_CONFLICT';
  END;
  IF NOT v_conflict THEN
    RAISE EXCEPTION 'changed pending-review identity was not refused';
  END IF;

  v_retry := wallet_dva_private.record_paystack_customer_wallet_dva(
    '86110000-0000-4000-8000-000000000102',
    '86110000-0000-4000-8000-000000000012',
    '86110000-0000-4000-8000-000000000001',
    'CUS_WalletOwner2', 'ACCT_walletdva1', '200002',
    '2222222222', 'Pending Owner Verified', 'Wema Bank', NULL, 'NGN', now()
  );
  IF v_retry->>'status' IS DISTINCT FROM 'active'
    OR v_retry->>'id' IS DISTINCT FROM '86110000-0000-4000-8000-000000000301'
  THEN
    RAISE EXCEPTION 'matching pending-review account did not reactivate in place';
  END IF;

  v_conflict := false;
  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000103',
      '86110000-0000-4000-8000-000000000021',
      '86110000-0000-4000-8000-000000000002',
      'CUS_WalletOwner3', 'ACCT_walletdva2', '300003',
      '4444444444', 'Disabled Owner', 'Wema Bank', NULL, 'NGN', now()
    );
  EXCEPTION WHEN raise_exception THEN
    v_conflict := SQLERRM = 'WALLET_DVA_DISABLED_ACCOUNT';
  END;
  IF NOT v_conflict THEN
    RAISE EXCEPTION 'disabled DVA slot was not refused';
  END IF;

  -- Required fields must reject SQL NULL (which otherwise bypasses OR checks).
  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000103',
      '86110000-0000-4000-8000-000000000021',
      '86110000-0000-4000-8000-000000000002',
      'CUS_WalletOwner3', 'ACCT_walletdva2', '300003',
      '9876543211', NULL, 'Wema', NULL, 'NGN', now()
    );
    RAISE EXCEPTION 'NULL account name unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000103',
      '86110000-0000-4000-8000-000000000021',
      '86110000-0000-4000-8000-000000000002',
      'CUS_WalletOwner3', 'ACCT_walletdva2', 'non-numeric',
      '9876543211', 'Valid Owner', 'Wema', NULL, 'NGN', now()
    );
    RAISE EXCEPTION 'non-numeric provider_account_id unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  BEGIN
    PERFORM wallet_dva_private.record_paystack_customer_wallet_dva(
      '86110000-0000-4000-8000-000000000103',
      '86110000-0000-4000-8000-000000000021',
      '86110000-0000-4000-8000-000000000002',
      'CUS_WalletOwner3', 'ACCT_walletdva2', '300003',
      '9876543211', 'Valid Owner', 'Wema', '   ', 'NGN', now()
    );
    RAISE EXCEPTION 'blank bank_slug unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
END;
$writer$;

RESET ROLE;
-- A denied EXECUTE is an ACL check made before the function body starts, and on
-- the pinned CI replay image a plpgsql handler cannot trap it (same finding as
-- supabase/tests/finalize_store_credit_order_payment_privileges.sql). Errors
-- that the function body raises itself, such as the cross-owner and
-- cross-merchant cases earlier in this file, are trapped normally. So
-- authenticated's lack of EXECUTE is asserted through the catalog in the
-- privileges block at the top of this file instead of by calling it.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

DO $rls_reads$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '86110000-0000-4000-8000-000000000101', true);
  SELECT count(*) INTO v_count
  FROM public.customer_wallet_payment_accounts;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'wallet DVA owner did not see exactly their own account';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '86110000-0000-4000-8000-000000000102', true);
  SELECT count(*) INTO v_count
  FROM public.customer_wallet_payment_accounts;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts
    WHERE customer_id = '86110000-0000-4000-8000-000000000012'
  ) THEN
    RAISE EXCEPTION 'same-merchant owner did not see only their own wallet DVA';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '86110000-0000-4000-8000-000000000103', true);
  SELECT count(*) INTO v_count
  FROM public.customer_wallet_payment_accounts;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts
    WHERE customer_id = '86110000-0000-4000-8000-000000000021'
  ) THEN
    RAISE EXCEPTION 'other-merchant owner did not see only their own wallet DVA';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '86110000-0000-4000-8000-000000000104', true);
  SELECT count(*) INTO v_count
  FROM public.customer_wallet_payment_accounts;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'same-merchant alternate user saw a wallet DVA';
  END IF;
END;
$rls_reads$;

ROLLBACK;
