\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
\ir ../../../../../supabase/migrations/20261007154000_piggyvest_primary_savings_single_pending.sql
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
BEGIN
  BEGIN
    PERFORM piggyvest_primary.reserve_savings(scope,'{"goalId":"00000000-0000-4000-8000-000000000006","operationId":"00000000-0000-4000-8000-000000000009","amountKobo":1000}');
    RAISE EXCEPTION 'second pending operation accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF piggyvest_primary.reserve_savings(scope,'{"goalId":"00000000-0000-4000-8000-000000000006","operationId":"00000000-0000-4000-8000-000000000008","amountKobo":2000}')->>'status'<>'pending'
    THEN RAISE EXCEPTION 'existing operation not retryable'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets)<>88.50 THEN RAISE EXCEPTION 'duplicate reservation debited wallet'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.savings_operations WHERE state IN ('reserved','dispatched'))<>1 THEN RAISE EXCEPTION 'duplicate pending operation'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions WHERE status='pending')<>1 THEN RAISE EXCEPTION 'duplicate pending transaction'; END IF;
END $$;
