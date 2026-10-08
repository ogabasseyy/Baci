\set ON_ERROR_STOP on
\set hold_custody 1
\ir primary-wallet-card-custody.integration.sql
\ir ../../../../../supabase/migrations/20261007200900_primary_card_signed_inbox.sql
\ir ../../../../../supabase/migrations/20261007201000_primary_card_signed_inbox_worker.sql
\ir ../../../../../supabase/migrations/20261008090100_primary_card_signed_inbox_deferred_retry.sql
CREATE TABLE public.signed_inbox_fixture(capability jsonb,envelope jsonb,raw_hex text,claim jsonb);
GRANT SELECT,UPDATE ON public.signed_inbox_fixture TO baci_primary_card_custody;
INSERT INTO public.signed_inbox_fixture(capability,envelope)
SELECT jsonb_build_object('contractId','fixture-contract','evidenceIssuer','fixture-issuer','treasuryWebhookCustomerId','fixture-business','transactionCustomerId','fixture-business',
 'payloadContract','wallet-transfer-outflow-v1','mappingContract','single-transaction-third-party-reference-v1','merchantId',scope->>'merchantId','businessId','fixture-business','expiresAt','2099-01-01T00:00:00Z'),
 jsonb_build_object('eventId',proof->>'eventId','eventType','wallet-transfer.outflow.success','eventCategory','wallet-transfer','customer_id','fixture-business','pvb_wallet','owner-treasury','pvb_reference','canonical-'||label,'eventData',jsonb_build_object('amount',25000,'currency','NGN'))
FROM public.custody_fixture WHERE label='third@example.test';
UPDATE public.signed_inbox_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 IF piggyvest_primary_card.inbox_ready('10000000-0000-4000-8000-000000000004','staging',fixture.capability) THEN RAISE EXCEPTION 'unconfigured capability ready'; END IF;
 BEGIN
  PERFORM piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,fixture.raw_hex,repeat('a',128));
  RAISE EXCEPTION 'unconfigured raw intake accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_primary_card.inbox_capabilities VALUES('10000000-0000-4000-8000-000000000004','fixture-contract','fixture-issuer','fixture-business','fixture-business','wallet-transfer-outflow-v1','single-transaction-third-party-reference-v1',true);
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ <<inbox_test>> DECLARE fixture record; claim jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 IF piggyvest_primary_card.signed_inbox_readiness('10000000-0000-4000-8000-000000000004','staging',fixture.capability)->>'sourceWalletId'<>'owner-treasury' THEN RAISE EXCEPTION 'wrong owner routing'; END IF;
 IF piggyvest_primary_card.inbox_ready('10000000-0000-4000-8000-000000000004','staging',jsonb_set(fixture.capability,'{contractId}','"unapproved"')) THEN RAISE EXCEPTION 'unapproved mapping ready'; END IF;
 IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,fixture.raw_hex,repeat('a',128))<>'accepted' THEN RAISE EXCEPTION 'durable intake failed'; END IF;
 IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,fixture.raw_hex,repeat('a',128))<>'duplicate' THEN RAISE EXCEPTION 'raw retry not deduped'; END IF;
 IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,encode(convert_to((fixture.envelope||'{"eventData":{"amount":24999}}')::text,'UTF8'),'hex'),repeat('a',128))<>'conflict' THEN RAISE EXCEPTION 'alternate raw bytes not quarantined'; END IF;
 claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2)->0;
 UPDATE public.signed_inbox_fixture SET claim=inbox_test.claim;
 IF claim->>'rawHex'<>fixture.raw_hex THEN RAISE EXCEPTION 'original signature bytes lost'; END IF;
 IF jsonb_array_length(piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2))<>0 THEN RAISE EXCEPTION 'concurrent lease duplicated'; END IF;
 IF piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claim->>'eventId',(claim->>'token')::uuid,'completed') THEN RAISE EXCEPTION 'inbox processed without custody ledger'; END IF;
 IF piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claim->>'eventId','10000000-0000-4000-8000-000000000009','io_retry') THEN RAISE EXCEPTION 'stale lease acknowledged'; END IF;
 IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claim->>'eventId',(claim->>'token')::uuid,'io_retry') THEN RAISE EXCEPTION 'retry state not durable'; END IF;
 IF piggyvest_primary_card.resolve_signed_reference('10000000-0000-4000-8000-000000000004','staging',fixture.capability,'pvb-first-primary-wrong','owner-treasury') IS NOT NULL THEN RAISE EXCEPTION 'guessed reference mapped'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT state FROM piggyvest_primary_card.signed_inbox)<>'pending' OR (SELECT reason FROM piggyvest_primary_card.signed_inbox)<>'io_retry' THEN RAISE EXCEPTION 'write failure discarded receipt'; END IF;
 IF (SELECT count(*) FROM piggyvest_primary_card.signed_inbox_conflicts)<>1 THEN RAISE EXCEPTION 'conflicting receipt not durable'; END IF;
 IF (SELECT count(*) FROM piggyvest_primary.inflow_receipts)<>1 THEN RAISE EXCEPTION 'intake credited custody'; END IF;
