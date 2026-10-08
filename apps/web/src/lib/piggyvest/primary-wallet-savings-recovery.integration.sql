\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
\ir ../../../../../supabase/migrations/20261007153000_piggyvest_primary_savings_pending_recovery.sql
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  recovered jsonb;
BEGIN
  recovered:=piggyvest_primary.read_pending_savings(scope,'00000000-0000-4000-8000-000000000006');
  IF recovered->>'operationId'<>'00000000-0000-4000-8000-000000000008'
    OR recovered->>'state'<>'dispatched' OR (recovered->>'amountKobo')::bigint<>2000
    THEN RAISE EXCEPTION 'pending operation not recovered'; END IF;
  IF piggyvest_primary.read_pending_savings(scope,'00000000-0000-4000-8000-000000000009') IS NOT NULL
    THEN RAISE EXCEPTION 'foreign goal exposed'; END IF;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(jsonb_set(scope,'{customerId}','"00000000-0000-4000-8000-000000000009"'),'00000000-0000-4000-8000-000000000006');
    RAISE EXCEPTION 'foreign customer accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets)<>88.50 THEN RAISE EXCEPTION 'recovery changed wallet'; END IF;
  IF (SELECT current_amount FROM public.customer_savings_goals)<>0 THEN RAISE EXCEPTION 'recovery credited unverified savings'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.read_pending_savings(jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public recovery'; END IF;
END $$;
