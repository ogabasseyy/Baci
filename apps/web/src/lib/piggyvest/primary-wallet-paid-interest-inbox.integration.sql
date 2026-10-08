\set ON_ERROR_STOP on
\ir primary-wallet-paid-interest-production.integration.sql
\ir ../../../../../supabase/migrations/20261007220100_piggyvest_primary_interest_inbox.sql
\if :{?without_interest_inbox_worker}
\else
\ir ../../../../../supabase/migrations/20261007220101_piggyvest_primary_interest_inbox_worker.sql
\endif
\if :{?without_interest_inbox_observations}
ALTER FUNCTION piggyvest_primary.apply_paid_interest(uuid,text,jsonb) RENAME TO apply_paid_interest_inbox_wrapper_unused;
ALTER FUNCTION piggyvest_primary.apply_paid_interest_before_inbox(uuid,text,jsonb) RENAME TO apply_paid_interest;
GRANT EXECUTE ON FUNCTION piggyvest_primary.apply_paid_interest(uuid,text,jsonb) TO piggyvest_primary_evidence;
\endif
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount)
VALUES(pg_temp.goal_id(49),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',130,100);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT integration_id,pg_temp.goal_id(49),intent_id,'production-api-wallet-49',true FROM piggyvest_primary.savings_destinations WHERE goal_id=pg_temp.goal_id(48);
INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id,goal_id,primary_intent_id,wallet_name,state,provider_wallet_id,interest_accepted,interest_accepted_at)
SELECT integration_id,pg_temp.goal_id(49),primary_intent_id,'synthetic-interest-inbox-plan','enrolled','production-api-wallet-49',true,interest_accepted_at
FROM piggyvest_primary.goal_wallet_intents WHERE goal_id=pg_temp.goal_id(48);
INSERT INTO piggyvest_primary.paid_interest_crosswalks(id,integration_id,goal_id,api_wallet_id,api_customer_id,onboarding_customer_id,
  webhook_customer_id,source_wallet_id,accrued_wallet_id,destination_wallet_id,envelope_destination_wallet_id,
  provider_evidence_sha256,policy_evidence_sha256,policy_reference,allocation_policy,enabled)
SELECT pg_temp.goal_id(49),integration_id,pg_temp.goal_id(49),'production-api-wallet-49',api_customer_id,onboarding_customer_id,
  webhook_customer_id,source_wallet_id,accrued_wallet_id,'prod-internal-destination-49',envelope_destination_wallet_id,
  provider_evidence_sha256,policy_evidence_sha256,policy_reference,allocation_policy,false
FROM piggyvest_primary.paid_interest_crosswalks WHERE id=pg_temp.goal_id(48);
CREATE TEMP TABLE inbox_cash_before AS SELECT available_balance,total_earned FROM public.customer_wallets;
CREATE FUNCTION pg_temp.inbox_payload(event text DEFAULT 'event-49') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('eventId',event,'eventType','interest-payout.success','eventCategory','interest-payout',
    'customer_id',proof->'webhookCustomerId','pvb_wallet',proof->'sourceWalletId','pvb_accrued_interest_wallet',proof->'accruedWalletId',
    'pvb_destination_wallet',NULL,'pvb_third_party_reference',NULL,'pvb_reference',proof->'envelopeReference',
    'eventData',jsonb_build_object('id',proof->'payoutId','amount',3000,'destination_wallet',proof->'destinationWalletId',
      'destination_wallet_balance',13000,'destination_wallet_ledger_balance',13000,'reference',proof->'reference',
      'timestamp',proof->'paidAt','batch_id',proof->'batchId',
      'break_down',jsonb_build_object('gross_interest_payout',3158,'withholding_tax',158,'net_interest_payout',3000)))
  FROM (SELECT pg_temp.production_goal_proof(49) AS proof) selected;
$$;
CREATE FUNCTION pg_temp.inbox_enqueue(payload jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.enqueue_paid_interest_inbox('00000000-0000-4000-8000-000000000005','production',
    jsonb_build_object('rawHex',encode(convert_to(payload::text,'UTF8'),'hex'),'signature',repeat('a',128)));
$$;
CREATE FUNCTION pg_temp.inbox_claim() RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.claim_paid_interest_inbox('00000000-0000-4000-8000-000000000005','production','{"batchSize":1}')->0;
$$;
CREATE FUNCTION pg_temp.inbox_finish(claim jsonb,outcome text) RETURNS boolean LANGUAGE sql AS $$
  SELECT piggyvest_primary.finish_paid_interest_inbox('00000000-0000-4000-8000-000000000005','production',
    jsonb_build_object('eventId',claim->'eventId','token',claim->'token','outcome',outcome));
$$;
CREATE TEMP TABLE interest_inbox_claims(label text PRIMARY KEY,claim jsonb);
GRANT SELECT,INSERT,UPDATE ON interest_inbox_claims TO production_primary_interest_fixture;
SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.paid_interest_inbox_readiness('00000000-0000-4000-8000-000000000005','production','{"businessId":"prod-business"}'),
  'Read-only readiness checks exact business and enabled restricted authority');
