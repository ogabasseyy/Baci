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
\ir ../../../../../supabase/migrations/20261007143000_piggyvest_primary_inflow_environment.sql
\ir ../../../../../supabase/migrations/20261007230000_primary_bank_signed_inbox.sql
CREATE ROLE primary_card_custody_evidence;
\ir ../../../../../supabase/migrations/20261008091000_primary_bank_hold_specificity.sql
\ir ../../../../../supabase/migrations/20261008092500_primary_inflow_verified_mapping.sql
CREATE SCHEMA piggyvest_primary_card;
CREATE TABLE piggyvest_primary_card.operations(integration_id uuid,customer_id uuid,merchant_id uuid,amount_kobo bigint,state text);
CREATE TABLE piggyvest_primary.custody_transaction_aliases(integration_id uuid,provider_transaction_id text,receipt_id uuid);
CREATE ROLE primary_evidence_fixture LOGIN;
GRANT piggyvest_primary_evidence TO primary_evidence_fixture;
INSERT INTO piggyvest_primary.inflow_authorities VALUES ('00000000-0000-4000-8000-000000000004','primary_evidence_fixture',true);
INSERT INTO public.customer_wallets(customer_id,merchant_id,available_balance,total_earned) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',8.50,2.00);
DO $$ BEGIN
  IF (SELECT state FROM piggyvest_primary.onboarding_intents WHERE provider_customer_id='customer' AND provider_wallet_id='wallet')<>'accepted' THEN RAISE EXCEPTION 'fixture mapping not accepted'; END IF;
END $$;
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  integration uuid := '00000000-0000-4000-8000-000000000004';
  receipt jsonb := '{"eventId":"event","providerTransactionId":"txn","providerCustomerId":"customer","providerWalletId":"wallet","eventDataId":"detail","amountKobo":10000,"feeKobo":100,"currency":"NGN","reference":"ref","sessionId":null,"creditedAt":"2026-10-07T00:00:00.000Z","financialFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bodyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
BEGIN
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',receipt) <> 'prerequisite' THEN RAISE EXCEPTION 'unverified mapping credited'; END IF;
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',jsonb_set(receipt,'{eventId}','"retry"')) <> 'prerequisite' THEN RAISE EXCEPTION 'unverified retry credited'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets) <> 8.50 THEN RAISE EXCEPTION 'deferred receipt moved funds'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.inflow_receipts) THEN RAISE EXCEPTION 'deferred receipt recorded'; END IF;
END $$;
UPDATE piggyvest_primary.onboarding_intents SET state='verified' WHERE provider_customer_id='customer' AND provider_wallet_id='wallet';
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  integration uuid := '00000000-0000-4000-8000-000000000004';
  receipt jsonb := '{"eventId":"event","providerTransactionId":"txn","providerCustomerId":"customer","providerWalletId":"wallet","eventDataId":"detail","amountKobo":10000,"feeKobo":100,"currency":"NGN","reference":"ref","sessionId":null,"creditedAt":"2026-10-07T00:00:00.000Z","financialFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bodyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
BEGIN
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',receipt) <> 'credited' THEN RAISE EXCEPTION 'verified mapping not credited'; END IF;
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',jsonb_set(receipt,'{eventId}','"retry"')) <> 'duplicate' THEN RAISE EXCEPTION 'verified replay not duplicate'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets) <> 108.50 THEN RAISE EXCEPTION 'wrong balance'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions) <> 1 OR (SELECT count(*) FROM piggyvest_primary.inflow_receipts) <> 1 THEN RAISE EXCEPTION 'duplicate history'; END IF;
END $$;
