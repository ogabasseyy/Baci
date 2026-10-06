BEGIN;

ALTER TABLE piggyvest_staging.provisioning_intents
  ADD COLUMN provider_customer_id text COLLATE "C"
    CHECK (pg_catalog.octet_length(provider_customer_id) BETWEEN 1 AND 512),
  ADD COLUMN provider_wallet_id text COLLATE "C"
    CHECK (pg_catalog.octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  ADD CONSTRAINT provisioning_pending_references_empty CHECK (
    status NOT IN ('pending', 'dispatched') OR (provider_customer_id IS NULL AND provider_wallet_id IS NULL)),
  ADD CONSTRAINT provisioning_acknowledged_references CHECK (
    status <> 'awaiting_confirmation' OR (provider_wallet_id IS NOT NULL
      AND (operation <> 'create_customer' OR provider_customer_id IS NOT NULL)));
CREATE INDEX piggyvest_staging_provisioning_provider_customer_idx
  ON piggyvest_staging.provisioning_intents (integration_id, provider_customer_id);
CREATE UNIQUE INDEX piggyvest_staging_provisioning_provider_wallet_unique
  ON piggyvest_staging.provisioning_intents (integration_id, provider_wallet_id) WHERE provider_wallet_id IS NOT NULL;

DROP FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer);
CREATE FUNCTION piggyvest_staging.claim_provisioning_intent(
  p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid, p_lease_seconds integer,
  p_expected_provider_account_id text
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
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300
    OR p_expected_provider_account_id IS NULL
    OR pg_catalog.octet_length(p_expected_provider_account_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid provisioning claim' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration_id AND registry.enabled
      AND registry.expected_provider_account_id = p_expected_provider_account_id COLLATE "C" FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
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

DROP FUNCTION piggyvest_staging.record_provisioning_result(uuid, uuid, uuid, uuid, text, bytea);
CREATE FUNCTION piggyvest_staging.record_provisioning_result(
  p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid,
  p_claim_token uuid, p_result_code text, p_provider_customer_id text, p_provider_wallet_id text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  stored_status text;
  stored_token uuid;
  stored_expiry timestamptz;
  stored_operation text;
  stored_customer_id uuid;
  next_status text;
BEGIN
  IF p_integration_id IS NULL OR p_expected_merchant_id IS NULL OR p_intent_id IS NULL
    OR p_claim_token IS NULL OR p_result_code IS NULL
    OR p_result_code NOT IN ('accepted', 'timeout', 'transport_error', 'rejected', 'ambiguous')
    OR (p_provider_customer_id IS NOT NULL AND pg_catalog.octet_length(p_provider_customer_id) NOT BETWEEN 1 AND 512)
    OR (p_provider_wallet_id IS NOT NULL AND pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512) THEN
    RAISE EXCEPTION 'invalid provisioning result' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    JOIN piggyvest_staging.provisioning_integrations AS binding ON binding.integration_id = registry.id
    WHERE registry.id = p_integration_id AND binding.merchant_id = p_expected_merchant_id
    FOR UPDATE OF registry FOR SHARE OF binding;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT entry.status, entry.claim_token, entry.lease_expires_at, entry.operation, entry.customer_id
    INTO stored_status, stored_token, stored_expiry, stored_operation, stored_customer_id
    FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
      AND entry.merchant_id = p_expected_merchant_id FOR UPDATE;
  IF NOT FOUND OR stored_status <> 'dispatched' OR stored_token IS DISTINCT FROM p_claim_token THEN RETURN 'stale'; END IF;
  IF stored_expiry <= pg_catalog.clock_timestamp() THEN
    PERFORM piggyvest_staging.expire_provisioning_claim(p_integration_id, p_expected_merchant_id, p_intent_id);
    RETURN 'stale';
  END IF;
  IF p_result_code = 'accepted' AND (p_provider_wallet_id IS NULL
    OR (stored_operation = 'create_customer' AND p_provider_customer_id IS NULL)) THEN
    RAISE EXCEPTION 'missing provisioning acknowledgement reference' USING ERRCODE = '22023';
  END IF;
  IF p_provider_customer_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
      WHERE mapping.integration_id = p_integration_id
        AND ((mapping.provider_customer_id = p_provider_customer_id AND mapping.customer_id <> stored_customer_id)
          OR (mapping.customer_id = stored_customer_id AND mapping.provider_customer_id <> p_provider_customer_id)))
      OR EXISTS (SELECT 1 FROM piggyvest_staging.provisioning_intents AS entry
        WHERE entry.integration_id = p_integration_id AND entry.id <> p_intent_id AND entry.provider_customer_id IS NOT NULL
          AND ((entry.provider_customer_id = p_provider_customer_id AND entry.customer_id <> stored_customer_id)
            OR (entry.customer_id = stored_customer_id AND entry.provider_customer_id <> p_provider_customer_id))) THEN
      RAISE EXCEPTION 'conflicting provisioning customer reference' USING ERRCODE = '23514';
    END IF;
    IF stored_operation = 'create_plan_wallet' AND NOT (
      EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
        WHERE mapping.integration_id = p_integration_id AND mapping.merchant_id = p_expected_merchant_id
          AND mapping.customer_id = stored_customer_id AND mapping.provider_customer_id = p_provider_customer_id)
      OR EXISTS (SELECT 1 FROM piggyvest_staging.provisioning_intents AS entry
        WHERE entry.integration_id = p_integration_id AND entry.merchant_id = p_expected_merchant_id
          AND entry.customer_id = stored_customer_id AND entry.operation = 'create_customer'
          AND entry.status = 'awaiting_confirmation' AND entry.provider_customer_id = p_provider_customer_id)) THEN
      RAISE EXCEPTION 'unbound provisioning customer reference' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF p_provider_wallet_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM piggyvest_staging.provisioning_intents AS entry WHERE entry.integration_id = p_integration_id
      AND entry.id <> p_intent_id AND entry.provider_wallet_id = p_provider_wallet_id) THEN
    RAISE EXCEPTION 'conflicting provisioning wallet reference' USING ERRCODE = '23514';
  END IF;
  next_status := CASE WHEN p_result_code = 'accepted' THEN 'awaiting_confirmation' ELSE 'unknown' END;
  UPDATE piggyvest_staging.provisioning_intents AS entry SET
    status = next_status, result_code = p_result_code, provider_customer_id = p_provider_customer_id,
    provider_wallet_id = p_provider_wallet_id, claim_token = NULL, lease_expires_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id AND entry.merchant_id = p_expected_merchant_id;
  RETURN next_status;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.record_provisioning_result(uuid, uuid, uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer, text) IS
  'Owner-only first-dispatch permit: integration,expected merchant,intent UUIDs,lease 1..300 seconds,expected provider business/account ID (opaque 1..512 bytes). Account must exactly match enabled registry; local ownership and enabled merchant binding are rechecked. Zero or one row: intent_id,operation,merchant_id,customer_id,goal_id,request_fingerprint,claim_token,attempts,lease_expires_at. Commit prepare, then commit claim before one external POST. Never dispatch on uncertain claim commit; never retry HTTP or reclaim even after expiry. intent_id is application identity only, not provider idempotency. Recompute and compare HMAC before claim.';
