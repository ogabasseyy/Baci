-- Wallet DVA provisioning has a separate trusted Postgres boundary. The
-- application login that is provisioned out of band is expected to be named
-- baci_wallet_dva_provisioner and granted membership in this NOLOGIN role.
-- This migration does not create a password or grant table access.
DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_wallet_dva_writer'
  ) THEN
    CREATE ROLE baci_wallet_dva_writer
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  END IF;
END;
$roles$;

ALTER ROLE baci_wallet_dva_writer
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;

CREATE SCHEMA IF NOT EXISTS wallet_dva_private;
REVOKE ALL ON SCHEMA wallet_dva_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA wallet_dva_private TO baci_wallet_dva_writer;

CREATE OR REPLACE FUNCTION wallet_dva_private.record_paystack_customer_wallet_dva(
  p_user_id uuid,
  p_customer_id uuid,
  p_merchant_id uuid,
  p_provider_customer_code text,
  p_provider_subaccount_code text,
  p_provider_account_id text,
  p_account_number text,
  p_account_name text,
  p_bank_name text,
  p_bank_slug text,
  p_currency text,
  p_consented_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_account public.customer_wallet_payment_accounts%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR p_customer_id IS NULL
    OR p_merchant_id IS NULL
    OR p_provider_customer_code IS NULL
    OR p_provider_customer_code !~ '^CUS_[A-Za-z0-9]+$'
    OR p_provider_subaccount_code IS NULL
    OR p_provider_subaccount_code !~ '^ACCT_[A-Za-z0-9]+$'
    OR (p_provider_account_id IS NOT NULL AND p_provider_account_id !~ '^[0-9]{1,20}$')
    OR p_account_number IS NULL
    OR p_account_number !~ '^[0-9]{10}$'
    OR p_account_name IS NULL
    OR pg_catalog.btrim(p_account_name) = ''
    OR length(p_account_name) > 160
    OR p_account_name ~ '[[:cntrl:]]'
    OR p_bank_name IS NULL
    OR pg_catalog.btrim(p_bank_name) = ''
    OR length(p_bank_name) > 120
    OR p_bank_name ~ '[[:cntrl:]]'
    OR (p_bank_slug IS NOT NULL AND (pg_catalog.btrim(p_bank_slug) = '' OR length(p_bank_slug) > 120 OR p_bank_slug ~ '[[:cntrl:]]'))
    OR p_currency IS NULL
    OR p_currency IS DISTINCT FROM 'NGN'
    OR p_consented_at IS NULL
    OR p_consented_at > pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_wallet_dva_arguments';
  END IF;

  -- The application resolves this owner under RLS. Recheck the complete
  -- user/customer/merchant binding and current merchant settings here before
  -- accepting the provider response.
  PERFORM 1
    FROM public.customers AS customer
    JOIN public.merchants AS merchant ON merchant.id = customer.merchant_id
    JOIN public.merchant_feature_settings AS settings
      ON settings.merchant_id = merchant.id
    WHERE customer.id = p_customer_id
      AND customer.merchant_id = p_merchant_id
      AND customer.user_id = p_user_id
      AND merchant.paystack_subaccount_code = p_provider_subaccount_code
      AND settings.wallet_paystack_dva_enabled IS TRUE
    FOR SHARE OF customer, merchant, settings;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'wallet_dva_owner_or_merchant_mismatch';
  END IF;

  -- Serialize provider retries and concurrent requests for one owner slot.
  -- The account-number alias triggers retain their shared lock with order and
  -- merchant DVAs, so an active order receiver can never be claimed here.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer_wallet_dva:' || p_merchant_id::text || ':' || p_customer_id::text,
      0
    )
  );

  SELECT account.*
  INTO v_account
  FROM public.customer_wallet_payment_accounts AS account
  WHERE account.merchant_id = p_merchant_id
    AND account.customer_id = p_customer_id
    AND account.provider = 'paystack'
  FOR UPDATE;

  IF FOUND THEN
    IF v_account.status = 'disabled' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WALLET_DVA_DISABLED_ACCOUNT';
    END IF;
    IF v_account.provider_subaccount_code IS DISTINCT FROM p_provider_subaccount_code THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WALLET_DVA_SUBACCOUNT_CONFLICT';
    END IF;
    IF v_account.provider_customer_code IS DISTINCT FROM p_provider_customer_code THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WALLET_DVA_PROVIDER_CUSTOMER_CONFLICT';
    END IF;

    IF v_account.status = 'pending_review' THEN
      IF v_account.account_number IS DISTINCT FROM p_account_number
        OR v_account.provider_account_id IS DISTINCT FROM p_provider_account_id
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WALLET_DVA_PENDING_REVIEW_CONFLICT';
      END IF;

      UPDATE public.customer_wallet_payment_accounts AS account
      SET account_name = pg_catalog.btrim(p_account_name),
          bank_name = pg_catalog.btrim(p_bank_name),
          bank_slug = p_bank_slug,
          consented_at = p_consented_at,
          status = 'active'
      WHERE account.id = v_account.id
      RETURNING account.* INTO v_account;
    END IF;

    -- Active slot retries converge on the original row; never replace it
    -- with a second provider assignment returned by a concurrent request.
    RETURN pg_catalog.jsonb_build_object(
      'id', v_account.id,
      'merchant_id', v_account.merchant_id,
      'customer_id', v_account.customer_id,
      'provider', v_account.provider,
      'provider_customer_code', v_account.provider_customer_code,
      'provider_subaccount_code', v_account.provider_subaccount_code,
      'provider_account_id', v_account.provider_account_id,
      'account_number', v_account.account_number,
      'account_name', v_account.account_name,
      'bank_name', v_account.bank_name,
      'bank_slug', v_account.bank_slug,
      'currency', v_account.currency,
      'status', v_account.status,
      'metadata', v_account.metadata,
      'consented_at', v_account.consented_at
    );
  END IF;

  INSERT INTO public.customer_wallet_payment_accounts (
    account_name, account_number, bank_name, bank_slug, consented_at,
    currency, customer_id, merchant_id, metadata, provider,
    provider_account_id, provider_customer_code, provider_subaccount_code,
    status
  ) VALUES (
    pg_catalog.btrim(p_account_name), p_account_number,
    pg_catalog.btrim(p_bank_name), p_bank_slug, p_consented_at,
    'NGN', p_customer_id, p_merchant_id, '{"source":"wallet_dva"}'::jsonb,
    'paystack', p_provider_account_id, p_provider_customer_code,
    p_provider_subaccount_code, 'active'
  )
  RETURNING * INTO v_account;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_account.id,
    'merchant_id', v_account.merchant_id,
    'customer_id', v_account.customer_id,
    'provider', v_account.provider,
    'provider_customer_code', v_account.provider_customer_code,
    'provider_subaccount_code', v_account.provider_subaccount_code,
    'provider_account_id', v_account.provider_account_id,
    'account_number', v_account.account_number,
    'account_name', v_account.account_name,
    'bank_name', v_account.bank_name,
    'bank_slug', v_account.bank_slug,
    'currency', v_account.currency,
    'status', v_account.status,
    'metadata', v_account.metadata,
    'consented_at', v_account.consented_at
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Do not expose a conflicting receiver row to this writer. The caller
    -- receives only this stable conflict code and may resolve via its own RLS.
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WALLET_DVA_RECEIVER_CONFLICT';
END;
$function$;

REVOKE ALL ON FUNCTION wallet_dva_private.record_paystack_customer_wallet_dva(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION wallet_dva_private.record_paystack_customer_wallet_dva(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz
) TO baci_wallet_dva_writer;

COMMENT ON FUNCTION wallet_dva_private.record_paystack_customer_wallet_dva(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz
) IS 'Restricted wallet DVA writer operation. Only a separately provisioned wallet DVA login may execute it; no table privileges are granted to that login role.';
