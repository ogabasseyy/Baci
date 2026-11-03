-- Fulfil-staff GIG merchant-wallet access, part 5 of 6.
-- Concern: funding-request policies and recovery functions.
-- The owner decision and gate rules are documented in
-- 20261031130000_add_gigl_wallet_actor_columns.sql.

-- 5. Funding requests: fulfil staff may read and create the merchant's
--    pending request. Inserts stay pending-only and must record the caller
--    as requested_by; provider assignment stays service-role or
--    HMAC-recovery only.
DROP POLICY merchant_wallet_request_owner
  ON public.merchant_wallet_funding_account_requests;
CREATE POLICY merchant_wallet_request_fulfill_read
  ON public.merchant_wallet_funding_account_requests
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'fulfill'
    )
  );
DROP POLICY merchant_wallet_request_owner_insert
  ON public.merchant_wallet_funding_account_requests;
CREATE POLICY merchant_wallet_request_fulfill_insert
  ON public.merchant_wallet_funding_account_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND requested_by = (SELECT auth.uid())
    AND public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'fulfill'
    )
  );

-- 6. Failing a stuck funding request follows the same fulfil gate.
CREATE OR REPLACE FUNCTION public.fail_merchant_wallet_funding_request(p_request_id uuid,p_merchant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill') THEN RAISE EXCEPTION 'merchant_fulfill_required' USING ERRCODE='42501'; END IF;
  UPDATE public.merchant_wallet_funding_account_requests SET status='failed' WHERE id=p_request_id AND merchant_id=p_merchant_id AND status='pending';
END; $$;
REVOKE ALL ON FUNCTION public.fail_merchant_wallet_funding_request(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_merchant_wallet_funding_request(uuid, uuid)
  TO authenticated;

-- 7. HMAC-attested funding-account recovery follows the same fulfil gate.
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
  IF auth.uid() IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
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
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_merchant_wallet_funding_recovery(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text
)
  TO authenticated;
