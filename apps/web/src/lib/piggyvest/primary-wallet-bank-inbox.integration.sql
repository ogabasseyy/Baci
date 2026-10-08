\set ON_ERROR_STOP on
\set hold_custody 1
\ir primary-wallet-card-custody.integration.sql
\ir ../../../../../supabase/migrations/20261007230000_primary_bank_signed_inbox.sql
\ir ../../../../../supabase/migrations/20261007230100_primary_bank_custody_prerequisite.sql
\ir ../../../../../supabase/migrations/20261007230200_primary_bank_inbox_worker.sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public,prefunded_card,piggyvest_staging FROM PUBLIC;
CREATE ROLE baci_primary_bank_intake LOGIN VALID UNTIL '2099-01-01T00:00:00Z';
CREATE ROLE baci_primary_bank_worker LOGIN VALID UNTIL '2099-01-01T00:00:00Z';
GRANT primary_bank_signed_intake TO baci_primary_bank_intake;
GRANT primary_bank_inbox_worker TO baci_primary_bank_worker;
INSERT INTO piggyvest_primary.bank_inbox_authorities VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','fixture-business','staging','baci_primary_bank_intake','baci_primary_bank_worker',true,'2099-01-01T00:00:00Z');
CREATE TEMP TABLE bank_fixture(label text PRIMARY KEY,scope jsonb,raw_hex text,receipt jsonb,stored_claim jsonb);
GRANT SELECT,UPDATE ON pg_temp.bank_fixture TO baci_primary_bank_intake,baci_primary_bank_worker;
INSERT INTO pg_temp.bank_fixture(label,scope,receipt)
SELECT 'card',jsonb_build_object('merchantId',scope->>'merchantId','businessId','fixture-business','expiresAt','2099-01-01T00:00:00.000Z'),bank
FROM public.custody_fixture WHERE label='third@example.test';
UPDATE pg_temp.bank_fixture SET receipt=jsonb_set(receipt,'{eventId}','"bank-card"');
INSERT INTO pg_temp.bank_fixture(label,scope,receipt) SELECT 'bank',scope,receipt||jsonb_build_object('eventId','bank-independent','providerTransactionId','unrelated-deposit','amountKobo',10000) FROM pg_temp.bank_fixture WHERE label='card';
UPDATE pg_temp.bank_fixture SET raw_hex=encode(convert_to(jsonb_build_object('eventId',receipt->'eventId','eventType','bank-transfer.inflow.success',
 'customer_id',receipt->'providerCustomerId','pvb_wallet',receipt->'providerWalletId',
 'eventData',jsonb_build_object('id',receipt->'eventDataId','transaction_id',receipt->'providerTransactionId','customer_id',receipt->'providerCustomerId',
 'amount',receipt->'amountKobo','fee',receipt->'feeKobo','currency',receipt->'currency','reference',receipt->'reference',
 'session_id',receipt->'sessionId','timestamp',receipt->'creditedAt'))::text,'UTF8'),'hex');