COMMENT ON FUNCTION piggyvest_staging.record_provisioning_result(uuid, uuid, uuid, uuid, text, text, text) IS
  'Owner-only record: integration,expected merchant,intent,token UUIDs,result code,nullable opaque provider customer ID,nullable opaque provider wallet ID. IDs 1..512 UTF8 bytes, private recovery references only; never KYC/messages/credentials or logs. Codes accepted|timeout|transport_error|rejected|ambiguous. accepted -> awaiting_confirmation (customer requires both IDs, plan wallet requires wallet ID); others -> unknown. Optional plan customer ID must have a matching local mapping or acknowledged create_customer intent; this is internal binding, not external confirmation. Missing/expired/replayed/wrong token -> stale; matching expired token marks unknown. Record remains available after disable. Conflicting refs raise safe 23514; caller must retain unknown/reconcile and never resend. No completed state or financial/mapping effects.';
COMMENT ON COLUMN piggyvest_staging.provisioning_intents.provider_reference_hash IS
  'Legacy optional digest slot from initial staging migration; final record API uses bounded opaque recovery IDs. No final API writes this slot.';
COMMENT ON TABLE piggyvest_staging.provisioning_intents IS
  'Owner-only durable single-POST application identity, not provider idempotency. One customer operation per integration/customer and one plan wallet per integration/goal; immutable canonical local ownership. Request HMAC-SHA256 is computed server-side with a separate secret over canonical request plus identity/business; no key, raw request, KYC, BVN, email, phone, credentials, or messages stored. Only bounded opaque provider customer/wallet IDs are retained privately for recovery, never logged. Acknowledgements await independent confirmation; unknown outcomes never resend; completed is outside this tranche.';

COMMIT;