END $$;
UPDATE piggyvest_primary_card.signed_inbox SET available_at=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION baci_primary_card_custody;
UPDATE public.signed_inbox_fixture SET claim=piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',capability,2)->0;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.signed_inbox SET lease_until=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; refreshed jsonb; operation_id uuid; proof jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 refreshed := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2)->0;
 IF refreshed->>'token'=fixture.claim->>'token' OR (refreshed->>'attempts')::integer<>3 THEN RAISE EXCEPTION 'crashed lease not recovered'; END IF;
 operation_id := piggyvest_primary_card.resolve_signed_reference('10000000-0000-4000-8000-000000000004','staging',fixture.capability,(SELECT custody.proof->>'reference' FROM public.custody_fixture custody WHERE label='third@example.test'),'owner-treasury');
 IF operation_id IS DISTINCT FROM (SELECT custody.operation_id FROM public.custody_fixture custody WHERE label='third@example.test') THEN RAISE EXCEPTION 'exact stored mapping failed'; END IF;
 proof := (SELECT custody.proof FROM public.custody_fixture custody WHERE label='third@example.test')||jsonb_build_object('observedAt',clock_timestamp(),'bodyDigest',encode(sha256(decode(fixture.raw_hex,'hex')),'hex'));
 IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',proof)<>'completed' THEN RAISE EXCEPTION 'worker custody write failed'; END IF;
 IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,refreshed->>'eventId',(refreshed->>'token')::uuid,'completed') THEN RAISE EXCEPTION 'committed custody not acknowledged'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT count(*) FROM piggyvest_primary.inflow_receipts)<>2 OR (SELECT count(*) FROM public.customer_wallet_transactions)<>2 THEN RAISE EXCEPTION 'inbox replay duplicated credit'; END IF;
 IF (SELECT state FROM piggyvest_primary_card.signed_inbox)<>'processed' THEN RAISE EXCEPTION 'successful receipt pending'; END IF;
 IF has_table_privilege('baci_primary_card_custody','piggyvest_primary_card.signed_inbox','SELECT') OR has_function_privilege('service_role','piggyvest_primary_card.enqueue_signed_inbox(uuid,text,jsonb,text,text)','EXECUTE') THEN RAISE EXCEPTION 'raw inbox capability exposed'; END IF;
