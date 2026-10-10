-- Release onboarding intents the provider definitively rejected.
-- A syntactically valid BVN that PiggyVest rejects with HTTP 400 was
-- recorded 'unknown' (transport-ambiguous), but the intent row is keyed
-- by (integration_id, customer_id) and claim_onboarding returns
-- 'conflict' for any fingerprint mismatch, so the customer could never
-- correct the BVN: every retry with the fixed value conflicted
-- permanently against the wrong-value fingerprint. A 400 validation
-- failure happens before provider creation, so deleting the uncreated
-- intent is safe (and the idempotent third_party_identifier re-adopts
-- even in the pathological case). Only the claimed 'dispatched' row
-- under its own token may be released.
BEGIN;
CREATE FUNCTION piggyvest_primary.release_onboarding_intent(scope jsonb, intent_id uuid, token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  DELETE FROM piggyvest_primary.onboarding_intents
  WHERE id = intent_id AND integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'dispatched' AND claim_token = token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.release_onboarding_intent(jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_onboarding_intent(jsonb,uuid,uuid) TO piggyvest_primary_provisioner;
COMMIT;
