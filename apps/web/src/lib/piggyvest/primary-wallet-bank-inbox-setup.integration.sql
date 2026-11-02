\set ON_ERROR_STOP on
\set hold_custody 1
\ir primary-wallet-card-custody.integration.sql
\ir ../../../../../supabase/migrations/20261007230000_primary_bank_signed_inbox.sql
\ir ../../../../../supabase/migrations/20261007230100_primary_bank_custody_prerequisite.sql
\ir ../../../../../supabase/migrations/20261008091000_primary_bank_hold_specificity.sql
\ir ../../../../../supabase/migrations/20261007230200_primary_bank_inbox_worker.sql
\ir ../../../../../supabase/migrations/20261008093600_primary_bank_inbox_expiry_drain.sql
\ir ../../../../../supabase/migrations/20261008093100_primary_inflow_receipt_deletion_detach.sql
\ir ../../../../../supabase/migrations/20261008093700_primary_bank_inbox_unsettled_deletion_block.sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public,prefunded_card,piggyvest_staging,piggyvest_primary_card FROM PUBLIC;
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