END $$;
UPDATE public.signed_inbox_fixture SET envelope=envelope||'{"eventId":"new-signed-duplicate"}';
UPDATE public.signed_inbox_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; replay_proof jsonb; claimed jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 PERFORM piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,fixture.raw_hex,repeat('a',128));
 claimed := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2)->0;
 replay_proof := (SELECT proof FROM public.custody_fixture WHERE label='third@example.test')||jsonb_build_object('eventId','new-signed-duplicate','observedAt',clock_timestamp(),'bodyDigest',encode(sha256(decode(fixture.raw_hex,'hex')),'hex'));
 IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',replay_proof)<>'duplicate' THEN RAISE EXCEPTION 'new event replay duplicated settlement'; END IF;
 IF piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claimed->>'eventId','10000000-0000-4000-8000-000000000009','duplicate') THEN RAISE EXCEPTION 'stale completion token accepted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.signed_inbox SET lease_until=clock_timestamp()-interval '1 second' WHERE state='processing';
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; replay_proof jsonb; claimed jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 claimed := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2)->0;
 replay_proof := (SELECT proof FROM public.custody_fixture WHERE label='third@example.test')||jsonb_build_object('eventId','new-signed-duplicate','observedAt',clock_timestamp(),'bodyDigest',encode(sha256(decode(fixture.raw_hex,'hex')),'hex'));
 IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',replay_proof)<>'duplicate' THEN RAISE EXCEPTION 'lost ack replay duplicated credit'; END IF;
 IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claimed->>'eventId',(claimed->>'token')::uuid,'duplicate') THEN RAISE EXCEPTION 'verified duplicate observation not acknowledged'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT count(*) FROM piggyvest_primary_card.signed_inbox WHERE state='processed')<>2 OR (SELECT count(*) FROM public.customer_wallet_transactions)<>2 THEN RAISE EXCEPTION 'replay after settlement crash not exact once'; END IF;
END $$;
SET SESSION AUTHORIZATION fixture_bank_inflow;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',fixture.bank)<>'duplicate' THEN RAISE EXCEPTION 'inbox custody then bank alias duplicated credit'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_custody;
UPDATE public.signed_inbox_fixture SET envelope=envelope||'{"eventId":"exhausted-signed-receipt"}';
UPDATE public.signed_inbox_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
SELECT piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',capability,raw_hex,repeat('a',128)) FROM public.signed_inbox_fixture;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.signed_inbox SET attempts=50 WHERE event_id='exhausted-signed-receipt';
SET SESSION AUTHORIZATION baci_primary_card_custody;
SELECT piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',capability,2) FROM public.signed_inbox_fixture;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM piggyvest_primary_card.signed_inbox WHERE event_id='exhausted-signed-receipt' AND state='blocked' AND reason='attempts_exhausted') THEN RAISE EXCEPTION 'retry exhausted receipt discarded'; END IF;
 IF (SELECT count(*) FROM public.customer_wallet_transactions)<>2 THEN RAISE EXCEPTION 'retry bound credited funds'; END IF;
END $$;
SET SESSION AUTHORIZATION baci_primary_card_custody;
UPDATE public.signed_inbox_fixture SET envelope=envelope||'{"eventId":"deferred-signed-receipt"}';
UPDATE public.signed_inbox_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
SELECT piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',capability,raw_hex,repeat('a',128)) FROM public.signed_inbox_fixture;
DO $$ DECLARE fixture record; claim jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2)->0;
 IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claim->>'eventId',(claim->>'token')::uuid,'deferred') THEN RAISE EXCEPTION 'deferred outcome not durable'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.signed_inbox SET attempts=50,available_at=clock_timestamp()-interval '1 second' WHERE event_id='deferred-signed-receipt';
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; claim jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2)->0;
 IF claim->>'eventId' IS DISTINCT FROM 'deferred-signed-receipt' THEN RAISE EXCEPTION 'deferred receipt blocked at cap'; END IF;
 IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claim->>'eventId',(claim->>'token')::uuid,'deferred') THEN RAISE EXCEPTION 'capped deferred outcome lost'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.signed_inbox SET available_at=clock_timestamp()-interval '1 second' WHERE event_id='deferred-signed-receipt';
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; claim jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,2)->0;
 IF claim->>'eventId' IS DISTINCT FROM 'deferred-signed-receipt' THEN RAISE EXCEPTION 'transient receipt blocked at cap'; END IF;
 IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,claim->>'eventId',(claim->>'token')::uuid,'io_retry') THEN RAISE EXCEPTION 'capped transient outcome lost'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM piggyvest_primary_card.signed_inbox WHERE event_id='deferred-signed-receipt' AND state='pending' AND reason='io_retry' AND attempts=50) THEN RAISE EXCEPTION 'deferred receipt exhausted'; END IF;
 IF (SELECT count(*) FROM public.customer_wallet_transactions)<>2 THEN RAISE EXCEPTION 'deferred retry credited funds'; END IF;
END $$;
