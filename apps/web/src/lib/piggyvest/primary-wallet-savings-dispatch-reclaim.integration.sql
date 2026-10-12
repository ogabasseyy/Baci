\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
\ir ../../../../../supabase/migrations/20261008091600_piggyvest_primary_savings_failed_release.sql
\ir ../../../../../supabase/migrations/20261008091900_piggyvest_primary_savings_dispatch_reclaim.sql
INSERT INTO public.customer_savings_goals VALUES('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',200,0);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
  SELECT integration_id,'00000000-0000-4000-8000-000000000010',id,'destination-adopt',true FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  request jsonb := '{"goalId":"00000000-0000-4000-8000-000000000010","operationId":"00000000-0000-4000-8000-000000000011","amountKobo":2000}';
  adopted jsonb;
BEGIN
  -- A pre-migration dispatch has no stamp and reclaims immediately; the
  -- reclaim refreshes the stamp without moving state, so settlement stays
  -- possible and a second adopter finds a live holder.
  adopted:=piggyvest_primary.adopt_pending_savings(scope,'00000000-0000-4000-8000-000000000008');
  IF adopted->>'status'<>'reclaimed' OR adopted->'reservation'->>'operationId'<>'00000000-0000-4000-8000-000000000008'
    OR adopted->'reservation'->>'goalId'<>'00000000-0000-4000-8000-000000000006' OR (adopted->'reservation'->>'amountKobo')::integer<>2000
    OR adopted->'reservation'->>'sourceWalletId'<>'wallet' OR adopted->'reservation'->>'destinationWalletId'<>'destination'
    OR adopted->'reservation'->>'reference'<>'pvb-save-00000000-0000-4000-8000-000000000008'
    OR adopted->'reservation'->>'providerCustomerId' IS DISTINCT FROM 'customer' THEN RAISE EXCEPTION 'stale dispatch not reclaimed'; END IF;
  IF piggyvest_primary.adopt_pending_savings(scope,'00000000-0000-4000-8000-000000000008')->>'status'<>'existing' THEN RAISE EXCEPTION 'live dispatch reclaimed'; END IF;
  -- Reserved operations adopt as-is for a full drive; terminal and
  -- unknown operations never adopt.
  IF piggyvest_primary.reserve_savings(scope,request)->>'status'<>'claimed' THEN RAISE EXCEPTION 'adopt reservation failed'; END IF;
  adopted:=piggyvest_primary.adopt_pending_savings(scope,'00000000-0000-4000-8000-000000000011');
  IF adopted->>'status'<>'adopted' OR adopted->'reservation'->>'destinationWalletId'<>'destination-adopt' THEN RAISE EXCEPTION 'reserved operation not adopted'; END IF;
  IF NOT piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000011','dispatch') THEN RAISE EXCEPTION 'adopt dispatch failed'; END IF;
  IF piggyvest_primary.adopt_pending_savings(scope,'00000000-0000-4000-8000-000000000011')->>'status'<>'existing' THEN RAISE EXCEPTION 'fresh dispatch reclaimed'; END IF;
  IF piggyvest_primary.adopt_pending_savings(scope,'00000000-0000-4000-8000-000000000007')->>'status'<>'existing' THEN RAISE EXCEPTION 'cancelled operation adopted'; END IF;
  IF piggyvest_primary.adopt_pending_savings(scope,'00000000-0000-4000-8000-000000000099')->>'status'<>'existing' THEN RAISE EXCEPTION 'unknown operation adopted'; END IF;
  BEGIN
    PERFORM piggyvest_primary.adopt_pending_savings(jsonb_set(scope,'{userId}','"00000000-0000-4000-8000-000000000009"'),'00000000-0000-4000-8000-000000000008');
    RAISE EXCEPTION 'foreign user adopted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000011","providerTransactionId":"failed-adopt","reference":"pvb-save-00000000-0000-4000-8000-000000000011","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination-adopt","businessId":"fixture-business"}';
  integration uuid := '00000000-0000-4000-8000-000000000004';
BEGIN
  IF piggyvest_primary.release_failed_savings(integration,'staging',proof)<>'released' THEN RAISE EXCEPTION 'adopt proof hold not released'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT state FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-000000000008')<>'dispatched' THEN RAISE EXCEPTION 'reclaim moved settled state'; END IF;
  IF (SELECT dispatched_at FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-000000000008') IS NULL THEN RAISE EXCEPTION 'reclaim left no stamp'; END IF;
  IF (SELECT available_balance FROM public.customer_wallets)<>88.50 THEN RAISE EXCEPTION 'adopt leaked a hold'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions WHERE status='pending')<>1 THEN RAISE EXCEPTION 'adopt changed pending history'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.adopt_pending_savings(jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public adoption enabled'; END IF;
END $$;