UPDATE pg_temp.bank_fixture SET receipt=jsonb_set(receipt,'{creditedAt}',to_jsonb(to_char(date_trunc('milliseconds',(receipt->>'creditedAt')::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
UPDATE pg_temp.bank_fixture SET receipt=jsonb_set(receipt,'{bodyDigest}',to_jsonb(encode(sha256(decode(raw_hex,'hex')),'hex')));
SET SESSION AUTHORIZATION baci_primary_bank_intake;
DO $$ DECLARE fixture record; BEGIN
 FOR fixture IN SELECT * FROM pg_temp.bank_fixture LOOP
  IF piggyvest_primary.enqueue_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('rawHex',fixture.raw_hex,'signature',repeat('a',128)))<>'accepted' THEN RAISE EXCEPTION 'bank intake failed'; END IF;
  IF piggyvest_primary.enqueue_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('rawHex',fixture.raw_hex,'signature',repeat('a',128)))<>'duplicate' THEN RAISE EXCEPTION 'duplicate intake lost'; END IF;
 END LOOP;
 BEGIN
  PERFORM piggyvest_primary.claim_bank_inbox('10000000-0000-4000-8000-000000000004','staging',(SELECT scope FROM pg_temp.bank_fixture LIMIT 1),'{"batchSize":1}');
  RAISE EXCEPTION 'intake claimed financial worker';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF piggyvest_primary.enqueue_bank_inbox('10000000-0000-4000-8000-000000000004','staging',(SELECT scope FROM pg_temp.bank_fixture LIMIT 1),
 jsonb_build_object('rawHex',encode(convert_to('{"eventId":"legacy","eventType":"bank-transfer.inflow.success","customer_id":"legacy","pvb_wallet":"legacy"}','UTF8'),'hex'),'signature',repeat('a',128)))<>'not_handled' THEN RAISE EXCEPTION 'legacy bank intercepted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ DECLARE leased jsonb; fixture record; BEGIN
 FOR leased IN SELECT value FROM jsonb_array_elements(piggyvest_primary.claim_bank_inbox('10000000-0000-4000-8000-000000000004','staging',(SELECT scope FROM pg_temp.bank_fixture LIMIT 1),'{"batchSize":10}')) LOOP
  SELECT * INTO fixture FROM pg_temp.bank_fixture WHERE receipt->>'eventId'=leased->>'eventId';
  UPDATE pg_temp.bank_fixture SET stored_claim=leased WHERE label=fixture.label;
  BEGIN
   PERFORM piggyvest_primary.process_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('eventId',leased->'eventId','token',leased->'token','receipt',jsonb_set(fixture.receipt,'{amountKobo}','999')));
   RAISE EXCEPTION 'signed amount changed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF piggyvest_primary.process_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('eventId',leased->'eventId','token',leased->'token','receipt',fixture.receipt))<>'prerequisite' THEN RAISE EXCEPTION 'bank-before-card was not deferred'; END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM piggyvest_primary.bank_signed_inbox WHERE state<>'pending' OR reason<>'prerequisite') THEN RAISE EXCEPTION 'bank prerequisite dropped'; END IF;
 IF (SELECT available_balance FROM public.customer_wallets wallet JOIN public.customers customer ON customer.id=wallet.customer_id WHERE customer.email='third@example.test')<>42 THEN RAISE EXCEPTION 'premature bank credit'; END IF;
END $$;
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',fixture.proof)<>'completed' THEN RAISE EXCEPTION 'card proof failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.bank_signed_inbox SET available_at=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ DECLARE leased jsonb; fixture record; outcome text; BEGIN
 FOR leased IN SELECT value FROM jsonb_array_elements(piggyvest_primary.claim_bank_inbox('10000000-0000-4000-8000-000000000004','staging',(SELECT scope FROM pg_temp.bank_fixture LIMIT 1),'{"batchSize":10}')) LOOP
  SELECT * INTO fixture FROM pg_temp.bank_fixture WHERE receipt->>'eventId'=leased->>'eventId';
  outcome:=piggyvest_primary.process_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('eventId',leased->'eventId','token',leased->'token','receipt',fixture.receipt));
  IF outcome<>(CASE WHEN fixture.label='card' THEN 'duplicate' ELSE 'credited' END) THEN RAISE EXCEPTION 'bank replay attribution guessed'; END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM piggyvest_primary.bank_signed_inbox WHERE state<>'processed') THEN RAISE EXCEPTION 'bank replay failed'; END IF;
 IF (SELECT available_balance FROM public.customer_wallets wallet JOIN public.customers customer ON customer.id=wallet.customer_id WHERE customer.email='third@example.test')<>392 THEN RAISE EXCEPTION 'bank/card double credit or valid bank loss'; END IF;
 IF (SELECT total_earned FROM public.customer_wallets wallet JOIN public.customers customer ON customer.id=wallet.customer_id WHERE customer.email='third@example.test')<>7 THEN RAISE EXCEPTION 'bank counted as interest'; END IF;
 IF has_table_privilege('baci_primary_bank_worker','public.customer_wallets','UPDATE') OR has_function_privilege('baci_primary_bank_worker','piggyvest_primary.apply_inflow_environment(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'worker unbounded writes'; END IF;
 IF has_table_privilege('authenticated','piggyvest_primary.bank_signed_inbox','SELECT') THEN RAISE EXCEPTION 'raw bank bytes exposed'; END IF;
END $$;
INSERT INTO pg_temp.bank_fixture(label,scope,receipt,raw_hex)
 SELECT 'conflict',scope,jsonb_set(receipt,'{eventId}','"bank-conflict"'),encode(convert_to((convert_from(decode(raw_hex,'hex'),'UTF8')::jsonb||'{"eventId":"bank-conflict"}')::text,'UTF8'),'hex') FROM pg_temp.bank_fixture WHERE label='bank';
UPDATE pg_temp.bank_fixture SET receipt=jsonb_set(receipt,'{bodyDigest}',to_jsonb(encode(sha256(decode(raw_hex,'hex')),'hex'))) WHERE label='conflict';
SET SESSION AUTHORIZATION baci_primary_bank_intake;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM pg_temp.bank_fixture WHERE label='conflict';
 PERFORM piggyvest_primary.enqueue_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('rawHex',fixture.raw_hex,'signature',repeat('a',128)));
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ DECLARE leased jsonb; fixture record; BEGIN
 SELECT * INTO fixture FROM pg_temp.bank_fixture WHERE label='conflict';
 leased:=piggyvest_primary.claim_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,'{"batchSize":1}')->0;
 UPDATE pg_temp.bank_fixture SET stored_claim=leased WHERE label='conflict';
 IF piggyvest_primary.retry_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('eventId',leased->'eventId','token','10000000-0000-4000-8000-000000000009','reason','io_retry')) THEN RAISE EXCEPTION 'stale token accepted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.bank_signed_inbox SET lease_until=clock_timestamp()-interval '1 second' WHERE event_id='bank-conflict';
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ DECLARE leased jsonb; fixture record; BEGIN
 SELECT * INTO fixture FROM pg_temp.bank_fixture WHERE label='conflict';
 leased:=piggyvest_primary.claim_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,'{"batchSize":1}')->0;
 IF leased->>'token'=fixture.stored_claim->>'token' THEN RAISE EXCEPTION 'crash lease not fenced'; END IF;
 IF NOT piggyvest_primary.retry_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('eventId',leased->'eventId','token',leased->'token','reason','io_retry')) THEN RAISE EXCEPTION 'retry not durable'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.bank_signed_inbox SET attempts=50,available_at=clock_timestamp()-interval '1 second' WHERE event_id='bank-conflict';
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN
 IF piggyvest_primary.claim_bank_inbox('10000000-0000-4000-8000-000000000004','staging',(SELECT scope FROM pg_temp.bank_fixture LIMIT 1),'{"batchSize":1}')<>'[]'::jsonb THEN RAISE EXCEPTION 'retry limit unbounded'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM piggyvest_primary.bank_signed_inbox WHERE event_id='bank-conflict' AND state='blocked' AND reason='attempt_limit' AND octet_length(payload)>0) THEN RAISE EXCEPTION 'exhausted bank receipt discarded'; END IF;
 BEGIN UPDATE piggyvest_primary.bank_signed_inbox SET payload=convert_to('{}','UTF8'); RAISE EXCEPTION 'raw bank receipt mutable'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO pg_temp.bank_fixture(label,scope,receipt,raw_hex)
 SELECT 'financial',scope,receipt||'{"eventId":"financial-conflict","amountKobo":9999}'::jsonb,
 encode(convert_to(jsonb_set(jsonb_set(convert_from(decode(raw_hex,'hex'),'UTF8')::jsonb,'{eventId}','"financial-conflict"'),'{eventData,amount}','9999')::text,'UTF8'),'hex')
 FROM pg_temp.bank_fixture WHERE label='bank';
