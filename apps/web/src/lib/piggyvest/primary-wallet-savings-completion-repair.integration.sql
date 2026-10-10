\set ON_ERROR_STOP on
\ir primary-wallet-savings-cancel-guard.integration.sql
-- The cancel-guard migration CREATE OR REPLACE'd settle_savings while it
-- held the paid-interest completion wrapper, silently dropping the
-- pending-capacity fence (completion_totals consult plus durable
-- evidence). Replay the interest migration, then the repair, and prove
-- the wrapper sits on top of the cancel-guard body again.
ALTER TABLE public.customer_savings_goals ADD COLUMN goal_kind text;
CREATE SCHEMA piggyvest_savings_ledger;
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,enabled boolean NOT NULL DEFAULT false,expected_provider_account_id text);
CREATE TABLE piggyvest_savings_ledger.bindings(goal_id uuid,merchant_id uuid,customer_id uuid,integration_id uuid,enabled boolean NOT NULL DEFAULT false);
CREATE TABLE piggyvest_savings_ledger.operations(id uuid PRIMARY KEY,integration_id uuid,goal_id uuid,merchant_id uuid,customer_id uuid);
CREATE TABLE piggyvest_savings_ledger.postings(operation_id uuid,amount_kobo numeric,account text);
\ir ../../../../../supabase/migrations/20261007181000_piggyvest_primary_paid_interest_completion.sql
\ir ../../../../../supabase/migrations/20261008094700_piggyvest_primary_savings_completion_repair.sql
DO $$ BEGIN
  IF (SELECT pg_get_functiondef('piggyvest_primary.settle_savings(uuid,text,jsonb)'::regprocedure))
    NOT LIKE '%savings_completion_evidence%' THEN RAISE EXCEPTION 'completion wrapper missing after repair'; END IF;
  IF (SELECT pg_get_functiondef('piggyvest_primary.settle_savings(uuid,text,jsonb)'::regprocedure))
    NOT LIKE '%settle_savings_before_completion(%' THEN RAISE EXCEPTION 'wrapper delegation missing after repair'; END IF;
  IF (SELECT pg_get_functiondef('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)'::regprocedure))
    NOT LIKE '%THEN ''paused''%' THEN RAISE EXCEPTION 'cancel behavior lost in repair'; END IF;
END $$;
-- Falsifiability: re-applying the cancel guard must observably clobber
-- the wrapper again, and the repair must rebuild the production path
-- (drop orphan, rename, reinstall) rather than no-op.
\ir ../../../../../supabase/migrations/20261008091700_piggyvest_primary_savings_cancel_guard.sql
DO $$ BEGIN
  IF (SELECT pg_get_functiondef('piggyvest_primary.settle_savings(uuid,text,jsonb)'::regprocedure))
    LIKE '%savings_completion_evidence%' THEN RAISE EXCEPTION 're-clobber did not drop the wrapper'; END IF;
END $$;
\ir ../../../../../supabase/migrations/20261008094700_piggyvest_primary_savings_completion_repair.sql
DO $$ BEGIN
  IF (SELECT pg_get_functiondef('piggyvest_primary.settle_savings(uuid,text,jsonb)'::regprocedure))
    NOT LIKE '%savings_completion_evidence%' THEN RAISE EXCEPTION 'production-path reinstall failed'; END IF;
  IF (SELECT pg_get_functiondef('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)'::regprocedure))
    NOT LIKE '%THEN ''paused''%' THEN RAISE EXCEPTION 'cancel behavior lost in reinstall'; END IF;
  IF NOT has_function_privilege('primary_evidence_fixture','piggyvest_primary.settle_savings(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'evidence grant lost in reinstall'; END IF;
  IF has_function_privilege('primary_evidence_fixture','piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'inner body executable by evidence'; END IF;
END $$;
-- Legacy over-capacity fence: a pre-gate dispatched transfer that no
-- longer fits must return 'conflict' with durable evidence instead of
-- raising, so the worker fences it into completion review.
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount,goal_kind)
  VALUES('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',150,100,'legacy');
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
  SELECT integration_id,'00000000-0000-4000-8000-000000000030',id,'destination-fence',true FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,description,status)
  SELECT '00000000-0000-4000-8000-000000000031',id,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','hold',100,0,'piggyvest_primary_savings','00000000-0000-4000-8000-000000000032','legacy hold','pending' FROM public.customer_wallets WHERE customer_id='00000000-0000-4000-8000-000000000002';
INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state,wallet_transaction_id)
  SELECT '00000000-0000-4000-8000-000000000032',integration_id,id,'00000000-0000-4000-8000-000000000030',10000,'wallet','destination-fence','pvb-save-00000000-0000-4000-8000-000000000032','dispatched','00000000-0000-4000-8000-000000000031' FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,description,status)
  SELECT '00000000-0000-4000-8000-000000000033',id,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','credit',200,0,'test_funding',NULL,'fence funding','completed' FROM public.customer_wallets WHERE customer_id='00000000-0000-4000-8000-000000000002';
INSERT INTO piggyvest_primary.inflow_receipts(id,integration_id,intent_id,provider_transaction_id,event_id,body_digest,financial_identity,wallet_transaction_id)
  SELECT '00000000-0000-4000-8000-000000000034',integration_id,id,'fence-funding','fence-funding-event',repeat('a',64),'{"amountKobo":20000}','00000000-0000-4000-8000-000000000033' FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000032","providerTransactionId":"fence-proof","reference":"pvb-save-00000000-0000-4000-8000-000000000032","amountKobo":10000,"sourceWalletId":"wallet","destinationWalletId":"destination-fence","businessId":"fixture-business"}';
BEGIN
  IF piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',proof)<>'conflict' THEN RAISE EXCEPTION 'over-capacity transfer not fenced'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM piggyvest_primary.savings_completion_evidence WHERE operation_id='00000000-0000-4000-8000-000000000032' AND provider_transaction_id='fence-proof')<>1 THEN RAISE EXCEPTION 'fence evidence missing'; END IF;
  IF (SELECT current_amount FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000030')<>100 THEN RAISE EXCEPTION 'fenced transfer credited'; END IF;
  IF (SELECT state FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-000000000032')<>'dispatched' THEN RAISE EXCEPTION 'fenced transfer moved'; END IF;
END $$;
-- Interest race: principal 90, pending 10, then 10 interest lands before
-- settlement. The transfer still confirms (principal fits), but the
-- completion totals must fence the goal into an open overshoot review
-- instead of silently funding 110 against a 100 target.
UPDATE public.customer_wallets SET available_balance=available_balance+1000 WHERE customer_id='00000000-0000-4000-8000-000000000002';
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount,goal_kind)
  VALUES('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',100,90,'legacy');
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
  SELECT integration_id,'00000000-0000-4000-8000-000000000040',id,'destination-interest',true FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  request jsonb := '{"goalId":"00000000-0000-4000-8000-000000000040","operationId":"00000000-0000-4000-8000-000000000042","amountKobo":1000}';
BEGIN
  IF piggyvest_primary.reserve_savings(scope,request)->>'status'<>'claimed' THEN RAISE EXCEPTION 'interest-race reservation failed'; END IF;
  IF NOT piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000042','dispatch') THEN RAISE EXCEPTION 'interest-race dispatch failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_staging.integrations VALUES('00000000-0000-4000-8000-000000000050',true,'fixture-business');
INSERT INTO piggyvest_savings_ledger.bindings VALUES('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000050',true);
INSERT INTO piggyvest_savings_ledger.operations VALUES('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
INSERT INTO piggyvest_savings_ledger.postings VALUES('00000000-0000-4000-8000-000000000051',1000,'paid_interest');
DO $$ BEGIN
  IF (SELECT count(*) FROM piggyvest_primary.savings_completion_reviews WHERE goal_id='00000000-0000-4000-8000-000000000040' AND state='open' AND overshoot_kobo=1000 AND pending_operation_ids=array['00000000-0000-4000-8000-000000000042'::uuid])<>1 THEN RAISE EXCEPTION 'interest-race in-flight fence missing'; END IF;
END $$;
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000042","providerTransactionId":"interest-proof","reference":"pvb-save-00000000-0000-4000-8000-000000000042","amountKobo":1000,"sourceWalletId":"wallet","destinationWalletId":"destination-interest","businessId":"fixture-business"}';
BEGIN
  IF piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',proof)<>'confirmed' THEN RAISE EXCEPTION 'interest-race settlement failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT current_amount FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000040')<>100 THEN RAISE EXCEPTION 'interest-race miscredited'; END IF;
  IF (SELECT status FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000040')<>'completed' THEN RAISE EXCEPTION 'interest-race completion missed'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.savings_completion_reviews WHERE goal_id='00000000-0000-4000-8000-000000000040' AND state='cleared' AND overshoot_kobo=0 AND pending_operation_ids='{}' AND first_flagged_at IS NOT NULL)<>1 THEN RAISE EXCEPTION 'interest-race fence lifecycle wrong'; END IF;
END $$;
