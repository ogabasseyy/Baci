-- Keep ownership mismatches distinct from immutable interest-routing failures
-- on both first readback and the routing-pending recovery path.
BEGIN;

CREATE OR REPLACE FUNCTION piggyvest_primary.guard_onboarding_review_reason()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.review_reason IS NOT NULL AND NEW.review_reason IS DISTINCT FROM OLD.review_reason THEN
    RAISE EXCEPTION 'onboarding review evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION piggyvest_primary.resolve_onboarding_routing(
  scope jsonb, proof jsonb, routed boolean, p_review_reason text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF routed IS NULL OR proof IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(proof)) <> 2
    OR NOT proof ?& ARRAY['providerCustomerId','providerWalletId']
    OR jsonb_typeof(proof->'providerCustomerId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(proof->'providerWalletId') IS DISTINCT FROM 'string'
    OR (p_review_reason IS NOT NULL AND (p_review_reason <> 'routing' OR routed)) THEN
    RAISE EXCEPTION 'invalid routing proof' USING ERRCODE = '22023';
  END IF;
  UPDATE piggyvest_primary.onboarding_intents SET
    state = CASE WHEN routed AND provider_closed_at IS NULL THEN 'accepted' ELSE 'rejected' END,
    review_reason = CASE
      WHEN routed AND provider_closed_at IS NOT NULL THEN 'routing'
      ELSE p_review_reason
    END,
    routing_payout_wallet_id = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'routing_pending'
    AND provider_customer_id = proof->>'providerCustomerId'
    AND provider_wallet_id = proof->>'providerWalletId';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.resolve_onboarding_routing(scope jsonb, proof jsonb, routed boolean)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT piggyvest_primary.resolve_onboarding_routing(scope, proof, routed, NULL::text)
$$;

CREATE FUNCTION piggyvest_primary.record_onboarding_review(
  scope jsonb, intent_id uuid, token uuid, provider_customer text,
  provider_wallet text, p_review_reason text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF provider_customer IS NULL OR provider_wallet IS NULL
    OR (p_review_reason IS NOT NULL AND p_review_reason <> 'routing') THEN
    RAISE EXCEPTION 'invalid onboarding review' USING ERRCODE = '22023';
  END IF;
  UPDATE piggyvest_primary.onboarding_intents SET
    state = 'rejected', claim_token = NULL, review_reason = p_review_reason,
    provider_customer_id = provider_customer, provider_wallet_id = provider_wallet,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = intent_id AND integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'dispatched' AND claim_token = token;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.record_onboarding_review(
  scope jsonb, intent_id uuid, token uuid, provider_customer text, provider_wallet text
)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT piggyvest_primary.record_onboarding_review(
    scope, intent_id, token, provider_customer, provider_wallet, NULL::text)
$$;

REVOKE ALL ON FUNCTION piggyvest_primary.resolve_onboarding_routing(jsonb,jsonb,boolean,text),
  piggyvest_primary.record_onboarding_review(jsonb,uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.resolve_onboarding_routing(jsonb,jsonb,boolean,text),
  piggyvest_primary.record_onboarding_review(jsonb,uuid,uuid,text,text,text)
  TO piggyvest_primary_provisioner;
COMMIT;
