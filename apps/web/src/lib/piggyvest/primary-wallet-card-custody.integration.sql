\set ON_ERROR_STOP on
\ir primary-wallet-card-checkout.integration.sql
CREATE TABLE public.customer_wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid UNIQUE REFERENCES public.customers(id),merchant_id uuid REFERENCES public.merchants(id),available_balance numeric(12,2) NOT NULL DEFAULT 0,total_earned numeric(12,2) DEFAULT 0,updated_at timestamptz DEFAULT now());
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY,wallet_id uuid REFERENCES public.customer_wallets(id),customer_id uuid REFERENCES public.customers(id),merchant_id uuid REFERENCES public.merchants(id),type text,amount numeric(10,2),balance_after numeric(12,2),source_type text,source_id uuid,description text);
\ir ../../../../../supabase/migrations/20261007142000_piggyvest_primary_inflow_ledger.sql
\ir ../../../../../supabase/migrations/20261007143000_piggyvest_primary_inflow_environment.sql
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text,enabled boolean);
CREATE SCHEMA prefunded_card;
CREATE TABLE prefunded_card.treasury_bindings(id uuid PRIMARY KEY,integration_id uuid,merchant_id uuid,expected_business_id text,source_wallet_id text,currency text,verified_available_kobo bigint,reserved_kobo bigint,consumed_kobo bigint,verified_at timestamptz,authorized_login name,enabled boolean);
CREATE TABLE prefunded_card.operations(id uuid,treasury_binding_id uuid,collection_status text,transfer_status text);
CREATE FUNCTION prefunded_card.reserve(jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'legacy checkout unused by primary'; END $$;
\ir ../../../../../tools/staging/prefunded-card/treasury-storage.sql
\ir ../../../../../tools/staging/prefunded-card/treasury-functions.sql
\ir ../../../../../supabase/migrations/20261007200300_primary_card_treasury_reservation.sql
\ir ../../../../../supabase/migrations/20261007200400_primary_card_transfer_outbox.sql
\ir ../../../../../supabase/migrations/20261007200500_primary_card_custody_receipts.sql
\ir ../../../../../supabase/migrations/20261007200600_primary_inflow_shared_custody_identity.sql
\ir ../../../../../supabase/migrations/20261007200700_primary_card_signed_custody_settlement.sql
\ir ../../../../../supabase/migrations/20261007200800_primary_card_terminal_reconciliation_guard.sql
CREATE ROLE baci_primary_card_transfer LOGIN;
CREATE ROLE baci_primary_card_custody LOGIN;
CREATE ROLE fixture_bank_inflow LOGIN;
GRANT primary_card_transfer_worker TO baci_primary_card_transfer;
GRANT primary_card_custody_evidence TO baci_primary_card_custody;
GRANT piggyvest_primary_evidence TO fixture_bank_inflow;
INSERT INTO piggyvest_primary.inflow_authorities VALUES('10000000-0000-4000-8000-000000000004','fixture_bank_inflow',true);
INSERT INTO piggyvest_staging.integrations VALUES('90000000-0000-4000-8000-000000000001','fixture-business',true);
INSERT INTO prefunded_card.treasury_bindings VALUES('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fixture-business','owner-treasury','NGN',1000000,10000,20000,now(),'fixture_owner',true);
INSERT INTO prefunded_card.treasury_identities VALUES('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fixture-business','owner-treasury','fixture_owner',1000000,'fixture_owner',now());
INSERT INTO prefunded_card.treasury_snapshots VALUES('90000000-0000-4000-8000-000000000002','snapshot-before',1,now(),980000,'fixture_verifier',now());
INSERT INTO piggyvest_primary_card.treasury_policy VALUES('10000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000002','fixture_owner','owner-treasury',25000,50000,50000,'baci_primary_card_transfer','baci_primary_card_custody',true);
CREATE TABLE public.custody_fixture(label text PRIMARY KEY,scope jsonb,operation_id uuid,proof jsonb,bank jsonb);
GRANT SELECT,UPDATE ON public.custody_fixture TO baci_primary_card_authorizer,baci_primary_card_evidence,baci_primary_card_transfer,baci_primary_card_custody,fixture_bank_inflow;
INSERT INTO public.customers VALUES
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','third@example.test'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','fourth@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
 SELECT '10000000-0000-4000-8000-000000000004',merchant_id,id,user_id,repeat('c',64),'verified',email,email||'-wallet' FROM public.customers WHERE email IN ('third@example.test','fourth@example.test');
INSERT INTO public.custody_fixture(label,scope)
 SELECT customer.email,original.scope||jsonb_build_object('customerId',customer.id,'userId',customer.user_id,'email',customer.email)
 FROM public.customers customer CROSS JOIN public.card_fixture original WHERE customer.email IN ('third@example.test','fourth@example.test') AND original.scope->>'email'='customer@example.test';
INSERT INTO public.customer_wallets(customer_id,merchant_id,available_balance,total_earned)
 SELECT id,merchant_id,42,7 FROM public.customers WHERE email IN ('third@example.test','fourth@example.test');
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE fixture record; request jsonb; intent jsonb; claim jsonb; BEGIN
 FOR fixture IN SELECT * FROM public.custody_fixture LOOP
  request := jsonb_build_object('idempotencyKey',fixture.scope->>'customerId','amountKobo',25000,'consent',jsonb_build_object('version','primary-wallet-card-v1','oneTimeCharge',true,'saveCard',false));
  BEGIN
   PERFORM piggyvest_primary_card.reserve(fixture.scope,jsonb_set(request,'{amountKobo}','25001'));
   RAISE EXCEPTION 'operation cap bypassed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  intent := piggyvest_primary_card.reserve(fixture.scope,request);
  IF intent<>piggyvest_primary_card.reserve(fixture.scope,request) THEN RAISE EXCEPTION 'idempotency lost'; END IF;
  UPDATE public.custody_fixture SET operation_id=(intent->>'operationId')::uuid WHERE label=fixture.label;
  claim := piggyvest_primary_card.claim_initialization(fixture.scope,(intent->>'operationId')::uuid);
  PERFORM piggyvest_primary_card.record_initialization(fixture.scope,(intent->>'operationId')::uuid,(claim->>'token')::uuid,NULL);
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>60000 THEN RAISE EXCEPTION 'duplicate reservation or legacy reserve lost'; END IF;
 BEGIN UPDATE piggyvest_primary_card.treasury_policy SET source_wallet_id='attacker'; RAISE EXCEPTION 'treasury identity mutable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('baci_primary_card_evidence','piggyvest_primary_card.settle_custody(uuid,text,jsonb)','EXECUTE') OR has_table_privilege('baci_primary_card_custody','piggyvest_primary_card.settlements','INSERT') THEN RAISE EXCEPTION 'capability boundary broken'; END IF;
END $$;
UPDATE public.custody_fixture SET bank=jsonb_build_object('eventId','bank-event-'||label,'providerTransactionId','bank-'||label,'providerCustomerId',label,'providerWalletId',label||'-wallet','eventDataId','data-'||label,'amountKobo',25000,'feeKobo',0,'currency','NGN','reference','bank-ref-'||label,'sessionId',NULL,'creditedAt',clock_timestamp(),'financialFingerprint',repeat('c',64),'bodyDigest',repeat('d',64));
SET SESSION AUTHORIZATION fixture_bank_inflow;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fourth@example.test';
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',fixture.bank)<>'credited' THEN RAISE EXCEPTION 'preexisting bank receipt failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE fixture record; evidence jsonb; BEGIN
 FOR fixture IN SELECT * FROM public.custody_fixture LOOP
  evidence := jsonb_build_object('reference','pvb-first-primary-'||fixture.operation_id,'amountKobo',25000,'domain','test','providerTransactionId',CASE WHEN fixture.label='third@example.test' THEN '12347' ELSE '12348' END,'token',NULL);
  PERFORM piggyvest_primary_card.record_collection(fixture.scope,fixture.operation_id,evidence);
  PERFORM piggyvest_primary_card.record_collection(fixture.scope,fixture.operation_id,evidence);
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_transfer;
RESET SESSION AUTHORIZATION;
\ir primary-wallet-card-custody-treasury-rejections.integration.sql
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; claim jsonb; BEGIN
 FOR fixture IN SELECT * FROM public.custody_fixture LOOP
  claim := piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id);
  IF claim->>'outcome'<>'claimed' OR claim->'command'->>'sourceWalletId'<>'owner-treasury' THEN RAISE EXCEPTION 'owner transfer not claimed'; END IF;
  IF piggyvest_primary_card.record_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id,'10000000-0000-4000-8000-000000000009',true) THEN RAISE EXCEPTION 'stale claim accepted'; END IF;
  IF NOT piggyvest_primary_card.record_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id,(claim->>'token')::uuid,false) THEN RAISE EXCEPTION 'unknown not durable'; END IF;
  IF piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)->>'outcome'<>'existing' THEN RAISE EXCEPTION 'ambiguous transfer retried'; END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_custody;
