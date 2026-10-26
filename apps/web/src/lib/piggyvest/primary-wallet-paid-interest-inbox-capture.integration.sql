\set ON_ERROR_STOP on
\ir primary-wallet-paid-interest-inbox.integration.sql
\ir ../../../../../supabase/migrations/20261025181703_piggyvest_primary_interest_inbox_capture.sql
CREATE FUNCTION pg_temp.capture_raw(raw bytea) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.enqueue_paid_interest_inbox('00000000-0000-4000-8000-000000000005','production',
    jsonb_build_object('rawHex',encode(raw,'hex'),'signature',repeat('b',128)));
$$;
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount)
VALUES(pg_temp.goal_id(50),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',130,100);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT integration_id,pg_temp.goal_id(50),intent_id,'production-api-wallet-50',true
FROM piggyvest_primary.savings_destinations WHERE goal_id=pg_temp.goal_id(49);
INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id,goal_id,primary_intent_id,wallet_name,state,provider_wallet_id,interest_accepted,interest_accepted_at)
SELECT integration_id,pg_temp.goal_id(50),primary_intent_id,'synthetic-interest-inbox-replay-50','enrolled',
  'production-api-wallet-50',true,interest_accepted_at
FROM piggyvest_primary.goal_wallet_intents WHERE goal_id=pg_temp.goal_id(49);
INSERT INTO piggyvest_primary.paid_interest_crosswalks(id,integration_id,goal_id,api_wallet_id,api_customer_id,onboarding_customer_id,
  webhook_customer_id,source_wallet_id,accrued_wallet_id,destination_wallet_id,envelope_destination_wallet_id,
  provider_evidence_sha256,policy_evidence_sha256,policy_reference,allocation_policy,enabled)
SELECT pg_temp.goal_id(50),integration_id,pg_temp.goal_id(50),'production-api-wallet-50',api_customer_id,onboarding_customer_id,
  webhook_customer_id,source_wallet_id,accrued_wallet_id,'prod-internal-destination-50',envelope_destination_wallet_id,
  provider_evidence_sha256,policy_evidence_sha256,policy_reference,allocation_policy,true
FROM piggyvest_primary.paid_interest_crosswalks WHERE id=pg_temp.goal_id(49);
CREATE FUNCTION pg_temp.capture_replay_payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('eventId','capture-replay-50','eventType','interest-payout.success','eventCategory','interest-payout',
    'customer_id',proof->'webhookCustomerId','pvb_wallet',proof->'sourceWalletId',
    'pvb_accrued_interest_wallet',proof->'accruedWalletId','pvb_destination_wallet',NULL,
    'pvb_third_party_reference',NULL,'pvb_reference',proof->'envelopeReference',
    'eventData',jsonb_build_object('id',proof->'payoutId','amount',proof->'amountKobo',
      'currency','NGN','destination_wallet',proof->'destinationWalletId','reference',proof->'reference',
      'timestamp',proof->'paidAt','batch_id',proof->'batchId',
      'break_down',jsonb_build_object('gross_interest_payout',proof->'grossKobo','withholding_tax',proof->'taxKobo',
        'net_interest_payout',proof->'netKobo')),
    'unknownNestedField',jsonb_build_object('label','Luna 🌙','nested',jsonb_build_array('café',jsonb_build_object('kept',true))))
  FROM (SELECT pg_temp.production_goal_proof(50) AS proof) selected;
$$;
CREATE TEMP TABLE capture_replay_claims(label text PRIMARY KEY,claim jsonb);
GRANT SELECT,INSERT ON capture_replay_claims TO production_primary_interest_fixture;
CREATE TEMP TABLE capture_replay_raw AS
SELECT convert_to('  '||pg_temp.capture_replay_payload()::text||E'\n  ','UTF8') AS payload;
GRANT SELECT ON capture_replay_raw TO production_primary_interest_fixture;
SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(' {"broken":','UTF8'))='quarantined',
  'Signed malformed JSON is durably quarantined');
SELECT pg_temp.assert_true(pg_temp.capture_raw(decode('ff00','hex'))='quarantined',
  'Signed invalid UTF-8 bytes are durably quarantined');
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(repeat('[',2000)||'0'||repeat(']',2000),'UTF8'))='quarantined',
  'Signed bounded deeply nested JSON is durably quarantined when PostgreSQL reaches its parse limit');
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(
  '{"eventType":"interest-payout.success","eventCategory":"interest-payout","eventId":"unmapped-capture","pvb_wallet":"unmapped-wallet"}',
  'UTF8'))='quarantined','Signed wallet-unmapped interest receipt is durably quarantined');
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(
  '{"eventType":"interest-payout.success","eventCategory":"interest-payout","eventId":"capture-conflict","pvb_wallet":"first"}',
  'UTF8'))='quarantined','Signed unmapped event variant is quarantined on arrival');
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(
  '{"eventType":"interest-payout.success","eventCategory":"interest-payout","eventId":"capture-conflict","pvb_wallet":"second"}',
  'UTF8'))='quarantined','Same-event different raw bytes remain quarantined');
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(
  '{"eventType":"interest-payout.success","eventCategory":"interest-payout","eventId":"capture-conflict","pvb_wallet":"first"}',
  'UTF8'))='quarantined','A replay cannot automatically release an archived conflict');
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(pg_temp.inbox_payload('capture-pending')::text,'UTF8'))='accepted',
  'Mapped signed receipt first enters the existing pending worker workflow');
