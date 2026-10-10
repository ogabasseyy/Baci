\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
CREATE TABLE public.customer_savings_contributions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),goal_id uuid,merchant_id uuid,customer_id uuid,
  wallet_transaction_id uuid,amount numeric,source_type text,status text,processed_at timestamptz,
  idempotency_key text UNIQUE,metadata jsonb DEFAULT '{}'
);
\ir ../../../../../supabase/migrations/20261007150000_piggyvest_primary_savings_settlement.sql
\ir ../../../../../supabase/migrations/20261007151000_piggyvest_primary_savings_reconciliation_read.sql
\ir ../../../../../supabase/migrations/20261007152000_piggyvest_primary_savings_customer_status.sql
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000008","providerTransactionId":"transfer-proof","reference":"pvb-save-00000000-0000-4000-8000-000000000008","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination","businessId":"fixture-business"}';
  integration uuid := '00000000-0000-4000-8000-000000000004';
BEGIN
  IF piggyvest_primary.read_dispatched_savings(integration,'staging',(proof->>'operationId')::uuid)->>'reference'<>proof->>'reference' THEN RAISE EXCEPTION 'wrong reconciliation selection'; END IF;
  IF piggyvest_primary.settle_savings(integration,'staging',jsonb_set(proof,'{amountKobo}','1999'))<>'conflict' THEN RAISE EXCEPTION 'wrong amount settled'; END IF;
  IF piggyvest_primary.settle_savings(integration,'staging',proof)<>'confirmed' THEN RAISE EXCEPTION 'settlement failed'; END IF;
  IF piggyvest_primary.settle_savings(integration,'staging',proof)<>'duplicate' THEN RAISE EXCEPTION 'duplicate settlement'; END IF;
  IF piggyvest_primary.read_dispatched_savings(integration,'staging',(proof->>'operationId')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'confirmed transfer queued again'; END IF;
  IF piggyvest_primary.settle_savings(integration,'staging',jsonb_set(proof,'{providerTransactionId}','"other-transaction"'))<>'conflict' THEN RAISE EXCEPTION 'proof overwritten'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
BEGIN
  IF piggyvest_primary.read_savings_status(scope,'00000000-0000-4000-8000-000000000008')<>'confirmed' THEN RAISE EXCEPTION 'incorrect customer status'; END IF;
  IF piggyvest_primary.read_savings_status(scope,'00000000-0000-4000-8000-000000000009') IS NOT NULL THEN RAISE EXCEPTION 'unknown operation exposed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT current_amount FROM public.customer_savings_goals)<>20 THEN RAISE EXCEPTION 'savings credited incorrectly'; END IF;
  IF (SELECT count(*) FROM public.customer_savings_contributions)<>1 THEN RAISE EXCEPTION 'duplicate contributions'; END IF;
  IF (SELECT available_balance FROM public.customer_wallets)<>88.50 THEN RAISE EXCEPTION 'wallet charged twice'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.settle_savings(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public settlement'; END IF;
END $$;
