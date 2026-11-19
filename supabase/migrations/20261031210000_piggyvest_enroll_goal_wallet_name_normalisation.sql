-- PiggyVest rewrites the names of the sub-wallets it creates: a sandbox
-- create listed back with every "-" removed. A goal wallet created as
-- 'baci-save:<integration>:<goal>' therefore comes back under a different
-- spelling, and enroll_goal_wallet compared that listed name to the stored
-- one exactly, so a correctly created wallet was refused and goal
-- provisioning stayed pending (or surfaced as a conflict).
--
-- The comparison now keeps lowercase letters and digits only, on both
-- sides, the same rule as matchesProviderWalletName in
-- apps/web/src/lib/piggyvest/provider-wallet-name.ts.
--
-- Widening equality must never let the database choose between wallets:
-- if another goal intent of the same integration normalises to the same
-- name, the call is refused (false) and nothing is enrolled, whether or not
-- the listed name was an exact match. A stored name with no letters or
-- digits matches nothing.
--
-- The body is otherwise identical to the definition in
-- 20261007190000_piggyvest_primary_savings_provisioning.sql (no later
-- migration redefines it). Ownership, SECURITY DEFINER, the pinned
-- search_path and the grants are unchanged; the grants are restated below
-- because new or replaced functions no longer receive default EXECUTE.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.enroll_goal_wallet(scope jsonb, selected_goal uuid, proof jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
  intent piggyvest_primary.goal_wallet_intents%ROWTYPE;
  primary_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  field text;
  expected_key text;
BEGIN
  IF proof IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid goal wallet proof' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(proof))<>9
    OR NOT proof ?& ARRAY['providerCustomerId','providerWalletId','walletName','businessId','currency','status','type','hasFundingAccount','interestAccepted']
    OR proof->>'businessId' IS DISTINCT FROM scope->>'businessId'
    OR proof->>'currency' IS DISTINCT FROM 'NGN' OR proof->>'status' IS DISTINCT FROM 'active'
    OR proof->>'type' IS DISTINCT FROM 'api'
    OR proof->'hasFundingAccount' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(proof->'interestAccepted') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid goal wallet proof' USING ERRCODE='22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['providerCustomerId','providerWalletId','walletName','businessId','currency','status','type'] LOOP
    IF jsonb_typeof(proof->field) IS DISTINCT FROM 'string' OR octet_length(proof->>field) NOT BETWEEN 1 AND 512 THEN
      RAISE EXCEPTION 'invalid goal wallet field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT * INTO STRICT primary_intent FROM piggyvest_primary.onboarding_intents WHERE id=primary_id;
  SELECT * INTO intent FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal AND primary_intent_id=primary_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF proof->'interestAccepted' IS DISTINCT FROM to_jsonb(intent.interest_accepted) THEN RETURN false; END IF;
  expected_key := lower(regexp_replace(intent.wallet_name,'[^a-zA-Z0-9]','','g'));
  IF proof->>'providerCustomerId'<>primary_intent.provider_customer_id
    OR proof->>'providerWalletId'=primary_intent.provider_wallet_id
    OR expected_key=''
    OR lower(regexp_replace(proof->>'walletName','[^a-zA-Z0-9]','','g'))<>expected_key
    OR (intent.provider_wallet_id IS NOT NULL AND intent.provider_wallet_id<>proof->>'providerWalletId') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.goal_wallet_intents sibling
    WHERE sibling.integration_id=intent.integration_id AND sibling.goal_id<>selected_goal
      AND lower(regexp_replace(sibling.wallet_name,'[^a-zA-Z0-9]','','g'))=expected_key) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents
    WHERE integration_id=intent.integration_id AND provider_wallet_id=proof->>'providerWalletId') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=intent.integration_id AND goal_id<>selected_goal AND provider_wallet_id=proof->>'providerWalletId') THEN RETURN false; END IF;
  INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
    VALUES(intent.integration_id,selected_goal,primary_id,proof->>'providerWalletId',true)
    ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_primary.savings_destinations
    WHERE integration_id=intent.integration_id AND goal_id=selected_goal AND intent_id=primary_id
      AND provider_wallet_id=proof->>'providerWalletId' AND enabled) THEN RETURN false; END IF;
  UPDATE piggyvest_primary.goal_wallet_intents SET state='enrolled',claim_token=NULL,
    provider_wallet_id=proof->>'providerWalletId',updated_at=pg_catalog.clock_timestamp()
    WHERE integration_id=intent.integration_id AND goal_id=selected_goal AND state<>'enrolled';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb)
  TO piggyvest_primary_goal_provisioner;
COMMIT;