SELECT pg_temp.assert_true(pg_temp.capture_raw((SELECT payload FROM capture_replay_raw))='accepted',
  'New migration accepts exact whitespace, Unicode, and unknown nested fields for an eligible synthetic goal');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.paid_interest_inbox SET available_at=clock_timestamp()-interval '1 second'
  WHERE event_id='capture-pending';
UPDATE piggyvest_primary.paid_interest_inbox SET available_at=clock_timestamp()+interval '1 hour'
  WHERE event_id='capture-replay-50';
CREATE TEMP TABLE capture_pending_claim(claim jsonb);
GRANT SELECT,INSERT ON capture_pending_claim TO production_primary_interest_fixture;
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO capture_pending_claim
  SELECT item FROM jsonb_array_elements(piggyvest_primary.claim_paid_interest_inbox(
    '00000000-0000-4000-8000-000000000005','production','{"batchSize":10}')) item
  WHERE item->>'eventId'='capture-pending';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM capture_pending_claim),'Mapped receipt obtains an existing worker lease');
SELECT pg_temp.assert_true(pg_temp.capture_raw(convert_to(jsonb_set(pg_temp.inbox_payload('capture-pending'),
  '{eventCategory}','"invalid-category"')::text,'UTF8'))='quarantined',
  'Malformed category with safe original event ID quarantines the claimed receipt');
SELECT pg_temp.assert_true(NOT pg_temp.inbox_finish((SELECT claim FROM capture_pending_claim),'io_retry'),
  'Conflict invalidates the original worker lease');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.paid_interest_inbox SET available_at=clock_timestamp()-interval '1 second'
  WHERE event_id='capture-replay-50';
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO capture_replay_claims
  SELECT 'first',item FROM jsonb_array_elements(piggyvest_primary.claim_paid_interest_inbox(
    '00000000-0000-4000-8000-000000000005','production','{"batchSize":10}')) item
  WHERE item->>'eventId'='capture-replay-50';
SELECT pg_temp.assert_true((SELECT claim->>'rawHex'=encode((SELECT payload FROM capture_replay_raw),'hex')
  AND claim->>'signature'=repeat('b',128) FROM capture_replay_claims WHERE label='first'),
  'First claim preserves the original exact signed bytes for worker replay');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(50)||jsonb_build_object(
  'eventId','capture-replay-50','bodyDigest',(SELECT claim->'bodyDigest' FROM capture_replay_claims WHERE label='first')))='credited',
  'Claimed signed receipt applies once through the existing production interest ledger');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.paid_interest_inbox SET lease_until=clock_timestamp()-interval '1 second'
  WHERE event_id='capture-replay-50';
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO capture_replay_claims
  SELECT 'reclaimed',item FROM jsonb_array_elements(piggyvest_primary.claim_paid_interest_inbox(
    '00000000-0000-4000-8000-000000000005','production','{"batchSize":10}')) item
  WHERE item->>'eventId'='capture-replay-50';
SELECT pg_temp.assert_true((SELECT claim->>'rawHex'=encode((SELECT payload FROM capture_replay_raw),'hex')
  AND claim->>'signature'=repeat('b',128) FROM capture_replay_claims WHERE label='reclaimed'),
  'Expired-lease replay preserves the original exact signed bytes and signature');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(50)||jsonb_build_object(
  'eventId','capture-replay-50','bodyDigest',(SELECT claim->'bodyDigest' FROM capture_replay_claims WHERE label='reclaimed')))='duplicate',
  'Crash replay after ledger commit deduplicates the same signed receipt');
SELECT pg_temp.assert_true(NOT pg_temp.inbox_finish((SELECT claim FROM capture_replay_claims WHERE label='first'),'io_retry'),
  'Expired worker lease cannot finish after capture replay reclaim');
SELECT pg_temp.assert_true(pg_temp.inbox_finish((SELECT claim FROM capture_replay_claims WHERE label='reclaimed'),'duplicate'),
  'Reclaimed crash replay is durably completed exactly once');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(net_kobo)=3000 FROM piggyvest_primary.paid_interest_receipts
  WHERE goal_id=pg_temp.goal_id(50) AND payout_id='payout-50'),
  'Claimed capture and crash replay retain exactly one paid-interest financial receipt');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM savings_notifications.events
  WHERE goal_id=pg_temp.goal_id(50) AND type='interest_credited'),
  'Claimed capture and crash replay enqueue exactly one savings interest notification');
