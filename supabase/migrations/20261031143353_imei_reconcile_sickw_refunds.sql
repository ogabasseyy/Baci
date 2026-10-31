-- Reconcile only ledger-confirmed Sickw refunds inside the signed claim boundary.
CREATE OR REPLACE FUNCTION public.imei_claim_attempt(p_payload text, p_signature text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  proof jsonb := private.assert_imei_access(p_payload, p_signature);
  args jsonb := proof->'args';
  customer uuid := (proof->>'customer')::uuid;
  merchant uuid := (proof->>'merchant')::uuid;
  tier_name text := args->>'tier';
  device_hash text := args->>'imei_hash';
  requested_key uuid := (args->>'idempotency_key')::uuid;
  previous_lookup uuid := NULLIF(args->>'previous_lookup_id', '')::uuid;
  current_key uuid;
  unresolved_key uuid;
BEGIN
  IF proof->>'operation' IS DISTINCT FROM 'claim_attempt'
     OR coalesce(tier_name, '') !~ '^[A-Za-z][A-Za-z0-9]{0,63}$'
     OR coalesce(device_hash, '') !~ '^[a-f0-9]{64}$'
     OR requested_key IS NULL THEN
    RAISE EXCEPTION 'imei_attempt_claim_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO private.imei_attempt_claims (merchant_id, customer_id, tier, imei_hash, idempotency_key)
    VALUES (merchant, customer, tier_name, device_hash, requested_key)
    ON CONFLICT (merchant_id, customer_id, tier, imei_hash) DO NOTHING;
  SELECT c.idempotency_key INTO current_key FROM private.imei_attempt_claims c
    WHERE c.merchant_id = merchant AND c.customer_id = customer
      AND c.tier = tier_name AND c.imei_hash = device_hash FOR UPDATE;
  -- Recover only Sickw attempts with conclusive, matching ledger evidence.
  -- A provider response is not reconstructed; the cached error states only
  -- the confirmed refund. Concurrent callers serialize on the claim row.
  UPDATE public.imei_lookups AS l
     SET status = 'refunded_error', cached_status = 502,
         cached_response = jsonb_build_object('success', false, 'status', 'error',
           'code', 'SICKW_UNAVAILABLE', 'error', 'Lookup failed; your wallet was refunded.')
   WHERE l.customer_id = customer AND l.merchant_id = merchant
     AND l.tier = tier_name AND l.imei_hash = device_hash
     AND l.provider = 'sickw' AND l.status IN ('pending', 'refund_pending')
     AND EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
       WHERE t.source_type = 'imei_wallet_payment' AND t.type = 'redemption'
         AND t.status = 'completed' AND t.source_id = l.id
         AND t.customer_id = customer AND t.merchant_id = merchant AND t.amount = l.amount_ngn)
     AND EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
       WHERE t.source_type = 'imei_wallet_refund' AND t.type = 'refund'
         AND t.status = 'completed' AND t.source_id = l.id
         AND t.customer_id = customer AND t.merchant_id = merchant AND t.amount = l.amount_ngn);
  -- Historical attempts may include more than one unresolved row. Never
  -- advance to a fresh debit until every earlier matching attempt is settled.
  SELECT l.idempotency_key INTO unresolved_key FROM public.imei_lookups l
    WHERE l.customer_id = customer AND l.merchant_id = merchant
      AND l.tier = tier_name AND l.imei_hash = device_hash
      AND l.status IN ('pending', 'provider_submitting', 'pending_provider', 'submission_unknown', 'refund_pending')
    ORDER BY l.created_at ASC, l.id ASC LIMIT 1;
  IF unresolved_key IS NOT NULL THEN
    IF unresolved_key IS DISTINCT FROM current_key THEN
      UPDATE private.imei_attempt_claims SET idempotency_key = unresolved_key
        WHERE merchant_id = merchant AND customer_id = customer
          AND tier = tier_name AND imei_hash = device_hash;
    END IF;
    RETURN jsonb_build_object('idempotency_key', unresolved_key);
  END IF;
  -- A repeat is a compare-and-swap against the exact confirmed prior report.
  -- Unknown and in-flight attempts can never be replaced.
  IF requested_key IS DISTINCT FROM current_key AND EXISTS (
    SELECT 1 FROM public.imei_lookups l
      WHERE l.idempotency_key = current_key
        AND l.customer_id = customer AND l.merchant_id = merchant
        AND l.tier = tier_name AND l.imei_hash = device_hash
        AND l.cached_response IS NOT NULL AND l.cached_status IS NOT NULL
        AND (
          (l.status = 'wallet_rejected' AND l.cached_status = 402
            AND l.cached_response->>'code' = 'WALLET_INSUFFICIENT'
            AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
              WHERE t.source_type='imei_wallet_payment' AND t.type='redemption'
                AND t.source_id=l.id AND t.customer_id=customer AND t.merchant_id=merchant))
          OR (l.status IN ('refunded_error', 'refunded_not_found')
            AND l.cached_response->>'success' = 'false'
            AND EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
              WHERE t.source_type='imei_wallet_payment' AND t.type='redemption'
                AND t.source_id=l.id AND t.customer_id=customer AND t.merchant_id=merchant AND t.amount=l.amount_ngn)
            AND EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
              WHERE t.source_type='imei_wallet_refund' AND t.type='refund'
                AND t.source_id=l.id AND t.customer_id=customer AND t.merchant_id=merchant AND t.amount=l.amount_ngn))
          OR (l.status = 'completed' AND l.id = previous_lookup
            AND l.cached_response->>'success' = 'true' AND l.cached_status BETWEEN 200 AND 299
            AND EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
              WHERE t.source_type='imei_wallet_payment' AND t.type='redemption'
                AND t.source_id=l.id AND t.customer_id=customer AND t.merchant_id=merchant AND t.amount=l.amount_ngn))
        )
  ) THEN
    UPDATE private.imei_attempt_claims SET idempotency_key = requested_key
      WHERE merchant_id = merchant AND customer_id = customer
        AND tier = tier_name AND imei_hash = device_hash;
    current_key := requested_key;
  END IF;
  RETURN jsonb_build_object('idempotency_key', current_key);
END $$;
REVOKE ALL ON FUNCTION public.imei_claim_attempt(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.imei_claim_attempt(text, text) TO authenticated;