SELECT pg_temp.assert_true(NOT piggyvest_primary.paid_interest_inbox_readiness('00000000-0000-4000-8000-000000000005','production','{"businessId":"foreign"}'),
  'Readiness cannot authorize a guessed provider business');
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(pg_temp.inbox_payload())='accepted','Signed raw receipt persists even before a customer crosswalk becomes eligible');
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(pg_temp.inbox_payload())='duplicate','Same raw event is a durable duplicate');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(49)||jsonb_build_object('bodyDigest',
  encode(sha256(convert_to(pg_temp.inbox_payload()::text,'UTF8')),'hex')))='prerequisite',
  'Queued pending intake cannot be synchronously credited before a worker claim');
INSERT INTO interest_inbox_claims VALUES('first',pg_temp.inbox_claim());
SELECT pg_temp.assert_true((SELECT claim->>'eventId'='event-49' FROM interest_inbox_claims WHERE label='first'),'Restricted worker claims the durable receipt');
SELECT pg_temp.assert_true(pg_temp.inbox_claim() IS NULL,'A live claim cannot be claimed twice');
SELECT pg_temp.assert_true(NOT pg_temp.inbox_finish((SELECT claim FROM interest_inbox_claims WHERE label='first'),'credited'),
  'Inbox cannot be marked financially processed without exact bridge evidence');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(49)||jsonb_build_object('bodyDigest',
  (SELECT claim->'bodyDigest' FROM interest_inbox_claims WHERE label='first')))='prerequisite','Unknown crosswalk never silently credits queued payout');
SELECT pg_temp.assert_true(pg_temp.inbox_finish((SELECT claim FROM interest_inbox_claims WHERE label='first'),'prerequisite'),'Prerequisite retry is durable');
SELECT pg_temp.assert_true(pg_temp.inbox_claim() IS NULL,'Retry backoff prevents a hot loop');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT state='pending' AND reason='prerequisite' AND attempts=1 FROM piggyvest_primary.paid_interest_inbox),
  'Missing provider crosswalk preserves signed evidence as pending');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM piggyvest_primary.paid_interest_receipts WHERE goal_id=pg_temp.goal_id(49)),
  'Enqueue and failed prerequisite never perform financial accounting');
UPDATE piggyvest_primary.paid_interest_inbox SET available_at=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO interest_inbox_claims VALUES('expired',pg_temp.inbox_claim());
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.paid_interest_inbox SET lease_until=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO interest_inbox_claims VALUES('reclaimed',pg_temp.inbox_claim());
SELECT pg_temp.assert_true((SELECT first.claim->>'token'<>second.claim->>'token' FROM interest_inbox_claims first
  JOIN interest_inbox_claims second ON second.label='reclaimed' WHERE first.label='expired'),'Expired leases are reclaimed with a fresh token');
SELECT pg_temp.assert_true(NOT pg_temp.inbox_finish((SELECT claim FROM interest_inbox_claims WHERE label='expired'),'io_retry'),'Stale worker cannot finish a reclaimed receipt');
SELECT pg_temp.assert_true(pg_temp.inbox_finish((SELECT claim FROM interest_inbox_claims WHERE label='reclaimed'),'io_retry'),'I/O retry retains exact original signed evidence');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.paid_interest_crosswalks SET enabled=true WHERE id=pg_temp.goal_id(49);
UPDATE piggyvest_primary.paid_interest_inbox SET available_at=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO interest_inbox_claims VALUES('credited',pg_temp.inbox_claim());
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(49)||jsonb_build_object('bodyDigest',
  (SELECT claim->'bodyDigest' FROM interest_inbox_claims WHERE label='credited')))='credited','Existing bridge credits verified eligible proof exactly once after retry');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.paid_interest_inbox SET lease_until=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO interest_inbox_claims VALUES('after-crash',pg_temp.inbox_claim());
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(49)||jsonb_build_object('bodyDigest',
  (SELECT claim->'bodyDigest' FROM interest_inbox_claims WHERE label='after-crash')))='duplicate','Crash after financial commit safely replays bridge dedup');
