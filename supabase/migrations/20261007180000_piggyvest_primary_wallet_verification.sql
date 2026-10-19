BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.verify_onboarding(scope jsonb, proof jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
  field text;
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF proof IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid verification proof' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(proof)) <> 6
    OR NOT proof ?& ARRAY['providerCustomerId','providerWalletId','businessId','currency','status','hasFundingAccount']
    OR proof->>'businessId' IS DISTINCT FROM scope->>'businessId'
    OR proof->>'currency' IS DISTINCT FROM 'NGN'
    OR proof->>'status' IS DISTINCT FROM 'active'
    OR proof->'hasFundingAccount' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'invalid verification proof' USING ERRCODE = '22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['providerCustomerId','providerWalletId','businessId','currency','status'] LOOP
    IF jsonb_typeof(proof->field) IS DISTINCT FROM 'string'
      OR octet_length(proof->>field) NOT BETWEEN 1 AND 512 THEN
      RAISE EXCEPTION 'invalid verification field' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT candidate.* INTO intent FROM piggyvest_primary.onboarding_intents candidate
    WHERE candidate.integration_id = (scope->>'integrationId')::uuid
      AND candidate.merchant_id = (scope->>'merchantId')::uuid
      AND candidate.customer_id = (scope->>'customerId')::uuid
      AND candidate.user_id = (scope->>'userId')::uuid
      AND candidate.provider_customer_id = proof->>'providerCustomerId'
      AND candidate.provider_wallet_id = proof->>'providerWalletId'
      AND candidate.state IN ('accepted','verified')
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF intent.state = 'verified' THEN RETURN true; END IF;
  UPDATE piggyvest_primary.onboarding_intents SET state = 'verified', updated_at = pg_catalog.clock_timestamp()
    WHERE id = intent.id AND state = 'accepted';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.verify_onboarding(jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.verify_onboarding(jsonb,jsonb)
  TO piggyvest_primary_provisioner;
COMMIT;
