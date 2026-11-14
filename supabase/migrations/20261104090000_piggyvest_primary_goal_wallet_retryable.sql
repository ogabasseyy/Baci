-- A goal-wallet claim that failed, or whose holder died, stays stored in
-- state 'unknown' or 'dispatched'. read_goal_wallet reported 'pending' for
-- it forever: only prepare_goal_wallet re-claims an expired claim, and a
-- customer is offered setup only when no setup record exists, so one failed
-- attempt removed the recovery path for good.
--
-- read_goal_wallet now also reports setupRetryable: true exactly when
-- prepare_goal_wallet would re-claim the intent, that is state 'unknown' or
-- 'dispatched' with a last write older than five minutes (the same clock and
-- the same threshold). A live claim, an accepted intent and an enrolled
-- intent report false, so a setup is never invited against a live claim. The
-- read stays side-effect free: it claims nothing, and the re-claim itself
-- (with its provider pre-listing guard) still happens only in
-- prepare_goal_wallet. Otherwise the body is identical to
-- 20261007190000_piggyvest_primary_savings_provisioning.sql (no later
-- migration redefines it). SECURITY DEFINER, the pinned search_path and the
-- grants are unchanged; the grants are restated explicitly.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.read_goal_wallet(scope jsonb, selected_goal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  primary_id uuid := piggyvest_primary.assert_goal_wallet_scope(scope,selected_goal);
  intent piggyvest_primary.goal_wallet_intents%ROWTYPE;
  primary_intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id=(scope->>'integrationId')::uuid AND goal_id=selected_goal;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF intent.primary_intent_id<>primary_id THEN RAISE EXCEPTION 'primary intent changed' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT primary_intent FROM piggyvest_primary.onboarding_intents WHERE id=primary_id;
  RETURN jsonb_build_object('status',CASE WHEN intent.state='enrolled' THEN 'ready' ELSE 'pending' END,
    'claimToken',NULL,'providerCustomerId',primary_intent.provider_customer_id,
    'primaryWalletId',primary_intent.provider_wallet_id,'walletName',intent.wallet_name,'providerWalletId',intent.provider_wallet_id,
    'interestAccepted',intent.interest_accepted,
    'setupRetryable',intent.state IN ('unknown','dispatched')
      AND intent.updated_at < pg_catalog.clock_timestamp() - interval '5 minutes');
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_goal_wallet(jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_wallet(jsonb,uuid)
  TO piggyvest_primary_goal_provisioner;
COMMIT;
