BEGIN;

CREATE TABLE piggyvest_staging.created_customer_provenance (
  intent_id uuid PRIMARY KEY REFERENCES piggyvest_staging.provisioning_intents(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  expected_business_id text COLLATE "C" NOT NULL,
  provider_customer_id text COLLATE "C" NOT NULL,
  provider_wallet_id text COLLATE "C" NOT NULL,
  request_fingerprint bytea NOT NULL CHECK (pg_catalog.octet_length(request_fingerprint) = 32),
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX created_customer_provenance_integration_idx ON piggyvest_staging.created_customer_provenance(integration_id);
CREATE INDEX created_customer_provenance_merchant_idx ON piggyvest_staging.created_customer_provenance(merchant_id);
CREATE INDEX created_customer_provenance_customer_idx ON piggyvest_staging.created_customer_provenance(customer_id);
ALTER TABLE piggyvest_staging.created_customer_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY created_customer_provenance_deny ON piggyvest_staging.created_customer_provenance
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE piggyvest_staging.created_customer_provenance FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_staging.guard_created_customer_provenance()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'immutable customer creation provenance' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER guard_created_customer_provenance_rows
  BEFORE UPDATE OR DELETE ON piggyvest_staging.created_customer_provenance
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.guard_created_customer_provenance();
CREATE TRIGGER guard_created_customer_provenance_truncate
  BEFORE TRUNCATE ON piggyvest_staging.created_customer_provenance
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_staging.guard_created_customer_provenance();

CREATE FUNCTION piggyvest_staging.record_created_customer(
  p_integration_id uuid, p_merchant_id uuid, p_intent_id uuid, p_claim_token uuid,
  p_expected_business_id text, p_provider_customer_id text, p_provider_wallet_id text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  recorded_outcome text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
    OR p_integration_id IS NULL OR p_merchant_id IS NULL OR p_intent_id IS NULL OR p_claim_token IS NULL
    OR p_expected_business_id IS NULL OR pg_catalog.octet_length(p_expected_business_id) NOT BETWEEN 1 AND 512
    OR p_provider_customer_id IS NULL OR pg_catalog.octet_length(p_provider_customer_id) NOT BETWEEN 1 AND 512
    OR p_provider_wallet_id IS NULL OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid created customer acknowledgement' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    JOIN piggyvest_staging.provisioning_integrations AS binding ON binding.integration_id = registry.id
    WHERE registry.id = p_integration_id AND registry.enabled AND binding.enabled
      AND binding.merchant_id = p_merchant_id
      AND registry.expected_provider_account_id = p_expected_business_id COLLATE "C"
      AND binding.expected_provider_account_id = p_expected_business_id COLLATE "C"
    FOR UPDATE OF registry FOR SHARE OF binding;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM entry.id FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id AND entry.merchant_id = p_merchant_id
      AND entry.operation = 'create_customer' AND entry.status = 'dispatched'
      AND entry.claim_token = p_claim_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  recorded_outcome := piggyvest_staging.record_provisioning_result(
    p_integration_id, p_merchant_id, p_intent_id, p_claim_token, 'accepted', p_provider_customer_id, p_provider_wallet_id);
  IF recorded_outcome <> 'awaiting_confirmation' THEN RETURN recorded_outcome; END IF;
  INSERT INTO piggyvest_staging.created_customer_provenance (
    intent_id, integration_id, merchant_id, customer_id, expected_business_id,
    provider_customer_id, provider_wallet_id, request_fingerprint)
    SELECT entry.id, entry.integration_id, entry.merchant_id, entry.customer_id, p_expected_business_id,
      entry.provider_customer_id, entry.provider_wallet_id, entry.request_fingerprint
    FROM piggyvest_staging.provisioning_intents AS entry WHERE entry.id = p_intent_id;
  RETURN 'awaiting_confirmation';
END $$;

CREATE FUNCTION piggyvest_staging.has_created_customer_provenance(p_intent_id uuid, p_expected_business_id text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM piggyvest_staging.created_customer_provenance AS proof
    JOIN piggyvest_staging.provisioning_intents AS entry ON entry.id = proof.intent_id
    WHERE proof.intent_id = p_intent_id AND proof.expected_business_id = p_expected_business_id COLLATE "C"
      AND entry.operation = 'create_customer' AND entry.status = 'awaiting_confirmation' AND entry.result_code = 'accepted'
      AND entry.integration_id = proof.integration_id AND entry.merchant_id = proof.merchant_id
      AND entry.customer_id = proof.customer_id AND entry.provider_customer_id = proof.provider_customer_id
      AND entry.provider_wallet_id = proof.provider_wallet_id AND entry.request_fingerprint = proof.request_fingerprint);
$$;

REVOKE ALL ON FUNCTION piggyvest_staging.guard_created_customer_provenance(),
  piggyvest_staging.has_created_customer_provenance(uuid, text),
  piggyvest_staging.record_created_customer(uuid, uuid, uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.record_created_customer(uuid, uuid, uuid, uuid, text, text, text) IS
  'Restricted new proof path ONLY for a freshly validated create_customer success with new_customer=true from the single canonical POST. Args integration,merchant,intent,claim token,expected business,provider customer,provider wallet. Caller must never use for false/missing/newly guessed provenance. Atomically records accepted result and immutable exact request/identity/ack receipt. Requires live original dispatch token; legacy accepted/unknown rows cannot be retroactively trusted. Wait for COMMIT; no automatic replay or resend on uncertainty. No provider call, mapping, funds or completion.';
COMMENT ON TABLE piggyvest_staging.created_customer_provenance IS
  'Immutable receipt of new_customer=true acknowledgement from dedicated restricted recording path; not a retroactive migration/backfill. Exact intent/integration/merchant/customer/request fingerprint/business/provider IDs. No KYC or raw response storage. No caller table grants.';

COMMIT;
