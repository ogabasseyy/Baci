BEGIN;

CREATE TABLE piggyvest_staging.provisioning_recovery_verifications (
  intent_id uuid PRIMARY KEY REFERENCES piggyvest_staging.provisioning_intents(id),
  verification_token uuid NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
  expected_business_id text COLLATE "C" NOT NULL,
  request_fingerprint bytea NOT NULL CHECK (pg_catalog.octet_length(request_fingerprint) = 32),
  provider_wallet_id text COLLATE "C" NOT NULL,
  provider_customer_id text COLLATE "C" NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp() + interval '60 seconds',
  completed_at timestamptz,
  CHECK (expires_at > issued_at),
  CHECK (completed_at IS NULL OR completed_at >= issued_at)
);
ALTER TABLE piggyvest_staging.provisioning_recovery_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY provisioning_recovery_verifications_deny ON piggyvest_staging.provisioning_recovery_verifications
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE piggyvest_staging.provisioning_recovery_verifications FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_staging.begin_provisioning_verification(
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
  IF recovered.operation <> 'create_plan_wallet'
    OR recovered.provider_customer_id IS DISTINCT FROM recovered.dispatch_provider_customer_id
    OR NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
      WHERE mapping.integration_id = p_integration_id AND mapping.merchant_id = p_merchant_id
        AND mapping.customer_id = p_customer_id AND mapping.provider_customer_id = recovered.provider_customer_id) THEN
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

REVOKE ALL ON FUNCTION piggyvest_staging.begin_provisioning_verification(uuid, uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE piggyvest_staging.provisioning_recovery_verifications IS
  'Private bounded verification snapshot and durable plan completion receipt, one per immutable intent. Completion lives here to preserve legacy intent state and existing claim/customer-correlation APIs; awaiting_confirmation plus completed_at means resource provisioning completed, never funds finality. Customer acknowledgements lack creation provenance and cannot complete here.';
COMMENT ON FUNCTION piggyvest_staging.begin_provisioning_verification(uuid, uuid, uuid, uuid, uuid, text) IS
  'Commit before one bounded GET of the returned wallet. Only accepted plan acknowledgements with immutable dispatch customer backed by an existing trusted mapping qualify; customer acknowledgements alone lack new_customer provenance. Snapshot binds exact intent, fingerprint, customer, wallet and business for 60 seconds. Reissue invalidates earlier token. Enabled current registry/binding and local scope rechecked under locks. Already completed receipt returns without new token or provider call. Internal restricted caller only; token is never public authorization.';

COMMIT;
