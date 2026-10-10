INSERT INTO piggyvest_savings_ledger.bindings VALUES (
  '33333333-3333-4333-8333-333333333333','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
  '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','reversal_worker',true
);
INSERT INTO prefunded_card.credit_routes VALUES (
  '33333333-3333-4333-8333-333333333333','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
  '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
  (SELECT system_identifier::text FROM pg_control_system()),now()
);
GRANT USAGE ON SCHEMA prefunded_card TO reversal_worker,other_worker,treasury_owner,treasury_verifier;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA prefunded_card TO reversal_worker,other_worker;
GRANT EXECUTE ON FUNCTION prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint) TO treasury_owner;
GRANT EXECUTE ON FUNCTION prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint) TO treasury_verifier;
SET SESSION AUTHORIZATION treasury_owner;
SELECT prefunded_card.provision_treasury_identity(
  '50000000-0000-4000-8000-000000000001','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
  '11111111-1111-4111-8111-111111111111','business','source-wallet','reversal_worker',100000
);
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot('50000000-0000-4000-8000-000000000001','opening',1,clock_timestamp(),100000);
RESET SESSION AUTHORIZATION;
CREATE SCHEMA reversal_test;
GRANT USAGE ON SCHEMA reversal_test TO reversal_worker,other_worker;
CREATE FUNCTION reversal_test.assert(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF; END $$;
CREATE FUNCTION reversal_test.denied(query text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE query;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation OR invalid_parameter_value THEN RETURN;
  END;
  RAISE EXCEPTION 'assertion failed: %',label;
END $$;
CREATE FUNCTION reversal_test.operation(sequence integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('70000000-0000-4000-8000-'||lpad(sequence::text,12,'0'))::uuid;
$$;
CREATE FUNCTION reversal_test.command(sequence integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'operationId',reversal_test.operation(sequence),'integrationId','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'merchantId','11111111-1111-4111-8111-111111111111','customerId','22222222-2222-4222-8222-222222222222',
    'goalId','33333333-3333-4333-8333-333333333333','treasuryBindingId','50000000-0000-4000-8000-000000000001',
    'requestFingerprint','fingerprint-reversal-'||sequence,'idempotencyKey','idempotency-reversal-'||sequence,
    'savedMethodId','60000000-0000-4000-8000-000000000001','amountKobo',10000,'feeAllowanceKobo',0,'currency','NGN',
    'collectionReference','collection-'||sequence,'transferReference','transfer-'||sequence,
    'destinationWalletId','scratch-private-wallet','destinationCustomerId','scratch-event-customer'
  );
$$;
CREATE FUNCTION reversal_test.collection(sequence integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('reference','collection-'||sequence,'amountKobo',10000,'currency','NGN',
    'savedMethodId','60000000-0000-4000-8000-000000000001','providerTransactionId',sequence::text);
$$;
CREATE FUNCTION reversal_test.event(sequence integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (reversal_test.command(sequence)-ARRAY['requestFingerprint','idempotencyKey','amountKobo','feeAllowanceKobo',
    'transferReference','destinationWalletId','destinationCustomerId']) || jsonb_build_object(
    'eventId','delivery-'||sequence,'collectionTransactionId',sequence::text,'collectionAmountKobo',10000,
    'providerStatus','reversed','domain','test');
$$;
CREATE FUNCTION reversal_test.transfer(sequence integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('reference','transfer-'||sequence,'amountKobo',10000,'currency','NGN',
    'businessId','business','sourceWalletId','source-wallet','destinationWalletId','scratch-private-wallet',
    'destinationCustomerId','scratch-event-customer','providerTransactionId','transfer-tx-'||sequence);
$$;
SET SESSION AUTHORIZATION reversal_worker;
SELECT prefunded_card.reserve(reversal_test.command(sequence)) FROM generate_series(1,8) sequence;
SELECT prefunded_card.claim_collection(reversal_test.operation(sequence),0) FROM generate_series(1,8) sequence;
SELECT prefunded_card.record_collection(reversal_test.operation(sequence),1,'verified_success',reversal_test.collection(sequence))
  FROM generate_series(1,7) sequence;
RESET SESSION AUTHORIZATION;
