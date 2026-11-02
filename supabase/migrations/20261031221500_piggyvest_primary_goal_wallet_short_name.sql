-- PiggyVest's POST /api/v1/wallet/sub-account accepts a subaccount_name of
-- at most 50 characters; 51 or more is refused with HTTP 422 "One or more
-- validation errors occurred" (staging sandbox probe, 2026-10-31; colons
-- are accepted and the stored name has non-alphanumerics stripped). The
-- primary goal wallet name 'baci-save:<integration>:<goal>' is 83
-- characters, so every primary goal wallet creation was refused.
--
-- prepare_goal_wallet now names a goal wallet 'baci-save-' followed by the
-- first 32 hex characters of sha256('<integration>:<goal>'), both as
-- lowercase canonical UUID text: 42 characters, deterministic and unique
-- per integration and goal (128 bits). It normalises (lowercase letters and
-- digits, as enroll_goal_wallet and matchesProviderWalletName compare) to
-- 'bacisave' plus hex, which the legacy plan-wallet names ('baci' plus hex)
-- can never equal. apps/web/src/lib/piggyvest/primary-goal-wallet-name.ts
-- builds the same name and the application checks it.
--
-- Intents that hold no provider wallet yet (state dispatched or unknown)
-- and still carry the old name are renamed. No wallet with the old name can
-- exist, since PiggyVest refuses it, so nothing bound to that name is lost;
-- without the rename those goals could never be created. The immutability
-- trigger is disabled only around that one statement, inside this
-- transaction. Intents that hold a wallet keep their name.
--
-- The function body is otherwise identical to the definition in
-- 20261008092200_piggyvest_primary_provisioning_reclaim.sql (no later
-- migration redefines it). SECURITY DEFINER, the pinned search_path and the
-- grants are unchanged; the grants are restated explicitly.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.prepare_goal_wallet(scope jsonb, selected_goal uuid, interest_choice boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
  primary_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  intent piggyvest_primary.goal_wallet_intents%ROWTYPE;
  name text := 'baci-save-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    (scope->>'integrationId')::uuid::text || ':' || selected_goal::text, 'UTF8')), 'hex'), 1, 32);
  existing jsonb;
BEGIN
  IF interest_choice IS NULL THEN RAISE EXCEPTION 'explicit interest choice required' USING ERRCODE='22023'; END IF;
  SELECT * INTO intent FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal FOR UPDATE;
  IF FOUND THEN
    existing := piggyvest_primary.read_goal_wallet(scope,selected_goal);
    IF (existing->>'interestAccepted')::boolean IS DISTINCT FROM interest_choice THEN
      RETURN existing || jsonb_build_object('status','conflict');
    END IF;
    IF intent.state IN ('unknown','dispatched') AND intent.updated_at < pg_catalog.clock_timestamp() - interval '5 minutes' THEN
      UPDATE piggyvest_primary.goal_wallet_intents SET state='dispatched',claim_token=pg_catalog.gen_random_uuid(),
        provider_wallet_id=NULL,updated_at=pg_catalog.clock_timestamp()
        WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal
        RETURNING * INTO intent;
      SELECT * INTO STRICT primary_intent FROM piggyvest_primary.onboarding_intents WHERE id=primary_id;
      RETURN jsonb_build_object('status','claimed','claimToken',intent.claim_token,
        'providerCustomerId',primary_intent.provider_customer_id,'primaryWalletId',primary_intent.provider_wallet_id,
        'walletName',intent.wallet_name,'providerWalletId',NULL,'interestAccepted',intent.interest_accepted);
    END IF;
    RETURN existing;
  END IF;
  SELECT * INTO STRICT primary_intent FROM piggyvest_primary.onboarding_intents WHERE id=primary_id;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.savings_destinations
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal) THEN
    RETURN jsonb_build_object('status','conflict','claimToken',NULL,
      'providerCustomerId',primary_intent.provider_customer_id,'primaryWalletId',primary_intent.provider_wallet_id,
      'walletName',name,'providerWalletId',NULL,'interestAccepted',interest_choice);
  END IF;
  INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id,goal_id,primary_intent_id,wallet_name,state,claim_token,interest_accepted,interest_accepted_at)
    VALUES((scope->>'integrationId')::uuid,selected_goal,primary_id,name,'dispatched',pg_catalog.gen_random_uuid(),
      interest_choice,CASE WHEN interest_choice THEN pg_catalog.clock_timestamp() ELSE NULL END)
    RETURNING * INTO intent;
  RETURN jsonb_build_object('status','claimed','claimToken',intent.claim_token,
    'providerCustomerId',primary_intent.provider_customer_id,'primaryWalletId',primary_intent.provider_wallet_id,
    'walletName',intent.wallet_name,'providerWalletId',NULL,'interestAccepted',intent.interest_accepted);
END $$;

ALTER TABLE piggyvest_primary.goal_wallet_intents
  DISABLE TRIGGER primary_goal_wallet_choice_immutable;
UPDATE piggyvest_primary.goal_wallet_intents
  SET wallet_name = 'baci-save-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    integration_id::text || ':' || goal_id::text, 'UTF8')), 'hex'), 1, 32)
  WHERE state IN ('dispatched','unknown') AND provider_wallet_id IS NULL
    AND pg_catalog.lower(wallet_name) = 'baci-save:' || integration_id::text || ':' || goal_id::text;
ALTER TABLE piggyvest_primary.goal_wallet_intents
  ENABLE TRIGGER primary_goal_wallet_choice_immutable;
REVOKE ALL ON FUNCTION piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)
  TO piggyvest_primary_goal_provisioner;
COMMIT;
