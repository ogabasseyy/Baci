-- Authenticated funding recovery must not use a service-role client. Persist
-- only after a short-lived HMAC proof over a Paystack-verified account.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.merchant_wallet_funding_recovery_secrets (
  name text PRIMARY KEY,
  secret text NOT NULL
);

INSERT INTO private.merchant_wallet_funding_recovery_secrets (name, secret)
VALUES (
  'funding_recovery_v1',
  'baci-merchant-wallet-funding-recovery-hmac-v1'
)
ON CONFLICT (name) DO NOTHING;

REVOKE ALL ON TABLE private.merchant_wallet_funding_recovery_secrets
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.persist_merchant_wallet_payment_account(
  p_request_id uuid,
  p_merchant_id uuid,
  p_account_number text,
  p_account_name text,
  p_bank_name text,
  p_currency text,
  p_provider_account_id text DEFAULT NULL,
  p_provider_customer_code text DEFAULT NULL
)
RETURNS public.merchant_wallet_payment_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.merchant_wallet_funding_account_requests;
  v_row public.merchant_wallet_payment_accounts;
  v_recovery text := coalesce(
    pg_catalog.current_setting('baci.wallet_funding_recovery', true),
    ''
  );
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role'
     AND v_recovery IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_currency <> 'NGN' OR p_account_number !~ '^[0-9]{10,20}$' THEN
    RAISE EXCEPTION 'invalid_account' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.merchant_wallet_funding_account_requests
  WHERE id = p_request_id AND merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'funding_request_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_request.status = 'fulfilled' THEN
    SELECT * INTO v_row
    FROM public.merchant_wallet_payment_accounts
    WHERE request_id = p_request_id
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
    IF FOUND
      AND v_row.account_number = p_account_number
      AND v_row.account_name IS NOT DISTINCT FROM p_account_name
      AND v_row.bank_name IS NOT DISTINCT FROM p_bank_name
      AND v_row.currency = p_currency
      AND v_row.provider_account_id IS NOT DISTINCT FROM p_provider_account_id
      AND v_row.provider_customer_code IS NOT DISTINCT FROM p_provider_customer_code THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'conflicting_assignment_replay' USING ERRCODE = 'P0001';
  END IF;

  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'funding_request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(p_account_number), 0
    )
  );
  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.provider = 'paystack'
      AND account.account_number = trim(p_account_number)
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) OR EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts AS wallet
    WHERE wallet.provider = 'paystack'
      AND wallet.account_number = trim(p_account_number)
      AND wallet.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.checkout_sessions AS checkout
    WHERE checkout.virtual_account_number = trim(p_account_number)
      AND checkout.payment_provider = 'paystack'
      AND checkout.status IN ('pending', 'processing')
      AND COALESCE(checkout.virtual_account_expires_at, checkout.expires_at) > now()
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END IF;

  INSERT INTO public.merchant_wallet_payment_accounts (
    merchant_id, request_id, account_number, account_name, bank_name, currency,
    status, provider_account_id, provider_customer_code
  ) VALUES (
    p_merchant_id, p_request_id, p_account_number, p_account_name, p_bank_name,
    'NGN', 'active', p_provider_account_id, p_provider_customer_code
  )
  ON CONFLICT (merchant_id, provider) WHERE status IN ('active', 'pending')
  DO UPDATE SET
    request_id = EXCLUDED.request_id,
    account_number = EXCLUDED.account_number,
    account_name = EXCLUDED.account_name,
    bank_name = EXCLUDED.bank_name,
    provider_account_id = EXCLUDED.provider_account_id,
    provider_customer_code = EXCLUDED.provider_customer_code,
    status = 'active',
    updated_at = now()
  RETURNING * INTO v_row;

  UPDATE public.merchant_wallet_funding_account_requests
  SET status = 'fulfilled'
  WHERE id = p_request_id
    AND merchant_id = p_merchant_id
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'funding_request_not_pending' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_merchant_wallet_payment_account(
  uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_merchant_wallet_payment_account(
  uuid, uuid, text, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_merchant_wallet_funding_recovery(
  p_request_id uuid,
  p_merchant_id uuid,
  p_account_number text,
  p_account_name text,
  p_bank_name text,
  p_currency text,
  p_provider_account_id text,
  p_provider_customer_code text,
  p_attested_at timestamptz,
  p_attested_at_iso text,
  p_attestation text
)
RETURNS public.merchant_wallet_payment_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_payload text;
  v_expected text;
  v_iso_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.id = p_merchant_id
      AND merchant.user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_iso_at := p_attested_at_iso::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'attestation_expired' USING ERRCODE = '22023';
  END;

  IF p_attested_at IS NULL
     OR v_iso_at IS NULL
     OR abs(extract(epoch FROM (p_attested_at - v_iso_at))) > 1
     OR p_attested_at < now() - interval '5 minutes'
     OR p_attested_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'attestation_expired' USING ERRCODE = '22023';
  END IF;

  SELECT secret
  INTO v_secret
  FROM private.merchant_wallet_funding_recovery_secrets
  WHERE name = 'funding_recovery_v1';
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'recovery_secret_missing' USING ERRCODE = 'P0001';
  END IF;

  v_payload := concat_ws(
    '|',
    p_request_id::text,
    p_merchant_id::text,
    coalesce(p_account_number, ''),
    coalesce(p_account_name, ''),
    coalesce(p_bank_name, ''),
    coalesce(p_currency, ''),
    coalesce(p_provider_account_id, ''),
    coalesce(p_provider_customer_code, ''),
    coalesce(p_attested_at_iso, '')
  );
  v_expected := encode(extensions.hmac(v_payload, v_secret, 'sha256'), 'hex');
  IF lower(coalesce(p_attestation, '')) IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'invalid_attestation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('baci.wallet_funding_recovery', '1', true);
  RETURN public.persist_merchant_wallet_payment_account(
    p_request_id,
    p_merchant_id,
    p_account_number,
    p_account_name,
    p_bank_name,
    p_currency,
    p_provider_account_id,
    p_provider_customer_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_merchant_wallet_funding_recovery(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_merchant_wallet_funding_recovery(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text
) TO authenticated;
