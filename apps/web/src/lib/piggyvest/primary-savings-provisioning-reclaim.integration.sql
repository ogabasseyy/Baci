\set ON_ERROR_STOP on
\ir primary-wallet-storage.integration.sql
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY);
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,status text,
  target_amount numeric,current_amount numeric,terms_accepted_at timestamptz,non_withdrawable_accepted_at timestamptz,
  metadata jsonb);
INSERT INTO public.customer_savings_goals
SELECT ('00000000-0000-4000-8000-' || lpad(sequence::text,12,'0'))::uuid,
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',200,0,now(),now(),
  '{"interestOptIn":true}'::jsonb FROM generate_series(6,10) sequence;
\ir ../../../../../supabase/migrations/20261007144000_piggyvest_primary_savings_reservations.sql
\ir ../../../../../supabase/migrations/20261007190000_piggyvest_primary_savings_provisioning.sql
\ir ../../../../../supabase/migrations/20261008092200_piggyvest_primary_provisioning_reclaim.sql
CREATE ROLE goal_fixture LOGIN;
GRANT piggyvest_primary_goal_provisioner TO goal_fixture;
INSERT INTO piggyvest_primary.goal_provisioning_authorities
  VALUES('00000000-0000-4000-8000-000000000004','goal_fixture',true);
UPDATE piggyvest_primary.onboarding_intents SET state='verified' WHERE state<>'rejected';
CREATE TEMP TABLE reclaim_tokens(t1 uuid,t2 uuid);
GRANT ALL ON reclaim_tokens TO goal_fixture;
SET SESSION AUTHORIZATION goal_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  goal uuid := '00000000-0000-4000-8000-000000000006';
  first jsonb;
BEGIN
  first:=piggyvest_primary.prepare_goal_wallet(scope,goal,false);
  IF first->>'status'<>'claimed' THEN RAISE EXCEPTION 'initial claim failed'; END IF;
  IF NOT piggyvest_primary.record_goal_wallet(scope,goal,(first->>'claimToken')::uuid,NULL) THEN RAISE EXCEPTION 'failure not recorded'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'status'<>'pending' THEN RAISE EXCEPTION 'fresh failure redispatched'; END IF;
  INSERT INTO reclaim_tokens(t1) VALUES((first->>'claimToken')::uuid);
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.goal_wallet_intents SET updated_at=clock_timestamp()-interval '6 minutes'
  WHERE integration_id='00000000-0000-4000-8000-000000000004' AND goal_id='00000000-0000-4000-8000-000000000006';
SET SESSION AUTHORIZATION goal_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  goal uuid := '00000000-0000-4000-8000-000000000006';
  retry jsonb;
BEGIN
  retry:=piggyvest_primary.prepare_goal_wallet(scope,goal,false);
  IF retry->>'status'<>'claimed' OR retry->>'claimToken' IS NULL THEN RAISE EXCEPTION 'stale failure not reclaimable'; END IF;
  UPDATE reclaim_tokens SET t2=(retry->>'claimToken')::uuid;
  IF NOT piggyvest_primary.record_goal_wallet(scope,goal,(retry->>'claimToken')::uuid,'retry-destination') THEN RAISE EXCEPTION 'retry outcome not recorded'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'status'<>'pending' THEN RAISE EXCEPTION 'accepted intent redispatched'; END IF;
  goal:='00000000-0000-4000-8000-000000000007';
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,true)->>'status'<>'claimed' THEN RAISE EXCEPTION 'second claim failed'; END IF;
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,true)->>'status'<>'pending' THEN RAISE EXCEPTION 'live dispatch redispatched'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.goal_wallet_intents SET updated_at=clock_timestamp()-interval '6 minutes'
  WHERE integration_id='00000000-0000-4000-8000-000000000004' AND goal_id='00000000-0000-4000-8000-000000000007';
SET SESSION AUTHORIZATION goal_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  goal uuid := '00000000-0000-4000-8000-000000000007';
  retry jsonb;
BEGIN
  IF piggyvest_primary.prepare_goal_wallet(scope,goal,false)->>'status'<>'conflict' THEN RAISE EXCEPTION 'reclaim dropped the interest guard'; END IF;
  retry:=piggyvest_primary.prepare_goal_wallet(scope,goal,true);
  IF retry->>'status'<>'claimed' THEN RAISE EXCEPTION 'interrupted dispatch not reclaimable'; END IF;
  IF NOT piggyvest_primary.record_goal_wallet(scope,goal,(retry->>'claimToken')::uuid,'retry-second') THEN RAISE EXCEPTION 'second retry not recorded'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT t1 IS NOT DISTINCT FROM t2 FROM reclaim_tokens) THEN RAISE EXCEPTION 'reclaim reused the dead token'; END IF;
  IF (SELECT state FROM piggyvest_primary.goal_wallet_intents WHERE goal_id='00000000-0000-4000-8000-000000000006')<>'accepted' THEN RAISE EXCEPTION 'retry not accepted'; END IF;
  IF (SELECT provider_wallet_id FROM piggyvest_primary.goal_wallet_intents WHERE goal_id='00000000-0000-4000-8000-000000000006')<>'retry-destination' THEN RAISE EXCEPTION 'retry wallet not stored'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'public preparation enabled'; END IF;
END $$;
