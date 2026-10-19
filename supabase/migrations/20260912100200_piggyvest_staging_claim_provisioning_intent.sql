BEGIN;

CREATE FUNCTION piggyvest_staging.claim_provisioning_intent(
  p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid, p_lease_seconds integer
) RETURNS TABLE (
  intent_id uuid, operation text, merchant_id uuid, customer_id uuid, goal_id uuid,
  request_fingerprint bytea, claim_token uuid, attempts integer, lease_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  stored_customer_id uuid;
  stored_goal_id uuid;
BEGIN
  IF p_integration_id IS NULL OR p_expected_merchant_id IS NULL OR p_intent_id IS NULL
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid provisioning claim' USING ERRCODE = '22023';
  END IF;
  SELECT entry.customer_id, entry.goal_id INTO stored_customer_id, stored_goal_id
    FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
      AND entry.merchant_id = p_expected_merchant_id AND entry.status = 'pending' AND entry.attempts = 0;
  IF NOT FOUND THEN RETURN; END IF;
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
    lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
    updated_at = pg_catalog.clock_timestamp()
    FROM candidate WHERE entry.id = candidate.id
    RETURNING entry.id, entry.operation, entry.merchant_id, entry.customer_id, entry.goal_id,
      entry.request_fingerprint, entry.claim_token, entry.attempts, entry.lease_expires_at;
END $$;

CREATE FUNCTION piggyvest_staging.expire_provisioning_claim(
  p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_integration_id IS NULL OR p_expected_merchant_id IS NULL OR p_intent_id IS NULL THEN
    RAISE EXCEPTION 'invalid provisioning expiry' USING ERRCODE = '22023';
  END IF;
  UPDATE piggyvest_staging.provisioning_intents AS entry SET
    status = 'unknown', result_code = 'lease_expired', claim_token = NULL, lease_expires_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
      AND entry.merchant_id = p_expected_merchant_id AND entry.status = 'dispatched'
      AND entry.lease_expires_at <= pg_catalog.clock_timestamp();
  IF FOUND THEN RETURN 'unknown'; END IF;
  RETURN 'stale';
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.expire_provisioning_claim(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer) IS
  'Owner-only first-dispatch permit. integration,expected merchant,intent UUIDs,lease seconds 1..300. Returns zero or one row: intent_id,operation,merchant_id,customer_id,goal_id,request_fingerprint,claim_token,attempts,lease_expires_at. Claim commits before external POST; executor must resolve only after COMMIT and must never dispatch on ambiguous commit or retry HTTP. Exactly one attempt for the lifetime of this identity, even if no POST actually reached provider. Empty on disabled/stale ownership, tenant mismatch, concurrent claim, or any previous attempt. Rebuild and compare canonical non-sensitive fingerprint before claiming. Local intent UUID is only an application request ID; do not assume provider idempotency.';
COMMENT ON FUNCTION piggyvest_staging.expire_provisioning_claim(uuid, uuid, uuid) IS
  'Owner-only reconciliation marker: integration,expected merchant,intent UUIDs. Expired dispatched becomes unknown and invalidates token; otherwise stale. Works after disabling registry or local ownership changes to preserve dispatch uncertainty. Never resets attempts or enables resend. No completed transition exists.';

COMMIT;
