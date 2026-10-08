CREATE ROLE evidence_ingestor LOGIN;
GRANT USAGE ON SCHEMA prefunded_card TO evidence_ingestor,projection_worker;
GRANT EXECUTE ON FUNCTION prefunded_card.evidence_scope(uuid,text),prefunded_card.evidence_destination_mapping(uuid,text,text),
  prefunded_card.record_provider_evidence(uuid,text,jsonb) TO evidence_ingestor;
GRANT EXECUTE ON FUNCTION prefunded_card.evidence_scope(uuid,text),prefunded_card.read_transfer_evidence(uuid,text),
  prefunded_card.classify_provider_inflow(uuid,text,text),prefunded_card.reserve(jsonb),
  prefunded_card.claim_collection(uuid,bigint),prefunded_card.record_collection(uuid,bigint,text,jsonb),
  prefunded_card.claim_transfer(uuid,bigint),prefunded_card.record_transfer(uuid,bigint,text,jsonb),
  prefunded_card.project(uuid,text),prefunded_card.apply_classified_inflow(uuid,text,text),
  prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz) TO projection_worker;
GRANT USAGE ON SCHEMA prefunded_card TO treasury_owner,treasury_verifier;
GRANT EXECUTE ON FUNCTION prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint) TO treasury_owner;
GRANT EXECUTE ON FUNCTION prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint) TO treasury_verifier;
INSERT INTO prefunded_card.evidence_authorities VALUES('d91d9e87-8e0d-44de-9b84-1e1d709633d2','business',
  (SELECT system_identifier::text FROM pg_control_system()),'evidence_ingestor','projection_worker','NGN',true);
INSERT INTO piggyvest_savings_ledger.bindings VALUES('33333333-3333-4333-8333-333333333333',
  'd91d9e87-8e0d-44de-9b84-1e1d709633d2','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','projection_worker',true);
INSERT INTO prefunded_card.credit_routes VALUES('33333333-3333-4333-8333-333333333333',
  'd91d9e87-8e0d-44de-9b84-1e1d709633d2','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',(SELECT system_identifier::text FROM pg_control_system()),now());
SET SESSION AUTHORIZATION treasury_owner;
SELECT prefunded_card.provision_treasury_identity('50000000-0000-4000-8000-000000000001',
  'd91d9e87-8e0d-44de-9b84-1e1d709633d2','11111111-1111-4111-8111-111111111111',
  'business','treasury-wallet','projection_worker',50000);
SET SESSION AUTHORIZATION treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot('50000000-0000-4000-8000-000000000001','opening',1,clock_timestamp(),50000);
RESET SESSION AUTHORIZATION;
CREATE FUNCTION public.evidence_fixture(p_event text,p_reference text,p_kind text DEFAULT 'internal_transfer',p_changes jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
  'eventId',p_event,'fingerprint',repeat('a',64),'eventType',CASE WHEN p_kind='bank_inflow' THEN 'bank-transfer.inflow.success' ELSE 'wallet-transfer.outflow.success' END,
  'eventCategory',CASE WHEN p_kind='bank_inflow' THEN 'bank-transfer' ELSE 'wallet-transfer' END,
  'status','verified','kind',p_kind,'providerTransactionId',p_event||'-transaction',
  'destinationCustomerId','scratch-event-customer','destinationWalletId','scratch-private-wallet',
  'sourceWalletId',CASE WHEN p_kind='bank_inflow' THEN '' ELSE 'treasury-wallet' END,
  'reference',p_reference,'references',jsonb_build_array(p_event||'-transaction',p_reference),
  'eventDataId',p_event||'-data','envelopeWalletId','scratch-private-wallet',
  'sessionId',p_event||'-session','creditedAt','2026-09-26T12:00:00Z',
  'amountKobo',10000,'feeKobo',0,'currency','NGN')||p_changes $$;
CREATE FUNCTION public.evidence_command(p_id uuid,p_reference text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('operationId',p_id,'integrationId','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'merchantId','11111111-1111-4111-8111-111111111111','customerId','22222222-2222-4222-8222-222222222222',
    'goalId','33333333-3333-4333-8333-333333333333','treasuryBindingId','50000000-0000-4000-8000-000000000001',
    'requestFingerprint',p_reference||'-fingerprint','idempotencyKey',p_reference||'-idempotency-key',
    'savedMethodId','60000000-0000-4000-8000-000000000001','amountKobo',10000,'feeAllowanceKobo',0,'currency','NGN',
    'collectionReference',p_reference||'-collection','transferReference',p_reference,
    'destinationWalletId','scratch-private-wallet','destinationCustomerId','scratch-event-customer') $$;
