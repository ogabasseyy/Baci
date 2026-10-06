BEGIN;

CREATE FUNCTION piggyvest_staging.record_provisioning_result(
  p_integration_id uuid, p_expected_merchant_id uuid, p_intent_id uuid,
  p_claim_token uuid, p_result_code text, p_provider_reference_hash bytea
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  stored_status text;
  stored_token uuid;
  stored_expiry timestamptz;
  next_status text;
BEGIN
  IF p_integration_id IS NULL OR p_expected_merchant_id IS NULL OR p_intent_id IS NULL
    OR p_claim_token IS NULL OR p_result_code IS NULL
    OR p_result_code NOT IN ('accepted', 'timeout', 'transport_error', 'rejected', 'ambiguous')
    OR (p_provider_reference_hash IS NOT NULL AND pg_catalog.octet_length(p_provider_reference_hash) <> 32) THEN
    RAISE EXCEPTION 'invalid provisioning result' USING ERRCODE = '22023';
  END IF;
  SELECT entry.status, entry.claim_token, entry.lease_expires_at INTO stored_status, stored_token, stored_expiry
    FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
      AND entry.merchant_id = p_expected_merchant_id FOR UPDATE;
  IF NOT FOUND OR stored_status <> 'dispatched' OR stored_token IS DISTINCT FROM p_claim_token THEN
    RETURN 'stale';
  END IF;
  IF stored_expiry <= pg_catalog.clock_timestamp() THEN
    PERFORM piggyvest_staging.expire_provisioning_claim(p_integration_id, p_expected_merchant_id, p_intent_id);
    RETURN 'stale';
  END IF;
  next_status := CASE WHEN p_result_code = 'accepted' THEN 'awaiting_confirmation' ELSE 'unknown' END;
  UPDATE piggyvest_staging.provisioning_intents AS entry SET
    status = next_status, result_code = p_result_code, provider_reference_hash = p_provider_reference_hash,
    claim_token = NULL, lease_expires_at = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
      AND entry.merchant_id = p_expected_merchant_id;
  RETURN next_status;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.record_provisioning_result(uuid, uuid, uuid, uuid, text, bytea)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.record_provisioning_result(uuid, uuid, uuid, uuid, text, bytea) IS
  'Owner-only SQL API: integration,expected merchant,intent,claim-token UUIDs,result-code,nullable 32-byte SHA256 of opaque provider reference only. Codes accepted|timeout|transport_error|rejected|ambiguous; never raw messages or bodies. accepted (including HTTP 200) -> awaiting_confirmation for either operation; every other result -> unknown. Scoped matching unexpired token required; mismatch/replay/expiry -> stale. Expired matching token also records lease_expired/unknown. Safe result recording remains allowed after disable or local ownership drift. No wallet mapping, completed status, automatic resend, or provider idempotency assumption. Explicit verified reconciliation must be implemented separately.';

COMMIT;
