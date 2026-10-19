BEGIN;

CREATE FUNCTION piggyvest_staging.recovery_customer_is_trusted(
  p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_provider_customer_id text, p_expected_business_id text
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
    WHERE mapping.integration_id = p_integration_id AND mapping.merchant_id = p_merchant_id
      AND mapping.customer_id = p_customer_id AND mapping.provider_customer_id = p_provider_customer_id)
  OR EXISTS (SELECT 1 FROM piggyvest_staging.created_customer_provenance AS proof
    JOIN piggyvest_staging.provisioning_recovery_verifications AS verification ON verification.intent_id = proof.intent_id
    WHERE proof.integration_id = p_integration_id AND proof.merchant_id = p_merchant_id
      AND proof.customer_id = p_customer_id AND proof.provider_customer_id = p_provider_customer_id
      AND proof.expected_business_id = p_expected_business_id COLLATE "C"
      AND verification.completed_at IS NOT NULL
      AND verification.expected_business_id = proof.expected_business_id
      AND verification.provider_wallet_id = proof.provider_wallet_id
      AND verification.provider_customer_id = proof.provider_customer_id
      AND verification.request_fingerprint = proof.request_fingerprint
      AND piggyvest_staging.has_created_customer_provenance(proof.intent_id, p_expected_business_id));
$$;

CREATE OR REPLACE FUNCTION piggyvest_staging.begin_provisioning_verification(
  p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid,
  p_intent_id uuid, p_expected_business_id text
) RETURNS TABLE (verification_token uuid, provider_wallet_id text, completed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  recovered record;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'recovery requires READ COMMITTED' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    JOIN piggyvest_staging.provisioning_integrations AS binding ON binding.integration_id = registry.id
    WHERE registry.id = p_integration_id AND registry.enabled AND binding.enabled
      AND binding.merchant_id = p_merchant_id
      AND registry.expected_provider_account_id = p_expected_business_id COLLATE "C"
      AND binding.expected_provider_account_id = p_expected_business_id COLLATE "C"
    FOR UPDATE OF registry FOR SHARE OF binding;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT entry.intent_id, entry.status, entry.operation, entry.provider_customer_id,
    entry.provider_wallet_id, entry.dispatch_provider_customer_id INTO recovered
    FROM piggyvest_staging.read_provisioning_recovery(
      p_integration_id, p_merchant_id, p_customer_id, p_goal_id, p_intent_id, p_expected_business_id) AS entry;
  IF NOT FOUND OR recovered.status <> 'awaiting_confirmation'
    OR recovered.provider_customer_id IS NULL OR recovered.provider_wallet_id IS NULL THEN RETURN; END IF;
  IF (recovered.operation = 'create_customer' AND NOT piggyvest_staging.has_created_customer_provenance(
      p_intent_id, p_expected_business_id))
    OR (recovered.operation = 'create_plan_wallet' AND (
      recovered.provider_customer_id IS DISTINCT FROM recovered.dispatch_provider_customer_id
      OR NOT piggyvest_staging.recovery_customer_is_trusted(
        p_integration_id, p_merchant_id, p_customer_id, recovered.provider_customer_id, p_expected_business_id))) THEN
    RETURN;
  END IF;
  INSERT INTO piggyvest_staging.provisioning_recovery_verifications AS verification (
    intent_id, expected_business_id, request_fingerprint, provider_wallet_id, provider_customer_id)
    SELECT entry.id, p_expected_business_id, entry.request_fingerprint,
      entry.provider_wallet_id, entry.provider_customer_id
    FROM piggyvest_staging.provisioning_intents AS entry WHERE entry.id = p_intent_id
    ON CONFLICT (intent_id) DO UPDATE SET
      verification_token = pg_catalog.gen_random_uuid(), issued_at = pg_catalog.clock_timestamp(),
      expires_at = pg_catalog.clock_timestamp() + interval '60 seconds'
    WHERE verification.completed_at IS NULL;
  RETURN QUERY SELECT verification.verification_token, verification.provider_wallet_id,
    verification.completed_at IS NOT NULL
    FROM piggyvest_staging.provisioning_recovery_verifications AS verification WHERE verification.intent_id = p_intent_id;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.recovery_customer_is_trusted(uuid, uuid, uuid, text, text),
  piggyvest_staging.begin_provisioning_verification(uuid, uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.begin_provisioning_verification(uuid, uuid, uuid, uuid, uuid, text) IS
  'Scoped committed 60-second verification snapshot for accepted customer with dedicated immutable new_customer=true provenance, or accepted plan tied to immutable dispatch customer backed by an existing trusted mapping or completed proven customer receipt. Historical accepted customer alone never qualifies. Exact acknowledgement/fingerprint/business/local scope; token rotation fences prior verifier. GET only after COMMIT. No grants or provider effects.';
COMMENT ON TABLE piggyvest_staging.provisioning_recovery_verifications IS
  'Private exact acknowledgement verification snapshot and durable customer/plan completion receipt. Legacy intent status stays awaiting_confirmation; completed_at is the completion overlay. Customer completion requires immutable created_customer_provenance; no default wallet is assigned a plan. Plan completion inserts its mapping atomically. Never financial finality.';

COMMIT;