UPDATE public.custody_fixture SET proof=piggyvest_primary_card.transfer_context((scope->>'integrationId')::uuid,'staging',operation_id)||jsonb_build_object('providerTransactionId','canonical-'||label,'transactionAliases',jsonb_build_array('canonical-'||label,'bank-'||label),'eventId','signed-'||label,'bodyDigest',repeat('a',64),'crosswalkDigest',repeat('b',64),'observedAt',clock_timestamp(),'feeKobo',0,'currency','NGN');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION fixture_bank_inflow;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',fixture.bank)<>'conflict' THEN RAISE EXCEPTION 'bank-first unknown alias prematurely credited'; END IF;
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.bank,'{providerTransactionId}',to_jsonb('canonical-'||fixture.label)))<>'conflict' THEN RAISE EXCEPTION 'bank alias race duplicated credit'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_custody;
RESET SESSION AUTHORIZATION;
\ir primary-wallet-card-custody-settlement-rejections.integration.sql
\if :{?hold_custody}
\else
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; BEGIN
 FOR fixture IN SELECT * FROM public.custody_fixture LOOP
  IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',fixture.proof)<>'completed' THEN RAISE EXCEPTION 'custody completion failed'; END IF;
  IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',fixture.proof)<>'duplicate' THEN RAISE EXCEPTION 'duplicate custody debit'; END IF;
  IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.proof,'{eventId}','"new-signed-event"'))<>'duplicate' THEN RAISE EXCEPTION 'new event duplicated credit'; END IF;
  IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.proof,'{transactionAliases}',jsonb_build_array('canonical-'||fixture.label,'bank-'||fixture.label,'unverified-new-alias')))<>'conflict' THEN RAISE EXCEPTION 'changed custody identity accepted'; END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION fixture_bank_inflow;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',fixture.bank)<>'duplicate' THEN RAISE EXCEPTION 'bank-after-card duplicated credit'; END IF;
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.bank,'{providerTransactionId}',to_jsonb('canonical-'||fixture.label)))<>'duplicate' THEN RAISE EXCEPTION 'canonical duplicate credit'; END IF;
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.bank,'{amountKobo}','24999'))<>'conflict' THEN RAISE EXCEPTION 'different bank amount accepted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE fixture record; BEGIN
 FOR fixture IN SELECT * FROM public.custody_fixture LOOP
  IF piggyvest_primary_card.read_operation(fixture.scope,fixture.operation_id)->>'status'<>'completed' THEN RAISE EXCEPTION 'completion not readable by API'; END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.customer_wallets WHERE available_balance<>292 OR total_earned<>7) THEN RAISE EXCEPTION 'legacy funds lost or duplicate credit'; END IF;
 IF (SELECT count(*) FROM public.customer_wallet_transactions)<>2 OR (SELECT count(*) FROM piggyvest_primary.inflow_receipts)<>2 THEN RAISE EXCEPTION 'collection custody credit not exact once'; END IF;
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>10000 OR (SELECT consumed_kobo FROM prefunded_card.treasury_bindings)<>70000 THEN RAISE EXCEPTION 'legacy treasury counters lost or debit duplicated'; END IF;
 IF (SELECT count(*) FROM piggyvest_primary_card.receivables)<>2 OR (SELECT count(*) FROM piggyvest_primary_card.completion_outbox)<>2 THEN RAISE EXCEPTION 'durable completion missing'; END IF;
 IF EXISTS(SELECT 1 FROM prefunded_card.treasury_replenishments) THEN RAISE EXCEPTION 'receivable magically replenished treasury'; END IF;
END $$;
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE fixture record; BEGIN
 FOR fixture IN SELECT * FROM public.custody_fixture LOOP
  IF piggyvest_primary_card.flag_reconciliation(fixture.scope,fixture.operation_id) THEN RAISE EXCEPTION 'completed operation regressed to reconciliation'; END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM piggyvest_primary_card.operations operation JOIN public.custody_fixture fixture ON fixture.operation_id=operation.id WHERE operation.state<>'completed') THEN RAISE EXCEPTION 'late reconciliation mutated terminal custody'; END IF;
END $$;
\endif
