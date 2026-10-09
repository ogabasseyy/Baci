const scope =
  '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
const setup = `
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY);
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,status text,
  target_amount numeric,current_amount numeric,terms_accepted_at timestamptz,non_withdrawable_accepted_at timestamptz,
  metadata jsonb);
INSERT INTO public.customer_savings_goals
SELECT ('00000000-0000-4000-8000-' || lpad(sequence::text,12,'0'))::uuid,
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',200,0,now(),now(),
  '{"interestOptIn":true}'::jsonb FROM generate_series(6,10) sequence;
`;
const assertions = `
CREATE ROLE goal_fixture LOGIN;
GRANT piggyvest_primary_goal_provisioner TO goal_fixture;
INSERT INTO piggyvest_primary.goal_provisioning_authorities
  VALUES('00000000-0000-4000-8000-000000000004','goal_fixture',true);
SET SESSION AUTHORIZATION goal_fixture;
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_primary.prepare_goal_wallet('${scope}', '00000000-0000-4000-8000-000000000006',false);
    RAISE EXCEPTION 'unverified primary was provisioned';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.onboarding_intents SET state='verified' WHERE state<>'rejected';
SET SESSION AUTHORIZATION goal_fixture;
DO $$
DECLARE
  scope jsonb := '${scope}';
  goal uuid := '00000000-0000-4000-8000-000000000006';
  claimed jsonb;
  proof jsonb := '{"providerCustomerId":"customer","providerWalletId":"destination","walletName":"baci-save:00000000-0000-4000-8000-000000000004:00000000-0000-4000-8000-000000000006","businessId":"fixture-business","currency":"NGN","status":"active","type":"api","hasFundingAccount":true,"interestAccepted":false}';
  field text;
  invalid jsonb;
BEGIN
  IF piggyvest_primary.read_goal_wallet(scope,goal) IS NOT NULL THEN RAISE EXCEPTION 'unstarted intent exposed'; END IF;
  IF piggyvest_primary.enroll_goal_wallet(scope,goal,proof) THEN RAISE EXCEPTION 'enrolled without dispatch intent'; END IF;
  FOREACH field IN ARRAY ARRAY['merchantId','customerId','userId','integrationId','businessId','environment'] LOOP
    BEGIN
      PERFORM piggyvest_primary.prepare_goal_wallet(jsonb_set(scope,ARRAY[field],
        CASE WHEN field='businessId' THEN '"foreign"'::jsonb WHEN field='environment' THEN '"production"'::jsonb
        ELSE '"00000000-0000-4000-8000-000000000099"'::jsonb END),goal,false);
      RAISE EXCEPTION 'foreign scope was authorized';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_primary.prepare_goal_wallet(scope,'00000000-0000-4000-8000-000000000099',false);
    RAISE EXCEPTION 'missing goal authorized';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  claimed := piggyvest_primary.prepare_goal_wallet(scope,goal,false);
  IF claimed->>'status'<>'claimed' OR claimed->>'providerCustomerId'<>'customer' THEN RAISE EXCEPTION 'claim unavailable'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'status'<>'pending' THEN RAISE EXCEPTION 'duplicate dispatch'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,true)->>'status'<>'conflict' THEN RAISE EXCEPTION 'changed interest choice accepted'; END IF;
  IF piggyvest_primary.record_goal_wallet(scope,goal,'00000000-0000-4000-8000-000000000099','destination') THEN RAISE EXCEPTION 'stale token accepted'; END IF;
  BEGIN
    PERFORM piggyvest_primary.record_goal_wallet(scope,goal,(claimed->>'claimToken')::uuid,'wallet');
    RAISE EXCEPTION 'primary wallet adopted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT piggyvest_primary.record_goal_wallet(scope,goal,(claimed->>'claimToken')::uuid,NULL) THEN RAISE EXCEPTION 'unknown outcome not recorded'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'status'<>'pending'
    OR piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'claimToken' IS NOT NULL THEN RAISE EXCEPTION 'unknown redispatched'; END IF;
  FOREACH field IN ARRAY ARRAY['providerCustomerId','walletName'] LOOP
    IF piggyvest_primary.enroll_goal_wallet(scope,goal,jsonb_set(proof,ARRAY[field],'"foreign"'))
      THEN RAISE EXCEPTION 'foreign identity adopted'; END IF;
  END LOOP;
  IF piggyvest_primary.enroll_goal_wallet(scope,goal,proof||'{"providerWalletId":"wallet"}') THEN RAISE EXCEPTION 'primary wallet enrolled'; END IF;
  IF piggyvest_primary.enroll_goal_wallet(scope,goal,proof||'{"interestAccepted":true}') THEN RAISE EXCEPTION 'consent changed during recovery'; END IF;
  FOREACH invalid IN ARRAY ARRAY[NULL::jsonb,'null'::jsonb,'[]'::jsonb,proof-'status',proof||'{"extra":true}',
    proof||'{"businessId":"foreign"}',proof||'{"currency":"USD"}',proof||'{"status":"pending"}',
    proof||'{"type":"business"}',proof||'{"hasFundingAccount":false}',proof||'{"interestAccepted":"true"}',
    proof||'{"status":null}'] LOOP
    BEGIN
      PERFORM piggyvest_primary.enroll_goal_wallet(scope,goal,invalid);
      RAISE EXCEPTION 'invalid or interest-enabled proof accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  IF NOT piggyvest_primary.enroll_goal_wallet(scope,goal,proof) THEN RAISE EXCEPTION 'read-only recovery failed'; END IF;
  IF NOT piggyvest_primary.enroll_goal_wallet(scope,goal,proof) THEN RAISE EXCEPTION 'enrollment replay failed'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'status'<>'ready' THEN RAISE EXCEPTION 'enrolled destination not ready'; END IF;
  goal := '00000000-0000-4000-8000-000000000007';
  claimed := piggyvest_primary.prepare_goal_wallet(scope,goal,true);
  IF claimed->>'status'<>'claimed' OR claimed->>'interestAccepted'<>'true' THEN RAISE EXCEPTION 'opt-in not persisted'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'status'<>'conflict' THEN RAISE EXCEPTION 'opt-in silently downgraded'; END IF;
  IF NOT piggyvest_primary.record_goal_wallet(scope,goal,(claimed->>'claimToken')::uuid,'interest-destination') THEN RAISE EXCEPTION 'accepted opt-in wallet not stored'; END IF;
  proof := proof||jsonb_build_object('walletName','baci-save:'||(scope->>'integrationId')||':'||goal::text,
    'providerWalletId','interest-destination','interestAccepted',true);
  IF piggyvest_primary.enroll_goal_wallet(scope,goal,proof||'{"providerWalletId":"changed"}') THEN RAISE EXCEPTION 'accepted wallet replaced'; END IF;
  IF NOT piggyvest_primary.enroll_goal_wallet(scope,goal,proof) THEN RAISE EXCEPTION 'explicit opt-in enrollment failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM piggyvest_primary.savings_destinations WHERE enabled)<>2 THEN RAISE EXCEPTION 'destination missing or duplicated'; END IF;
  IF (SELECT interest_accepted FROM piggyvest_primary.goal_wallet_intents WHERE goal_id='00000000-0000-4000-8000-000000000006') THEN RAISE EXCEPTION 'metadata enabled interest'; END IF;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_primary.goal_wallet_intents WHERE interest_accepted AND interest_accepted_at IS NOT NULL) THEN RAISE EXCEPTION 'opt-in consent not retained'; END IF;
  BEGIN
    UPDATE piggyvest_primary.goal_wallet_intents SET interest_accepted=false,interest_accepted_at=NULL
      WHERE goal_id='00000000-0000-4000-8000-000000000007';
    RAISE EXCEPTION 'persisted opt-in was mutable';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF has_function_privilege('authenticated','piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)','EXECUTE')
    OR has_function_privilege('service_role','piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb)','EXECUTE')
    OR has_table_privilege('goal_fixture','piggyvest_primary.savings_destinations','INSERT') THEN RAISE EXCEPTION 'excess privileges'; END IF;
END $$;
`;

export const primarySavingsPostgresFixture = { scope, setup, assertions };