UPDATE pg_temp.bank_fixture SET receipt=jsonb_set(receipt,'{bodyDigest}',to_jsonb(encode(sha256(decode(raw_hex,'hex')),'hex'))) WHERE label='financial';
SET SESSION AUTHORIZATION baci_primary_bank_intake;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM pg_temp.bank_fixture WHERE label='financial';
 PERFORM piggyvest_primary.enqueue_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('rawHex',fixture.raw_hex,'signature',repeat('a',128)));
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ DECLARE leased jsonb; fixture record; BEGIN
 SELECT * INTO fixture FROM pg_temp.bank_fixture WHERE label='financial';
 leased:=piggyvest_primary.claim_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,'{"batchSize":1}')->0;
 IF piggyvest_primary.process_bank_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.scope,jsonb_build_object('eventId',leased->'eventId','token',leased->'token','receipt',fixture.receipt))<>'conflict' THEN RAISE EXCEPTION 'financial conflict weakened to prerequisite'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM piggyvest_primary.bank_signed_inbox WHERE event_id='financial-conflict' AND state='blocked' AND reason='financial_conflict') THEN RAISE EXCEPTION 'financial conflict not retained'; END IF;
END $$;
GRANT piggyvest_primary_evidence TO primary_bank_inbox_worker;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN
 IF piggyvest_primary.bank_role_safe(true) THEN RAISE EXCEPTION 'capability ancestor accepted'; END IF;
 BEGIN PERFORM piggyvest_primary.bank_inbox_readiness('10000000-0000-4000-8000-000000000004','staging',(SELECT scope FROM pg_temp.bank_fixture LIMIT 1)); RAISE EXCEPTION 'expanded ancestor ready'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
REVOKE piggyvest_primary_evidence FROM primary_bank_inbox_worker;
GRANT SELECT ON public.customer_wallets TO primary_bank_inbox_worker;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN IF piggyvest_primary.bank_role_safe(true) THEN RAISE EXCEPTION 'effective table grant accepted'; END IF; END $$;
RESET SESSION AUTHORIZATION;
REVOKE SELECT ON public.customer_wallets FROM primary_bank_inbox_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary.apply_inflow_environment(uuid,text,jsonb) TO primary_bank_inbox_worker;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN IF piggyvest_primary.bank_role_safe(true) THEN RAISE EXCEPTION 'expanded RPC accepted'; END IF; END $$;
RESET SESSION AUTHORIZATION;
REVOKE EXECUTE ON FUNCTION piggyvest_primary.apply_inflow_environment(uuid,text,jsonb) FROM primary_bank_inbox_worker;
REVOKE EXECUTE ON FUNCTION piggyvest_primary.process_bank_inbox(uuid,text,jsonb,jsonb) FROM primary_bank_inbox_worker;
SET SESSION AUTHORIZATION baci_primary_bank_worker;
DO $$ BEGIN IF piggyvest_primary.bank_role_safe(true) THEN RAISE EXCEPTION 'missing required RPC accepted'; END IF; END $$;
RESET SESSION AUTHORIZATION;
GRANT EXECUTE ON FUNCTION piggyvest_primary.process_bank_inbox(uuid,text,jsonb,jsonb) TO primary_bank_inbox_worker;