SELECT pg_temp.assert_true((SELECT state='processed' AND reason IS NULL AND payload=(SELECT payload FROM capture_replay_raw)
  AND signature=repeat('b',128) AND body_digest=encode(sha256((SELECT payload FROM capture_replay_raw)),'hex')
  FROM piggyvest_primary.paid_interest_inbox WHERE event_id='capture-replay-50'),
  'Worker completion leaves original whitespace, Unicode, extension bytes, signature, and digest unchanged');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM piggyvest_primary.paid_interest_inbox_observations
  WHERE event_id='capture-replay-50' AND payout_id='payout-50'
    AND body_digest=encode(sha256((SELECT payload FROM capture_replay_raw)),'hex')),
  'Crash recovery records one exact raw-digest financial observation');
SELECT pg_temp.assert_true((SELECT encode(payload,'hex')=encode(convert_to(' {"broken":','UTF8'),'hex')
  AND signature=repeat('b',128) AND state='quarantined' AND reason='invalid_receipt'
  FROM piggyvest_primary.paid_interest_inbox WHERE event_id='raw:'||encode(sha256(convert_to(' {"broken":','UTF8')),'hex')),
  'Malformed receipt retains the exact raw bytes and signature with an invalid_receipt reason');
SELECT pg_temp.assert_true((SELECT encode(payload,'hex')='ff00' AND state='quarantined' AND reason='invalid_receipt'
  FROM piggyvest_primary.paid_interest_inbox WHERE event_id='raw:'||encode(sha256(decode('ff00','hex')),'hex')),
  'Invalid UTF-8 receipt is addressable by deterministic digest without losing bytes');
SELECT pg_temp.assert_true((SELECT state='quarantined' AND reason='invalid_receipt'
  FROM piggyvest_primary.paid_interest_inbox WHERE event_id='unmapped-capture'),
  'Unmapped signed receipt remains explicit quarantine and cannot enter pending work');
SELECT pg_temp.assert_true((SELECT state='quarantined' AND reason='event_conflict'
  FROM piggyvest_primary.paid_interest_inbox WHERE event_id='capture-conflict'),
  'Capture conflict cannot reset the original quarantined inbox row');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(encode(payload,'hex')=encode(convert_to(
  '{"eventType":"interest-payout.success","eventCategory":"interest-payout","eventId":"capture-conflict","pvb_wallet":"second"}','UTF8'),'hex')
  AND signature=repeat('b',128)) FROM piggyvest_primary.paid_interest_inbox_conflicts WHERE event_id='capture-conflict'),
  'Conflicting raw variant and signature are stored exactly once');
SELECT pg_temp.assert_true((SELECT state='quarantined' AND reason='event_conflict' AND claim_token IS NULL AND lease_until IS NULL
  AND encode(payload,'hex')=encode(convert_to(pg_temp.inbox_payload('capture-pending')::text,'UTF8'),'hex')
  FROM piggyvest_primary.paid_interest_inbox WHERE event_id='capture-pending'),
  'Malformed same-event bytes preserve original pending bytes and invalidate its lease');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(signature=repeat('b',128) AND encode(payload,'hex')=encode(convert_to(
  jsonb_set(pg_temp.inbox_payload('capture-pending'),'{eventCategory}','"invalid-category"')::text,'UTF8'),'hex')
  ) FROM piggyvest_primary.paid_interest_inbox_conflicts WHERE event_id='capture-pending'),
  'Malformed same-event variant is archived exactly with its signature');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM piggyvest_primary.paid_interest_inbox
  WHERE event_id IN ('unmapped-capture','capture-conflict','capture-pending') AND state IN ('pending','processing')),
  'Unmapped and conflicting captures are excluded from worker claims');
SELECT pg_temp.assert_true(NOT has_table_privilege('production_primary_interest_fixture','piggyvest_primary.paid_interest_inbox','UPDATE')
  AND NOT has_table_privilege('service_role','piggyvest_primary.paid_interest_inbox','SELECT'),
  'Capture migration preserves restricted inbox ACLs');
SELECT pg_temp.assert_true((SELECT wallet.available_balance=saved.available_balance AND wallet.total_earned=saved.total_earned
  FROM public.customer_wallets wallet CROSS JOIN inbox_cash_before saved),
  'Capture and quarantine do not perform financial writes');
SET SESSION AUTHORIZATION authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_primary.enqueue_paid_interest_inbox('00000000-0000-4000-8000-000000000005','production',
      jsonb_build_object('rawHex','ff','signature',repeat('a',128)));
    RAISE EXCEPTION 'Untrusted role gained signed intake authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated',
  'piggyvest_primary.enqueue_paid_interest_inbox(uuid,text,jsonb)','EXECUTE'),
  'Capture migration retains the signature-verifier-only execute grant');
DO $$ BEGIN
  BEGIN
    UPDATE piggyvest_primary.paid_interest_inbox SET signature=repeat('c',128) WHERE event_id='unmapped-capture';
    RAISE EXCEPTION 'Signed receipt signature changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE piggyvest_primary.paid_interest_inbox SET payload=convert_to('{}','UTF8') WHERE event_id='unmapped-capture';
    RAISE EXCEPTION 'Signed receipt raw bytes changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PRIMARY paid-interest raw capture regressions passed' AS result;
