CREATE FUNCTION pg_temp.plan_binding(payload jsonb, goal_uuid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings WHERE goal_id=goal_uuid) THEN
    INSERT INTO piggyvest_staging.wallet_goal_mappings(integration_id,provider_wallet_id,
      provider_customer_id,merchant_id,customer_id,goal_id)
    VALUES ((payload->>'integrationId')::uuid,payload->>'publicWalletId',payload->>'webhookCustomerId',
      (payload->>'merchantId')::uuid,(payload->>'customerId')::uuid,goal_uuid);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings WHERE goal_id=goal_uuid) THEN
    INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
    VALUES (goal_uuid,(payload->>'integrationId')::uuid,(payload->>'merchantId')::uuid,
      (payload->>'customerId')::uuid,'prefunded_treasury_operator',true);
  END IF;
  IF (payload->>'goalOnly')::boolean THEN
    IF EXISTS(SELECT 1 FROM piggyvest_savings_ledger.interest_policies WHERE goal_id=goal_uuid) THEN
      RAISE EXCEPTION 'test plan goal only policy must be absent';
    END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.interest_policies WHERE goal_id=goal_uuid) THEN
    INSERT INTO piggyvest_savings_ledger.interest_policies(goal_id,integration_id,merchant_id,customer_id,
      provider_business_id,provider_customer_id,interest_source_wallet_id,payout_wallet_id,
      interest_enabled,eligibility_evidence,policy_reference,expires_at,enabled)
    VALUES (goal_uuid,(payload->>'integrationId')::uuid,(payload->>'merchantId')::uuid,
      (payload->>'customerId')::uuid,payload->>'businessId',payload->>'payoutProviderCustomerId',
      payload->>'sourceWalletId',payload->>'payoutWalletId',true,payload->>'eligibilityReference',
      payload->>'policyReference',(payload->>'expiresAt')::timestamptz,true);
  END IF;
  PERFORM pg_temp.plan_binding_check(payload,goal_uuid);
END $$;

DO $$
DECLARE payload jsonb; goal_uuid uuid; candidate_before jsonb;
BEGIN
  SELECT source.payload INTO STRICT payload FROM pg_temp.test_plan_session source;
  PERFORM pg_temp.plan_preconditions(payload);
  goal_uuid:=pg_temp.plan_goal(payload);
  candidate_before:=pg_temp.plan_candidate(goal_uuid);
  PERFORM pg_temp.plan_binding(payload,goal_uuid);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF pg_temp.plan_candidate(goal_uuid) IS DISTINCT FROM candidate_before THEN
    RAISE EXCEPTION 'test plan candidate changed';
  END IF;
  PERFORM pg_temp.plan_binding_check(payload,goal_uuid);
  IF md5(pg_temp.plan_schema()::text) IS DISTINCT FROM payload->>'schemaMd5'
    OR md5(pg_temp.plan_state()::text) IS DISTINCT FROM payload->>'stateMd5'
    OR clock_timestamp()>=(payload->>'expiresAt')::timestamptz
    OR (payload->>'providerRetrievedAt')::timestamptz<clock_timestamp()-interval '90 seconds' THEN
    RAISE EXCEPTION 'test plan protected state changed';
  END IF;
  UPDATE pg_temp.test_plan_session source SET payload=source.payload||jsonb_build_object('goalId',goal_uuid);
END $$;

SELECT jsonb_build_object('status',CASE WHEN (payload->>'goalOnly')::boolean
    THEN 'exact_empty_goal_bound_policy_pending' ELSE 'exact_empty_goal_bound' END,'goalId',payload->>'goalId',
  'principalKobo',(SELECT current_amount*100 FROM public.customer_savings_goals
    WHERE id=(payload->>'goalId')::uuid),'newPrefundingKobo',0,'interestPolicyEnabled',NOT (payload->>'goalOnly')::boolean,
  'interestPolicyPresent',NOT (payload->>'goalOnly')::boolean,
  'providerIdMappingApproved',NOT (payload->>'goalOnly')::boolean,
  'oldGoalPrincipalKobo',(SELECT current_amount*100 FROM public.customer_savings_goals
    WHERE id=(payload->>'oldGoalId')::uuid),'schemaMd5',payload->>'schemaMd5','stateMd5',payload->>'stateMd5')
FROM pg_temp.test_plan_session;
