\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
\ir ../../../../../supabase/migrations/20261007151000_piggyvest_primary_savings_reconciliation_read.sql
\ir ../../../../../supabase/migrations/20261008091600_piggyvest_primary_savings_failed_release.sql
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000008","providerTransactionId":"failed-transfer","reference":"pvb-save-00000000-0000-4000-8000-000000000008","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination","businessId":"fixture-business"}';
  integration uuid := '00000000-0000-4000-8000-000000000004';
BEGIN
  IF piggyvest_primary.release_failed_savings(integration,'staging',jsonb_set(proof,'{amountKobo}','1999'))<>'conflict' THEN RAISE EXCEPTION 'wrong amount released'; END IF;
  IF piggyvest_primary.release_failed_savings(integration,'staging',jsonb_set(proof,'{reference}','"pvb-save-00000000-0000-4000-8000-000000000007"'))<>'conflict' THEN RAISE EXCEPTION 'foreign reference released'; END IF;
  IF piggyvest_primary.release_failed_savings(integration,'staging',proof)<>'released' THEN RAISE EXCEPTION 'failed release failed'; END IF;
  IF piggyvest_primary.release_failed_savings(integration,'staging',proof)<>'duplicate' THEN RAISE EXCEPTION 'release replay not idempotent'; END IF;
  IF piggyvest_primary.read_dispatched_savings(integration,'staging',(proof->>'operationId')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'released transfer queued again'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  request jsonb := '{"goalId":"00000000-0000-4000-8000-000000000006","operationId":"00000000-0000-4000-8000-000000000009","amountKobo":2000}';
BEGIN
  IF piggyvest_primary.reserve_savings(scope,request)->>'status'<>'claimed' THEN RAISE EXCEPTION 'goal still pinned after release'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000009","providerTransactionId":"failed-transfer","reference":"pvb-save-00000000-0000-4000-8000-000000000009","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination","businessId":"fixture-business"}';
  integration uuid := '00000000-0000-4000-8000-000000000004';
BEGIN
  IF piggyvest_primary.release_failed_savings(integration,'staging',proof)<>'conflict' THEN RAISE EXCEPTION 'undispatched hold released'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
BEGIN
  IF NOT piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000009','cancel') THEN RAISE EXCEPTION 'proof hold not cancelled'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT state FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-000000000008')<>'cancelled' THEN RAISE EXCEPTION 'failed operation not terminal'; END IF;
  IF (SELECT available_balance FROM public.customer_wallets)<>108.50 THEN RAISE EXCEPTION 'failed hold not restored'; END IF;
  IF (SELECT current_amount FROM public.customer_savings_goals)<>0 THEN RAISE EXCEPTION 'failed transfer credited'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions WHERE status='pending')<>0 THEN RAISE EXCEPTION 'failed hold still pending'; END IF;
  IF (SELECT description FROM public.customer_wallet_transactions WHERE source_id='00000000-0000-4000-8000-000000000008')<>'Savings transfer failed at provider' THEN RAISE EXCEPTION 'failed transfer mislabelled'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.release_failed_savings(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public failed release'; END IF;
END $$;
