-- The recovery HMAC must be one shared non-public secret provisioned into both
-- the database and MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET. Clear any
-- migration-generated isolated random value and require service-role provisioning.

CREATE OR REPLACE FUNCTION public.set_merchant_wallet_funding_recovery_hmac_secret(
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_secret IS NULL OR length(p_secret) < 32 THEN
    RAISE EXCEPTION 'invalid_recovery_secret' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.merchant_wallet_funding_recovery_secrets (name, secret)
  VALUES ('funding_recovery_v1', p_secret)
  ON CONFLICT (name) DO UPDATE
  SET secret = EXCLUDED.secret;
END;
$$;

REVOKE ALL ON FUNCTION public.set_merchant_wallet_funding_recovery_hmac_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_merchant_wallet_funding_recovery_hmac_secret(text)
  TO service_role;

UPDATE private.merchant_wallet_funding_recovery_secrets
SET secret = ''
WHERE name = 'funding_recovery_v1';

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
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'recovery_secret_unprovisioned' USING ERRCODE = 'P0001';
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
