-- One canonical paid attempt per authenticated customer, service and device.
-- The signed server boundary chooses the fingerprint; clients never choose a tenant.
CREATE TABLE IF NOT EXISTS private.imei_attempt_claims (
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  tier text NOT NULL,
  imei_hash text NOT NULL CHECK (imei_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid NOT NULL UNIQUE,
  PRIMARY KEY (merchant_id, customer_id, tier, imei_hash)
);
ALTER TABLE private.imei_attempt_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.imei_attempt_claims FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS imei_attempt_claims_no_direct_access ON private.imei_attempt_claims;
CREATE POLICY imei_attempt_claims_no_direct_access ON private.imei_attempt_claims
  AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_imei_lookups_unresolved_fingerprint
  ON public.imei_lookups (merchant_id, customer_id, tier, imei_hash, created_at, id)
  WHERE status IN ('pending', 'provider_submitting', 'pending_provider', 'submission_unknown', 'refund_pending');

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

-- Fence legacy route instances and old app versions during the deployment.
-- A signed gateway insertion must use the current claim for the fingerprint.
CREATE OR REPLACE FUNCTION private.guard_imei_attempt_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE allowed_key uuid; unresolved_key uuid;
BEGIN
  INSERT INTO private.imei_attempt_claims (merchant_id, customer_id, tier, imei_hash, idempotency_key)
    VALUES (NEW.merchant_id, NEW.customer_id, NEW.tier, NEW.imei_hash, NEW.idempotency_key)
    ON CONFLICT (merchant_id, customer_id, tier, imei_hash) DO NOTHING;
  SELECT c.idempotency_key INTO allowed_key FROM private.imei_attempt_claims c
    WHERE c.merchant_id = NEW.merchant_id AND c.customer_id = NEW.customer_id
      AND c.tier = NEW.tier AND c.imei_hash = NEW.imei_hash FOR UPDATE;
  SELECT l.idempotency_key INTO unresolved_key FROM public.imei_lookups l
    WHERE l.merchant_id = NEW.merchant_id AND l.customer_id = NEW.customer_id
      AND l.tier = NEW.tier AND l.imei_hash = NEW.imei_hash
      AND l.status IN ('pending', 'provider_submitting', 'pending_provider', 'submission_unknown', 'refund_pending')
    ORDER BY l.created_at ASC, l.id ASC LIMIT 1;
  IF allowed_key IS DISTINCT FROM NEW.idempotency_key OR
     (unresolved_key IS NOT NULL AND unresolved_key IS DISTINCT FROM NEW.idempotency_key) THEN
    RAISE EXCEPTION 'imei_attempt_claim_conflict' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_imei_attempt_insert() FROM PUBLIC, anon, authenticated, service_role;
-- Block old writers while taking the backfill snapshot and installing the
-- fence. The DO block is atomic even when a migration runner does not wrap the
-- entire file in an explicit transaction.
DO $cutover$
BEGIN
  LOCK TABLE public.imei_lookups IN SHARE ROW EXCLUSIVE MODE;
-- Preserve the most recent historical attempt for each fingerprint, including
-- completed attempts whose response may not have reached the customer.
INSERT INTO private.imei_attempt_claims (merchant_id, customer_id, tier, imei_hash, idempotency_key)
SELECT DISTINCT ON (merchant_id, customer_id, tier, imei_hash)
  merchant_id, customer_id, tier, imei_hash, idempotency_key
FROM public.imei_lookups
ORDER BY merchant_id, customer_id, tier, imei_hash,
  CASE WHEN status IN ('pending', 'provider_submitting', 'pending_provider', 'submission_unknown', 'refund_pending') THEN 0 ELSE 1 END,
  CASE WHEN status IN ('pending', 'provider_submitting', 'pending_provider', 'submission_unknown', 'refund_pending') THEN created_at END ASC,
  created_at DESC, id DESC
ON CONFLICT DO NOTHING;

  EXECUTE 'DROP TRIGGER IF EXISTS guard_imei_attempt_insert ON public.imei_lookups';
  EXECUTE 'CREATE TRIGGER guard_imei_attempt_insert BEFORE INSERT ON public.imei_lookups FOR EACH ROW EXECUTE FUNCTION private.guard_imei_attempt_insert()';
END $cutover$;
