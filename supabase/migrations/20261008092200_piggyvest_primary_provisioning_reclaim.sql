-- Re-claim goal-wallet intents whose creation never completed. A
-- failed creation moves the intent to 'unknown' (and a crash between
-- prepare and record leaves 'dispatched'), but prepare never returned
-- 'claimed' for an existing intent, so no later call could retry the
-- provider wallet creation: recovery listed zero wallets and reported
-- pending forever. prepare_goal_wallet now re-issues a fresh claim token
-- for 'unknown' or 'dispatched' intents whose last write is older than
-- five minutes (dwarfs provider timeouts and consistency windows, so a
-- claim that old implies a dead holder and a verified-absent wallet).
-- Fresh claims keep their holder ('existing' pending read), enrolled and
-- accepted intents never re-claim, and interest mismatches still
-- conflict. Row locking serializes concurrent re-claimers: the loser
-- sees the fresh dispatch and reads pending.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.prepare_goal_wallet(scope jsonb, selected_goal uuid, interest_choice boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
  primary_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  intent piggyvest_primary.goal_wallet_intents%ROWTYPE;
  name text := 'baci-save:' || (scope->>'integrationId') || ':' || selected_goal::text;
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
COMMIT;
