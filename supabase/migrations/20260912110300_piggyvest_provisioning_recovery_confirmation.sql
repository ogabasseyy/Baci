BEGIN;

CREATE FUNCTION piggyvest_staging.confirm_provisioning_recovery(
  p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid,
  p_intent_id uuid, p_expected_business_id text, p_verification_token uuid,
  p_wallet_id text, p_business_id text, p_currency text, p_wallet_status text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  recovered record;
  snapshot record;
  stored_fingerprint bytea;
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
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT entry.intent_id, entry.status, entry.operation, entry.provider_customer_id,
    entry.provider_wallet_id, entry.dispatch_provider_customer_id INTO recovered
    FROM piggyvest_staging.read_provisioning_recovery(
      p_integration_id, p_merchant_id, p_customer_id, p_goal_id, p_intent_id, p_expected_business_id) AS entry;
  IF NOT FOUND OR recovered.status <> 'awaiting_confirmation' THEN RETURN 'stale'; END IF;
  IF recovered.operation <> 'create_plan_wallet'
    OR recovered.provider_customer_id IS DISTINCT FROM recovered.dispatch_provider_customer_id
    OR NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
      WHERE mapping.integration_id = p_integration_id AND mapping.merchant_id = p_merchant_id
        AND mapping.customer_id = p_customer_id AND mapping.provider_customer_id = recovered.provider_customer_id) THEN
    RETURN 'ownership_unverified';
  END IF;
  SELECT verification.verification_token, verification.expected_business_id,
    verification.provider_wallet_id, verification.provider_customer_id, verification.request_fingerprint,
    verification.issued_at, verification.expires_at, verification.completed_at INTO snapshot
    FROM piggyvest_staging.provisioning_recovery_verifications AS verification
    WHERE verification.intent_id = p_intent_id FOR UPDATE;
  IF NOT FOUND OR p_verification_token IS DISTINCT FROM snapshot.verification_token THEN RETURN 'stale'; END IF;
  SELECT entry.request_fingerprint INTO stored_fingerprint FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.id = p_intent_id;
  IF snapshot.expected_business_id IS DISTINCT FROM p_expected_business_id
    OR snapshot.provider_wallet_id IS DISTINCT FROM recovered.provider_wallet_id
    OR snapshot.provider_customer_id IS DISTINCT FROM recovered.provider_customer_id
    OR snapshot.request_fingerprint IS DISTINCT FROM stored_fingerprint THEN RETURN 'stale'; END IF;
  IF snapshot.completed_at IS NOT NULL THEN RETURN 'completed'; END IF;
  IF snapshot.issued_at > pg_catalog.clock_timestamp() OR snapshot.expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN 'stale';
  END IF;
  IF p_wallet_id IS DISTINCT FROM snapshot.provider_wallet_id COLLATE "C"
    OR p_business_id IS DISTINCT FROM snapshot.expected_business_id COLLATE "C"
    OR p_currency IS DISTINCT FROM 'NGN' COLLATE "C" THEN RETURN 'wallet_mismatch'; END IF;
  IF p_wallet_status IS DISTINCT FROM 'active' COLLATE "C" THEN RETURN 'wallet_not_active'; END IF;
  IF recovered.operation = 'create_plan_wallet' THEN
    IF recovered.dispatch_provider_customer_id IS DISTINCT FROM recovered.provider_customer_id
      OR NOT piggyvest_staging.provisioning_customer_reference_matches(
        p_integration_id, p_merchant_id, p_customer_id, recovered.provider_customer_id) THEN
      RETURN 'ownership_unverified';
    END IF;
    BEGIN
      INSERT INTO piggyvest_staging.wallet_goal_mappings (
        integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
        VALUES (p_integration_id, recovered.provider_wallet_id, recovered.provider_customer_id,
          p_merchant_id, p_customer_id, p_goal_id) ON CONFLICT DO NOTHING;
      IF NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
        WHERE mapping.integration_id = p_integration_id AND mapping.provider_wallet_id = recovered.provider_wallet_id
          AND mapping.provider_customer_id = recovered.provider_customer_id AND mapping.merchant_id = p_merchant_id
          AND mapping.customer_id = p_customer_id AND mapping.goal_id = p_goal_id) THEN
        RETURN 'mapping_conflict';
      END IF;
    EXCEPTION WHEN check_violation OR unique_violation THEN RETURN 'mapping_conflict';
    END;
  END IF;
  UPDATE piggyvest_staging.provisioning_recovery_verifications SET completed_at = pg_catalog.clock_timestamp()
    WHERE intent_id = p_intent_id;
  RETURN 'completed';
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.confirm_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.confirm_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, text) IS
  'Restricted plan confirmation: token-fenced POST acknowledgement binds wallet ID to immutable dispatched customer backed by a preexisting trusted mapping; GET checks readiness/business/currency. Historical customer acknowledgements lack new_customer provenance and cannot establish that mapping. GET alone or unknown references never establish ownership. Requires fresh 60-second snapshot token and exact current acknowledgement/configuration/local scope. Atomic plan mapping plus completion receipt; no balance, funding, ledger or financial finality. Restricted internal verifier supplies actual GET projection, never raw request-selected IDs. GET must start after snapshot COMMIT; no automatic uncertain-COMMIT replay.';

COMMIT;
