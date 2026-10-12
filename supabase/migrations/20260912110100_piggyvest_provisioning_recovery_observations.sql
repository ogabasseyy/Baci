BEGIN;

CREATE TABLE piggyvest_staging.provisioning_recovery_observations (
  intent_id uuid NOT NULL REFERENCES piggyvest_staging.provisioning_intents(id),
  outcome text NOT NULL CHECK (outcome IN (
    'ownership_unverified', 'wallet_mismatch', 'wallet_not_active', 'lookup_unavailable', 'missing_reference')),
  first_observed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (intent_id, outcome)
);
ALTER TABLE piggyvest_staging.provisioning_recovery_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY provisioning_recovery_observations_deny ON piggyvest_staging.provisioning_recovery_observations
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE piggyvest_staging.provisioning_recovery_observations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_staging.observe_provisioning_recovery(
  p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid,
  p_intent_id uuid, p_expected_business_id text,
  p_wallet_id text, p_business_id text, p_currency text, p_wallet_status text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  recovered record;
  observation_outcome text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'recovery requires READ COMMITTED' USING ERRCODE = '22023';
  END IF;
  IF NOT ((p_wallet_id IS NULL AND p_business_id IS NULL AND p_currency IS NULL AND p_wallet_status IS NULL)
    OR (p_wallet_id IS NOT NULL AND p_business_id IS NOT NULL AND p_currency IS NOT NULL AND p_wallet_status IS NOT NULL
      AND pg_catalog.octet_length(p_wallet_id) BETWEEN 1 AND 512
      AND pg_catalog.octet_length(p_business_id) BETWEEN 1 AND 512
      AND pg_catalog.octet_length(p_currency) BETWEEN 1 AND 64
      AND pg_catalog.octet_length(p_wallet_status) BETWEEN 1 AND 256)) THEN
    RAISE EXCEPTION 'invalid recovery observation' USING ERRCODE = '22023';
  END IF;
  SELECT entry.intent_id, entry.provider_wallet_id INTO recovered
    FROM piggyvest_staging.read_provisioning_recovery(
      p_integration_id, p_merchant_id, p_customer_id, p_goal_id, p_intent_id, p_expected_business_id) AS entry;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  observation_outcome := CASE
    WHEN recovered.provider_wallet_id IS NULL THEN 'missing_reference'
    WHEN p_wallet_id IS NULL THEN 'lookup_unavailable'
    WHEN p_wallet_id IS DISTINCT FROM recovered.provider_wallet_id COLLATE "C"
      OR p_business_id IS DISTINCT FROM p_expected_business_id COLLATE "C"
      OR p_currency IS DISTINCT FROM 'NGN' COLLATE "C" THEN 'wallet_mismatch'
    WHEN p_wallet_status IS DISTINCT FROM 'active' COLLATE "C" THEN 'wallet_not_active'
    ELSE 'ownership_unverified' END;
  INSERT INTO piggyvest_staging.provisioning_recovery_observations (intent_id, outcome)
    VALUES (p_intent_id, observation_outcome) ON CONFLICT (intent_id, outcome) DO NOTHING;
  RETURN observation_outcome;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.observe_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE piggyvest_staging.provisioning_recovery_observations IS
  'Bounded private observational audit: at most five distinct outcomes per intent, duplicate observations do not rewrite history. No raw provider bodies, balances, KYC, supplied references, or financial effects. An active matching wallet proves neither customer ownership nor a completed provisioning operation.';
COMMENT ON FUNCTION piggyvest_staging.observe_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text) IS
  'Scoped observational reconciliation only. First six arguments match recovery read; final four are projected wallet GET id,business_id,currency,status, or all NULL for failed/no lookup. Wallet GET lacks customer identity and request correlation; even exact active match returns ownership_unverified. No completed state, mapping, intent mutation, resend or funding effect. Rejects partial observations; rechecks scope/account under locks. Caller must wait for acknowledged COMMIT before reporting durability, never retry an uncertain commit automatically. No caller grants in this migration.';

COMMIT;