SELECT pg_temp.assert_true(pg_temp.inbox_finish((SELECT claim FROM interest_inbox_claims WHERE label='after-crash'),'duplicate'),'Exact raw digest observation allows durable processed acknowledgement');
SELECT pg_temp.assert_true(pg_temp.inbox_claim() IS NULL,'Processed receipt is not reclaimed');
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(pg_temp.inbox_payload())='duplicate','Processed same-body redelivery is acknowledged without fresh money');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(net_kobo)=3000 FROM piggyvest_primary.paid_interest_receipts WHERE goal_id=pg_temp.goal_id(49)),
  'Crash recovery and retries retain one payout and exact net amount');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM savings_notifications.events WHERE goal_id=pg_temp.goal_id(49) AND type='interest_credited'),
  'Crash recovery and retries retain one savings interest notice');
SELECT pg_temp.assert_true((SELECT state='processed' FROM piggyvest_primary.paid_interest_inbox WHERE event_id='event-49'),'Exact evidence is durably processed');
SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(jsonb_set(pg_temp.inbox_payload(),'{eventData,amount}','3001'))='quarantined',
  'Same event ID with changed bytes is durably quarantined');
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(pg_temp.inbox_payload())='quarantined','Original redelivery does not silently release quarantine');
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(jsonb_set(pg_temp.inbox_payload(),'{eventData,amount}','3001'))='quarantined','Conflicting redelivery is idempotent');
SELECT pg_temp.assert_true(pg_temp.inbox_claim() IS NULL,'Quarantine is never blindly credited');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(49)||jsonb_build_object('bodyDigest',
  encode(sha256(convert_to(pg_temp.inbox_payload()::text,'UTF8')),'hex')))='conflict',
  'An already running bridge cannot bypass durable event quarantine');
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(pg_temp.inbox_payload('new-alias'))='accepted','A separate signed delivery alias persists independently');
INSERT INTO interest_inbox_claims VALUES('proof-conflict',pg_temp.inbox_claim());
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(49)||jsonb_build_object(
  'eventId','new-alias','amountKobo',4000,'grossKobo',4158,'netKobo',4000,'bodyDigest',
  (SELECT claim->'bodyDigest' FROM interest_inbox_claims WHERE label='proof-conflict')))='conflict','Changed financial identity cannot overwrite credited payout');
SELECT pg_temp.assert_true(pg_temp.inbox_finish((SELECT claim FROM interest_inbox_claims WHERE label='proof-conflict'),'conflict'),'Financial conflict is durably quarantined');
SELECT pg_temp.assert_true(pg_temp.inbox_enqueue(pg_temp.inbox_payload('permanent-prerequisite'))='accepted','Another unresolved receipt is durable');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.paid_interest_inbox SET attempts=50 WHERE event_id='permanent-prerequisite';
SET SESSION AUTHORIZATION production_primary_interest_fixture;
INSERT INTO interest_inbox_claims VALUES('capped',pg_temp.inbox_claim());
SELECT pg_temp.assert_true((SELECT (claim->>'attempts')::integer=50 FROM interest_inbox_claims WHERE label='capped'),
  'Long-lived prerequisites retry without deleting evidence or overflowing attempt count');
SELECT pg_temp.assert_true(pg_temp.inbox_finish((SELECT claim FROM interest_inbox_claims WHERE label='capped'),'prerequisite'),'Long-lived prerequisite remains pending');
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_primary.claim_paid_interest_inbox('00000000-0000-4000-8000-000000000005','staging','{"batchSize":1}');
    RAISE EXCEPTION 'Cross-environment worker accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM piggyvest_primary.paid_interest_inbox_conflicts),'Raw conflict variants are durable and deduplicated');
SELECT pg_temp.assert_true((SELECT wallet.available_balance=saved.available_balance AND wallet.total_earned=saved.total_earned
  FROM public.customer_wallets wallet CROSS JOIN inbox_cash_before saved),'All durable intake/retry/quarantine paths preserve ordinary wallet cash');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','piggyvest_primary.enqueue_paid_interest_inbox(uuid,text,jsonb)','EXECUTE'),
  'Customers cannot claim signature verification authority');
SELECT pg_temp.assert_true(NOT has_table_privilege('production_primary_interest_fixture','piggyvest_primary.paid_interest_inbox','UPDATE'),
  'Restricted inbox workers cannot mutate financial evidence or bypass leases');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','piggyvest_primary.paid_interest_inbox','SELECT'),'Service role has no signed receipt read grant');
DO $$ BEGIN
  BEGIN
    UPDATE piggyvest_primary.paid_interest_inbox SET payload=convert_to('{}','UTF8');
    RAISE EXCEPTION 'Raw signed bytes changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM piggyvest_primary.paid_interest_inbox;
    RAISE EXCEPTION 'Raw signed bytes deleted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PRIMARY paid-interest durable inbox regressions passed' AS result;
