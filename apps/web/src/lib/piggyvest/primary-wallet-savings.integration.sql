\set ON_ERROR_STOP on
\ir primary-wallet-inflow.integration.sql
ALTER TABLE public.customer_wallet_transactions ADD COLUMN status text DEFAULT 'completed';
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,status text,target_amount numeric,current_amount numeric);
\ir ../../../../../supabase/migrations/20261007144000_piggyvest_primary_savings_reservations.sql
\ir ../../../../../supabase/migrations/20261008090000_piggyvest_primary_savings_reservation_customer.sql
CREATE ROLE primary_authorizer_fixture LOGIN;
GRANT piggyvest_primary_authorizer TO primary_authorizer_fixture;
INSERT INTO piggyvest_primary.savings_authorities VALUES('00000000-0000-4000-8000-000000000004','primary_authorizer_fixture',true);
INSERT INTO public.customer_savings_goals VALUES('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',200,0);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
  SELECT integration_id,'00000000-0000-4000-8000-000000000006',id,'destination',true FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  request jsonb := '{"goalId":"00000000-0000-4000-8000-000000000006","operationId":"00000000-0000-4000-8000-000000000007","amountKobo":5000}';
  reserved jsonb;
BEGIN
  reserved:=piggyvest_primary.reserve_savings(scope,request);
  IF reserved->>'status'<>'claimed' OR reserved->'reservation'->>'sourceWalletId'<>'wallet' OR reserved->'reservation'->>'destinationWalletId'<>'destination' OR reserved->'reservation'->>'providerCustomerId' IS DISTINCT FROM 'customer' THEN RAISE EXCEPTION 'reservation failed'; END IF;
  IF piggyvest_primary.reserve_savings(scope,request)->>'status'<>'pending' THEN RAISE EXCEPTION 'duplicate re-dispatched'; END IF;
  IF piggyvest_primary.reserve_savings(scope,jsonb_set(request,'{amountKobo}','6000'))->>'status'<>'conflict' THEN RAISE EXCEPTION 'idempotency conflict ignored'; END IF;
  IF piggyvest_primary.reserve_savings(scope,jsonb_set(jsonb_set(request,'{operationId}','"00000000-0000-4000-8000-000000000008"'),'{amountKobo}','6000'))->>'status'<>'insufficient' THEN RAISE EXCEPTION 'legacy funds reserved'; END IF;
  BEGIN
    PERFORM piggyvest_primary.reserve_savings(jsonb_set(scope,'{userId}','"00000000-0000-4000-8000-000000000009"'),request);
    RAISE EXCEPTION 'foreign user accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets)<>58.50 THEN RAISE EXCEPTION 'hold not reflected in spendable balance'; END IF;
  IF (SELECT current_amount FROM public.customer_savings_goals)<>0 THEN RAISE EXCEPTION 'unsettled transfer grew savings'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.savings_operations)<>1 THEN RAISE EXCEPTION 'duplicate holds'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.reserve_savings(jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public reservation enabled'; END IF;
END $$;
