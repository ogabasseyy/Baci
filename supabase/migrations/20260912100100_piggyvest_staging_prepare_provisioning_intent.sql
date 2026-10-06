BEGIN;

CREATE FUNCTION piggyvest_staging.prepare_provisioning_intent(
  p_integration_id uuid, p_expected_merchant_id uuid, p_customer_id uuid,
  p_goal_id uuid, p_operation text, p_request_fingerprint bytea
) RETURNS TABLE (intent_id uuid, outcome text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  canonical_merchant_id uuid;
  canonical_customer_id uuid;
  stored_id uuid;
  stored_fingerprint bytea;
  stored_status text;
BEGIN
  IF p_integration_id IS NULL OR p_expected_merchant_id IS NULL OR p_customer_id IS NULL
    OR p_operation IS NULL OR p_operation NOT IN ('create_customer', 'create_plan_wallet')
    OR (p_operation = 'create_customer' AND p_goal_id IS NOT NULL)
    OR (p_operation = 'create_plan_wallet' AND p_goal_id IS NULL)
    OR p_request_fingerprint IS NULL OR pg_catalog.octet_length(p_request_fingerprint) <> 32 THEN
    RAISE EXCEPTION 'invalid provisioning input' USING ERRCODE = '22023';
  END IF;
  IF NOT piggyvest_staging.provisioning_owner_matches(
    p_integration_id, p_expected_merchant_id, p_customer_id, p_goal_id) THEN
    RAISE EXCEPTION 'unavailable provisioning ownership' USING ERRCODE = '22023';
  END IF;
  SELECT customer.merchant_id, customer.id INTO STRICT canonical_merchant_id, canonical_customer_id
    FROM public.customers AS customer WHERE customer.id = p_customer_id;
  INSERT INTO piggyvest_staging.provisioning_intents
    (integration_id, merchant_id, customer_id, goal_id, operation, request_fingerprint)
    VALUES (p_integration_id, canonical_merchant_id, canonical_customer_id, p_goal_id, p_operation, p_request_fingerprint)
    ON CONFLICT DO NOTHING RETURNING id INTO stored_id;
  IF stored_id IS NOT NULL THEN
    RETURN QUERY SELECT stored_id, 'accepted'::text, 'pending'::text;
    RETURN;
  END IF;
  SELECT entry.id, entry.request_fingerprint, entry.status INTO stored_id, stored_fingerprint, stored_status
    FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.integration_id = p_integration_id AND entry.operation = p_operation
      AND ((p_operation = 'create_customer' AND entry.customer_id = canonical_customer_id)
        OR (p_operation = 'create_plan_wallet' AND entry.goal_id = p_goal_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retry provisioning prepare transaction' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT stored_id,
    CASE WHEN stored_fingerprint = p_request_fingerprint AND EXISTS (
      SELECT 1 FROM piggyvest_staging.provisioning_intents AS entry WHERE entry.id = stored_id
        AND entry.merchant_id = canonical_merchant_id AND entry.customer_id = canonical_customer_id
        AND entry.goal_id IS NOT DISTINCT FROM p_goal_id) THEN 'duplicate' ELSE 'conflict' END,
    stored_status;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.prepare_provisioning_intent(uuid, uuid, uuid, uuid, text, bytea)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.prepare_provisioning_intent(uuid, uuid, uuid, uuid, text, bytea) IS
  'Owner-only reserve SQL API: integration UUID, trusted expected merchant UUID, local customer UUID, nullable goal UUID, create_customer|create_plan_wallet, 32-byte HMAC-SHA256 fingerprint (decode validated 64-lowercase-hex application fingerprint). Canonical ownership is verified and locked against local tables and enabled staging scope. Returns intent_id,outcome(accepted|duplicate|conflict),status. Invalid or unauthorized ownership: 22023. Concurrent serialization: retry preparation only on 40001. Commit before claim; conflict must never dispatch. Server computes HMAC over canonical request plus local identity and business using a separate secret key, never a request-supplied fingerprint.';

COMMIT;
