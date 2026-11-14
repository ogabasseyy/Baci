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
-- Minimal surface for the terminal apply_inflow: the bank-authority,
-- alias, and card-prerequisite tables live in sibling chains outside
-- this fixture. Empty stubs preserve direct-inflow behavior while the
-- event-identity fence stays fully exercised.
CREATE TABLE piggyvest_primary.bank_inbox_authorities(integration_id uuid,merchant_id uuid,business_id text,environment text,worker_login name,enabled boolean);
CREATE TABLE piggyvest_primary.custody_transaction_aliases(integration_id uuid,provider_transaction_id text,receipt_id uuid);
CREATE SCHEMA piggyvest_primary_card;
CREATE TABLE piggyvest_primary_card.operations(integration_id uuid,merchant_id uuid,customer_id uuid,state text,amount_kobo bigint);
\ir ../../../../../supabase/migrations/20261008095000_primary_inflow_event_identity.sql
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  integration uuid := '00000000-0000-4000-8000-000000000004';
  receipt jsonb := '{"eventId":"event","providerTransactionId":"txn","providerCustomerId":"customer","providerWalletId":"wallet","eventDataId":"detail","amountKobo":10000,"feeKobo":100,"currency":"NGN","reference":"ref","sessionId":null,"creditedAt":"2026-10-07T00:00:00.000Z","financialFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bodyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
BEGIN
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',jsonb_set(receipt,'{providerTransactionId}','"retry-txn"')) <> 'conflict' THEN RAISE EXCEPTION 'event identity reused'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
-- Ledger-only change under test: the same chain, plus the deposits migration.
CREATE TEMP TABLE before_state AS
  SELECT (SELECT available_balance FROM public.customer_wallets WHERE customer_id='00000000-0000-4000-8000-000000000002') AS balance,
         (SELECT count(*) FROM public.customer_wallet_transactions) AS transactions;
DELETE FROM piggyvest_primary.inflow_receipts;
-- Row types the card settlement function declares; its behaviour is
-- covered by primary-wallet-card-custody-ledger-only.integration.sql.
CREATE TABLE piggyvest_primary_card.reservations();
CREATE TABLE piggyvest_primary_card.treasury_policy();
CREATE TABLE piggyvest_primary_card.settlements();
\ir ../../../../../supabase/migrations/20261103025419_piggyvest_deposits_ledger_only.sql
UPDATE piggyvest_primary.onboarding_intents SET state='verified' WHERE provider_customer_id='customer' AND provider_wallet_id='wallet';
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  integration uuid := '00000000-0000-4000-8000-000000000004';
  receipt jsonb := '{"eventId":"ledger-event","providerTransactionId":"ledger-txn","providerCustomerId":"customer","providerWalletId":"wallet","eventDataId":"ledger-detail","amountKobo":10000,"feeKobo":100,"currency":"NGN","reference":"ledger-ref","sessionId":null,"creditedAt":"2026-10-07T00:00:00.000Z","financialFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bodyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
BEGIN
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',receipt) <> 'credited' THEN RAISE EXCEPTION 'ledger credit failed'; END IF;
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',jsonb_set(receipt,'{eventId}','"ledger-retry"')) <> 'duplicate' THEN RAISE EXCEPTION 'ledger replay not duplicate'; END IF;
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',jsonb_set(receipt,'{amountKobo}','20000')) <> 'conflict' THEN RAISE EXCEPTION 'changed economics accepted'; END IF;
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',jsonb_set(jsonb_set(receipt,'{providerTransactionId}','"ledger-other"'),'{eventId}','"ledger-event"')) <> 'conflict' THEN RAISE EXCEPTION 'reused event id accepted'; END IF;
  IF piggyvest_primary.apply_inflow_environment(integration,'staging',jsonb_set(receipt,'{providerWalletId}','"foreign"')) <> 'unmapped' THEN RAISE EXCEPTION 'foreign wallet recorded'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT available_balance FROM public.customer_wallets WHERE customer_id='00000000-0000-4000-8000-000000000002') IS DISTINCT FROM (SELECT balance FROM before_state) THEN RAISE EXCEPTION 'deposit changed the legacy wallet balance'; END IF;
  IF (SELECT total_earned FROM public.customer_wallets WHERE customer_id='00000000-0000-4000-8000-000000000002') <> 2.00 THEN RAISE EXCEPTION 'deposit counted as earnings'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions) IS DISTINCT FROM (SELECT transactions FROM before_state) THEN RAISE EXCEPTION 'deposit wrote a legacy wallet transaction'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.inflow_receipts) <> 1 THEN RAISE EXCEPTION 'receipt not recorded exactly once'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.inflow_receipts WHERE wallet_transaction_id IS NOT NULL OR (financial_identity->>'amountKobo')::bigint <> 10000) THEN RAISE EXCEPTION 'receipt shape wrong'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary.apply_inflow(uuid,jsonb)','EXECUTE') OR has_function_privilege('anon','piggyvest_primary.reject_deposit_wallet_credit()','EXECUTE') THEN RAISE EXCEPTION 'deposit functions publicly executable'; END IF;
END $$;
-- Guard: a deposit credit can no longer be written to the legacy history.
DO $$ DECLARE wallet uuid; BEGIN
  SELECT id INTO wallet FROM public.customer_wallets WHERE customer_id='00000000-0000-4000-8000-000000000002';
  BEGIN
    INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type)
      VALUES(gen_random_uuid(),wallet,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','credit',1,9.5,'piggyvest_primary_inflow');
    RAISE EXCEPTION 'bank deposit credit accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type)
      VALUES(gen_random_uuid(),wallet,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','credit',1,9.5,'piggyvest_primary_card_custody');
    RAISE EXCEPTION 'card deposit credit accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Other history rows (refunds, no source) are untouched by the guard.
  INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type)
    VALUES(gen_random_uuid(),wallet,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','credit',1,9.5,'piggyvest_primary_card_reversal');
  INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type)
    VALUES(gen_random_uuid(),wallet,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','credit',1,9.5,NULL);
  BEGIN
    INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type)
      VALUES(gen_random_uuid(),wallet,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','redemption',1,9.5,'piggyvest_primary_inflow');
    RAISE EXCEPTION 'deposit-source row of another type accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Relabelling an existing neutral history row as a deposit is rejected too,
  -- while ordinary edits to that row that leave source_type alone still work.
  DECLARE neutral uuid := gen_random_uuid(); deposit_source text; BEGIN
    INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type)
      VALUES(neutral,wallet,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','credit',1,9.5,NULL);
    FOREACH deposit_source IN ARRAY ARRAY['piggyvest_primary_inflow','piggyvest_primary_card_custody'] LOOP
      BEGIN
        UPDATE public.customer_wallet_transactions SET source_type=deposit_source WHERE id=neutral;
        RAISE EXCEPTION 'relabel to % accepted', deposit_source;
      EXCEPTION WHEN check_violation THEN NULL; END;
    END LOOP;
    UPDATE public.customer_wallet_transactions SET amount=2 WHERE id=neutral;
    IF (SELECT source_type FROM public.customer_wallet_transactions WHERE id=neutral) IS NOT NULL THEN RAISE EXCEPTION 'neutral row was relabelled'; END IF;
  END;
END $$;
