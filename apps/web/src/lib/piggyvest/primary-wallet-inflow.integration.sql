\set ON_ERROR_STOP on
\ir primary-wallet-storage.integration.sql
CREATE TABLE public.customer_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid UNIQUE NOT NULL,
  merchant_id uuid NOT NULL, available_balance numeric(12,2) NOT NULL DEFAULT 0,
  total_earned numeric(12,2) NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.customer_wallet_transactions (
  id uuid PRIMARY KEY, wallet_id uuid REFERENCES public.customer_wallets(id),
  customer_id uuid NOT NULL, merchant_id uuid NOT NULL, type text NOT NULL,
  amount numeric(10,2) NOT NULL, balance_after numeric(12,2) NOT NULL,
  source_type text, source_id uuid, description text
);
\ir ../../../../../supabase/migrations/20261007142000_piggyvest_primary_inflow_ledger.sql
CREATE ROLE primary_evidence_fixture LOGIN;
GRANT piggyvest_primary_evidence TO primary_evidence_fixture;
INSERT INTO piggyvest_primary.inflow_authorities VALUES ('00000000-0000-4000-8000-000000000004','primary_evidence_fixture',true);
INSERT INTO public.customer_wallets(customer_id,merchant_id,available_balance,total_earned) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',8.50,2.00);
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  integration uuid := '00000000-0000-4000-8000-000000000004';
  receipt jsonb := '{"eventId":"event","providerTransactionId":"txn","providerCustomerId":"customer","providerWalletId":"wallet","eventDataId":"detail","amountKobo":10000,"feeKobo":100,"currency":"NGN","reference":"ref","sessionId":null,"creditedAt":"2026-10-07T00:00:00.000Z","financialFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bodyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
BEGIN
  IF piggyvest_primary.apply_inflow(integration,receipt) <> 'credited' THEN RAISE EXCEPTION 'credit failed'; END IF;
  IF piggyvest_primary.apply_inflow(integration,jsonb_set(receipt,'{eventId}','"retry"')) <> 'duplicate' THEN RAISE EXCEPTION 'replay failed'; END IF;
  IF piggyvest_primary.apply_inflow(integration,jsonb_set(receipt,'{amountKobo}','20000')) <> 'conflict' THEN RAISE EXCEPTION 'changed economics accepted'; END IF;
  IF piggyvest_primary.apply_inflow(integration,jsonb_set(receipt,'{providerWalletId}','"foreign"')) <> 'unmapped' THEN RAISE EXCEPTION 'foreign wallet credited'; END IF;
  BEGIN
    PERFORM piggyvest_primary.apply_inflow(integration,jsonb_set(receipt,'{amountKobo}','null'));
    RAISE EXCEPTION 'null amount accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
RESET SESSION AUTHORIZATION;
\ir ../../../../../supabase/migrations/20261007143000_piggyvest_primary_inflow_environment.sql
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_primary.apply_inflow_environment('00000000-0000-4000-8000-000000000004','production','{}');
    RAISE EXCEPTION 'wrong environment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_function_privilege(SESSION_USER,'piggyvest_primary.apply_inflow(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'unscoped credit permitted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets) <> 108.50 THEN RAISE EXCEPTION 'wrong balance'; END IF;
  IF (SELECT total_earned FROM public.customer_wallets) <> 2.00 THEN RAISE EXCEPTION 'deposit counted as earnings'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions) <> 1 OR (SELECT count(*) FROM piggyvest_primary.inflow_receipts) <> 1 THEN RAISE EXCEPTION 'duplicate history'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.apply_inflow(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public credit enabled'; END IF;
  IF has_table_privilege('primary_evidence_fixture','public.customer_wallets','UPDATE') THEN RAISE EXCEPTION 'direct wallet writes enabled'; END IF;
END $$;
