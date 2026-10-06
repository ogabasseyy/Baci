BEGIN;

ALTER TABLE piggyvest_staging.provisioning_intents
  ADD COLUMN dispatch_provider_customer_id text COLLATE "C"
    CHECK (pg_catalog.octet_length(dispatch_provider_customer_id) BETWEEN 1 AND 512),
  ADD CONSTRAINT provisioning_dispatch_customer_shape CHECK (
    ((operation = 'create_customer' OR status = 'pending') AND dispatch_provider_customer_id IS NULL)
    OR (operation = 'create_plan_wallet' AND status <> 'pending' AND dispatch_provider_customer_id IS NOT NULL));

CREATE FUNCTION piggyvest_staging.provisioning_customer_reference_matches(
  p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_provider_customer_id text
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT p_provider_customer_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
      WHERE mapping.integration_id = p_integration_id AND mapping.merchant_id = p_merchant_id
        AND mapping.customer_id = p_customer_id AND mapping.provider_customer_id = p_provider_customer_id)
    OR EXISTS (SELECT 1 FROM piggyvest_staging.provisioning_intents AS entry
      WHERE entry.integration_id = p_integration_id AND entry.merchant_id = p_merchant_id
        AND entry.customer_id = p_customer_id AND entry.operation = 'create_customer'
        AND entry.status = 'awaiting_confirmation' AND entry.provider_customer_id = p_provider_customer_id))
    AND NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
      WHERE mapping.integration_id = p_integration_id
        AND ((mapping.provider_customer_id = p_provider_customer_id AND mapping.customer_id <> p_customer_id)
          OR (mapping.customer_id = p_customer_id AND mapping.provider_customer_id <> p_provider_customer_id)))
    AND NOT EXISTS (SELECT 1 FROM piggyvest_staging.provisioning_intents AS entry
      WHERE entry.integration_id = p_integration_id AND entry.provider_customer_id IS NOT NULL
        AND ((entry.provider_customer_id = p_provider_customer_id AND entry.customer_id <> p_customer_id)
          OR (entry.customer_id = p_customer_id AND entry.provider_customer_id <> p_provider_customer_id)));
$$;

CREATE FUNCTION piggyvest_staging.guard_provisioning_dispatch_customer()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.dispatch_provider_customer_id IS DISTINCT FROM OLD.dispatch_provider_customer_id THEN
    RAISE EXCEPTION 'immutable provisioning dispatch customer' USING ERRCODE = '23514';
  END IF;
  IF NEW.operation = 'create_plan_wallet' THEN
    IF NEW.status = 'dispatched' AND NOT piggyvest_staging.provisioning_customer_reference_matches(
      NEW.integration_id, NEW.merchant_id, NEW.customer_id, NEW.dispatch_provider_customer_id) THEN
      RAISE EXCEPTION 'unbound provisioning dispatch customer' USING ERRCODE = '23514';
    END IF;
    IF (NEW.status = 'awaiting_confirmation' OR NEW.provider_customer_id IS NOT NULL)
      AND NEW.provider_customer_id IS DISTINCT FROM NEW.dispatch_provider_customer_id THEN
      RAISE EXCEPTION 'conflicting provisioning dispatch customer' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_provisioning_dispatch_customer_rows
  BEFORE UPDATE ON piggyvest_staging.provisioning_intents
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.guard_provisioning_dispatch_customer();

DROP FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer, text);
CREATE FUNCTION piggyvest_staging.claim_provisioning_intent(
  p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid, p_lease_seconds integer,
  p_expected_provider_account_id text, p_expected_provider_customer_id text
) RETURNS TABLE (
  intent_id uuid, operation text, merchant_id uuid, customer_id uuid, goal_id uuid,
  request_fingerprint bytea, claim_token uuid, attempts integer, lease_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  stored_customer_id uuid;
  stored_goal_id uuid;
  stored_operation text;
BEGIN
  IF p_integration_id IS NULL OR p_expected_merchant_id IS NULL OR p_intent_id IS NULL
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300
    OR p_expected_provider_account_id IS NULL
    OR pg_catalog.octet_length(p_expected_provider_account_id) NOT BETWEEN 1 AND 512
    OR (p_expected_provider_customer_id IS NOT NULL
      AND pg_catalog.octet_length(p_expected_provider_customer_id) NOT BETWEEN 1 AND 512) THEN
    RAISE EXCEPTION 'invalid provisioning claim' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration_id AND registry.enabled
      AND registry.expected_provider_account_id = p_expected_provider_account_id COLLATE "C" FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT entry.customer_id, entry.goal_id, entry.operation INTO stored_customer_id, stored_goal_id, stored_operation
    FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
      AND entry.merchant_id = p_expected_merchant_id AND entry.status = 'pending' AND entry.attempts = 0;
  IF NOT FOUND THEN RETURN; END IF;
  IF (stored_operation = 'create_customer' AND p_expected_provider_customer_id IS NOT NULL)
    OR (stored_operation = 'create_plan_wallet' AND NOT piggyvest_staging.provisioning_customer_reference_matches(
      p_integration_id, p_expected_merchant_id, stored_customer_id, p_expected_provider_customer_id)) THEN RETURN; END IF;
  IF NOT piggyvest_staging.provisioning_owner_matches(
    p_integration_id, p_expected_merchant_id, stored_customer_id, stored_goal_id) THEN RETURN; END IF;
  RETURN QUERY WITH candidate AS MATERIALIZED (
    SELECT entry.id FROM piggyvest_staging.provisioning_intents AS entry
      WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
        AND entry.merchant_id = p_expected_merchant_id AND entry.status = 'pending' AND entry.attempts = 0
      FOR UPDATE SKIP LOCKED
  )
  UPDATE piggyvest_staging.provisioning_intents AS entry SET
    status = 'dispatched', attempts = 1, claim_token = pg_catalog.gen_random_uuid(),
    dispatch_provider_customer_id = p_expected_provider_customer_id,
    lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
    updated_at = pg_catalog.clock_timestamp()
    FROM candidate WHERE entry.id = candidate.id
    RETURNING entry.id, entry.operation, entry.merchant_id, entry.customer_id, entry.goal_id,
      entry.request_fingerprint, entry.claim_token, entry.attempts, entry.lease_expires_at;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.provisioning_customer_reference_matches(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.guard_provisioning_dispatch_customer()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer, text, text) IS
  'Final owner-only claim API: integration,expected merchant,intent UUIDs,lease seconds 1..300,expected business/account ID,expected provider customer ID. Customer ID must be NULL for create_customer; plan wallet requires a matching existing wallet_goal_mapping or acknowledged local create_customer intent in this integration. This proves internal correlation only, not provider readiness. Dispatch customer is persisted immutably and accepted wallet results must record that same ID. Exact enabled registry account and current local ownership are required. Returns zero or one row: intent_id,operation,merchant_id,customer_id,goal_id,request_fingerprint,claim_token,attempts,lease_expires_at. Commit prepare then commit claim before a single POST; no dispatch on ambiguous COMMIT, no HTTP retry or expired reclaim. intent_id is application identity only; recompute/compare HMAC before claim.';
COMMENT ON COLUMN piggyvest_staging.provisioning_intents.dispatch_provider_customer_id IS
  'Private canonical provider customer reference verified before plan-wallet dispatch. Immutable after first claim; provider acknowledgement must match. No credential or KYC data.';

COMMIT;
