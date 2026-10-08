\set ON_ERROR_STOP on
\ir primary-wallet-savings.integration.sql
\ir ../../../../../supabase/migrations/20261007145000_piggyvest_primary_savings_dispatch.sql
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  request jsonb := '{"goalId":"00000000-0000-4000-8000-000000000006","operationId":"00000000-0000-4000-8000-000000000008","amountKobo":2000}';
BEGIN
  IF NOT piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000007','cancel') THEN RAISE EXCEPTION 'cancel failed'; END IF;
  IF piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000007','cancel') THEN RAISE EXCEPTION 'hold refunded twice'; END IF;
  IF piggyvest_primary.reserve_savings(scope,request)->>'status'<>'claimed' THEN RAISE EXCEPTION 'new reservation failed'; END IF;
  IF NOT piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000008','dispatch') THEN RAISE EXCEPTION 'dispatch failed'; END IF;
  IF piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000008','dispatch') THEN RAISE EXCEPTION 'dispatched twice'; END IF;
  IF piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000008','cancel') THEN RAISE EXCEPTION 'uncertain provider transfer refunded'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets)<>88.50 THEN RAISE EXCEPTION 'incorrect spendable balance'; END IF;
  IF (SELECT current_amount FROM public.customer_savings_goals)<>0 THEN RAISE EXCEPTION 'unverified transfer credited'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions WHERE status='pending')<>1 THEN RAISE EXCEPTION 'incorrect pending history'; END IF;
END $$;
